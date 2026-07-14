import prisma from "../db.server";
import {
  computeEstimatedDate,
  formatReadableDate,
  normalizeCountryCode,
  normalizePostalCode,
  parseCsvToStringSet,
  parseWeekendDays,
  toYyyyMmDd,
  validatePostalCode,
} from "../utils/delivery.server";

type CheckDeliveryInput = {
  country?: string;
  postalCode: string;
  shop?: string;
  codRequested?: boolean;
  variantId?: string;
  quantity?: number;
  admin?: {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
  };
};

type DeliveryResult = {
  available: boolean;
  country: string;
  postal_code: string;
  source: "courier_api" | "db_fallback" | "none";
  reason?: "variant_required" | "out_of_stock" | "inventory_unavailable";
  in_stock?: boolean;
  courier_name?: string;
  delivery_days?: number;
  estimated_date?: string;
  cod_available?: boolean;
  message: string;
};

type CourierEstimate = {
  serviceable: boolean;
  deliveryDays: number;
  codAvailable: boolean;
  courierName?: string;
};

const DEFAULT_SETTINGS = {
  cutoffHour24: 14,
  fallbackDays: 5,
  courierTimeoutMs: 2000,
  retryCount: 1,
  courierEnabled: false,
  dbFallbackEnabled: true,
  inventoryAwareEnabled: false,
  holidayCsv: "",
  weekendDaysCsv: "0",
};

const CHECK_CACHE_TTL_MS = 60_000;
const checkCache = new Map<string, { expiresAt: number; result: DeliveryResult }>();

async function getShopSettings(shop?: string) {
  const shopKey = shop && shop.length > 0 ? shop : "default";

  const specific = await prisma.deliverySetting.findUnique({
    where: { shop: shopKey },
  });

  const record =
    specific ??
    (await prisma.deliverySetting.findUnique({
      where: { shop: "default" },
    }));

  if (!record) {
    return DEFAULT_SETTINGS;
  }

  return {
    cutoffHour24: record.cutoffHour24,
    fallbackDays: record.fallbackDays,
    courierTimeoutMs: record.courierTimeoutMs,
    retryCount: record.retryCount,
    courierEnabled: record.courierEnabled,
    dbFallbackEnabled: record.dbFallbackEnabled,
    inventoryAwareEnabled: record.inventoryAwareEnabled,
    holidayCsv: record.holidaysCsv,
    weekendDaysCsv: record.weekendDaysCsv,
  };
}

async function checkVariantSellableQuantity(
  admin: CheckDeliveryInput["admin"],
  variantId: string,
): Promise<number | null> {
  if (!admin) {
    return null;
  }

  const response = await admin.graphql(
    `#graphql
    query VariantInventoryForEdd($id: ID!) {
      productVariant(id: $id) {
        id
        inventoryPolicy
        sellableOnlineQuantity
      }
    }`,
    {
      variables: { id: variantId },
    },
  );

  if (!response.ok) {
    return null;
  }

  const json = (await response.json()) as {
    data?: {
      productVariant?: {
        sellableOnlineQuantity?: number | null;
        inventoryPolicy?: "CONTINUE" | "DENY";
      } | null;
    };
  };

  const variant = json.data?.productVariant;
  if (!variant) {
    return null;
  }

  if (variant.inventoryPolicy === "CONTINUE") {
    return Number.MAX_SAFE_INTEGER;
  }

  return typeof variant.sellableOnlineQuantity === "number"
    ? variant.sellableOnlineQuantity
    : 0;
}

function parseBoolean(value: string | null | undefined): boolean {
  return value === "1" || value === "true";
}

async function callShiprocketServiceability(
  deliveryPostcode: string,
  codRequested: boolean,
  timeoutMs: number,
): Promise<CourierEstimate | null> {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  const pickupPostcode = process.env.SHIPROCKET_PICKUP_PINCODE;
  const weight = process.env.DEFAULT_PACKAGE_WEIGHT_KG ?? "0.5";

  if (!email || !password || !pickupPostcode) {
    return null;
  }

  const auth = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!auth.ok) {
    return null;
  }

  const authJson = (await auth.json()) as { token?: string };
  if (!authJson.token) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const params = new URLSearchParams({
      pickup_postcode: pickupPostcode,
      delivery_postcode: deliveryPostcode,
      weight,
      cod: codRequested ? "1" : "0",
    });

    const response = await fetch(
      `https://apiv2.shiprocket.in/v1/external/courier/serviceability?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${authJson.token}` },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as {
      data?: { available_courier_companies?: Array<{ estimated_delivery_days?: number; cod?: number; courier_name?: string }> };
    };

    const best = json.data?.available_courier_companies?.[0];
    if (!best || typeof best.estimated_delivery_days !== "number") {
      return null;
    }

    return {
      serviceable: true,
      deliveryDays: Math.max(0, Math.round(best.estimated_delivery_days)),
      codAvailable: best.cod === 1,
      courierName: best.courier_name,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCourierEstimate(
  postalCode: string,
  codRequested: boolean,
  retries: number,
  timeoutMs: number,
): Promise<CourierEstimate | null> {
  let attempts = 0;
  while (attempts <= retries) {
    const result = await callShiprocketServiceability(postalCode, codRequested, timeoutMs);
    if (result) {
      return result;
    }
    attempts += 1;
  }
  return null;
}

export async function checkDelivery(input: CheckDeliveryInput): Promise<DeliveryResult> {
  const country = normalizeCountryCode(input.country);
  const normalizedPostalCode = normalizePostalCode(country, input.postalCode);

  if (!validatePostalCode(country, normalizedPostalCode)) {
    return {
      available: false,
      country,
      postal_code: normalizedPostalCode,
      source: "none",
      message: "Please enter a valid postal code.",
    };
  }

  const settings = await getShopSettings(input.shop);
  const cacheKey = [input.shop ?? "default", country, normalizedPostalCode, input.codRequested ? "cod" : "prepaid"].join("|");
  const cached = !settings.inventoryAwareEnabled ? checkCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const holidays = parseCsvToStringSet(settings.holidayCsv);
  const weekendDays = parseWeekendDays(settings.weekendDaysCsv);
  const requestedQuantity = Math.max(1, Math.floor(input.quantity ?? 1));

  if (settings.inventoryAwareEnabled) {
    if (!input.variantId) {
      return {
        available: false,
        country,
        postal_code: normalizedPostalCode,
        source: "none",
        reason: "variant_required",
        in_stock: false,
        message: "Please select a product variant to check delivery.",
      };
    }

    const sellableQty = await checkVariantSellableQuantity(input.admin, input.variantId);

    if (sellableQty === null) {
      return {
        available: false,
        country,
        postal_code: normalizedPostalCode,
        source: "none",
        reason: "inventory_unavailable",
        in_stock: false,
        message: "Unable to verify stock right now. Please try again.",
      };
    }

    if (sellableQty < requestedQuantity) {
      return {
        available: false,
        country,
        postal_code: normalizedPostalCode,
        source: "none",
        reason: "out_of_stock",
        in_stock: false,
        message: "Out of stock for the selected variant.",
      };
    }
  }

  let source: DeliveryResult["source"] = "none";
  let deliveryDays: number | null = null;
  let codAvailable = false;
  let courierName: string | undefined;

  if (settings.courierEnabled && country === "IN") {
    const courier = await resolveCourierEstimate(
      normalizedPostalCode,
      input.codRequested ?? false,
      settings.retryCount,
      settings.courierTimeoutMs,
    );

    if (courier?.serviceable) {
      source = "courier_api";
      deliveryDays = courier.deliveryDays;
      codAvailable = courier.codAvailable;
      courierName = courier.courierName;
    }
  }

  if (deliveryDays === null && settings.dbFallbackEnabled) {
    const shopKey = input.shop && input.shop.length > 0 ? input.shop : "default";
    const postalCode = await prisma.postalCode.findUnique({
      where: { shop_country_postalCode: { shop: shopKey, country, postalCode: normalizedPostalCode } },
    });
    if (postalCode && postalCode.serviceable) {
      source = "db_fallback";
      deliveryDays = postalCode.deliveryDays;
      codAvailable = postalCode.codAvailable;
    }
  }

  if (deliveryDays === null) {
    const result = {
      available: false,
      country,
      postal_code: normalizedPostalCode,
      source: "none",
      message: "Sorry, delivery is not available for this postal code.",
    } satisfies DeliveryResult;
    if (!settings.inventoryAwareEnabled) {
      checkCache.set(cacheKey, { expiresAt: Date.now() + CHECK_CACHE_TTL_MS, result });
    }
    return result;
  }

  const estimatedDate = computeEstimatedDate({
    baseDays: deliveryDays,
    cutoffHour24: settings.cutoffHour24,
    holidays,
    weekendDays,
  });

  const estimatedDateIso = toYyyyMmDd(estimatedDate);
  const prettyDate = formatReadableDate(estimatedDate);
  const codLabel = codAvailable ? "COD available" : "Prepaid only";

  const result = {
    available: true,
    country,
    postal_code: normalizedPostalCode,
    source,
    in_stock: true,
    courier_name: courierName,
    delivery_days: deliveryDays,
    estimated_date: estimatedDateIso,
    cod_available: codAvailable,
    message: `Delivery by ${prettyDate}. ${codLabel}.`,
  };

  if (!settings.inventoryAwareEnabled) {
    checkCache.set(cacheKey, { expiresAt: Date.now() + CHECK_CACHE_TTL_MS, result });
  }

  return result;
}

export function parseCodRequestParam(value: string | null): boolean {
  return parseBoolean(value);
}
