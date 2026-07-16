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
  delivery_charge?: number | null;
  currency?: string | null;
  same_day_available?: boolean;
  next_day_available?: boolean;
  express_available?: boolean;
  disable_add_to_cart?: boolean;
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
  disableAddToCart: false,
  successMessage: "Delivery by {date}. {cod_message}{delivery_charge_message}",
  unavailableMessage: "Sorry, delivery is not available for this postal code.",
  codAvailableMessage: "COD available.",
  codUnavailableMessage: "Prepaid only.",
  deliveryChargeMessage: " Delivery charge: {currency}{delivery_charge}.",
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
    disableAddToCart: record.disableAddToCart,
    successMessage: record.successMessage,
    unavailableMessage: record.unavailableMessage,
    codAvailableMessage: record.codAvailableMessage,
    codUnavailableMessage: record.codUnavailableMessage,
    deliveryChargeMessage: record.deliveryChargeMessage,
  };
}

function formatTemplate(template: string, values: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{([a-z_]+)\}/g, (_match, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? "" : String(value);
  }).replace(/\s+/g, " ").trim();
}

async function trackSearchEvent(input: CheckDeliveryInput, result: DeliveryResult) {
  if (!input.shop) return;
  try {
    await prisma.postalCodeSearchEvent.create({
      data: {
        shop: input.shop,
        country: result.country,
        postalCode: result.postal_code,
        variantId: input.variantId,
        available: result.available,
        codAvailable: result.cod_available,
        deliveryDays: result.delivery_days,
        source: result.source,
      },
    });
  } catch {
    // Analytics must never block a shopper-facing delivery check.
  }
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
    await trackSearchEvent(input, cached.result);
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
  let deliveryCharge: number | null = null;
  let currency: string | null = null;
  let sameDayAvailable = false;
  let nextDayAvailable = false;
  let expressAvailable = false;

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
      deliveryCharge = postalCode.deliveryCharge;
      currency = postalCode.currency;
      sameDayAvailable = postalCode.sameDayAvailable;
      nextDayAvailable = postalCode.nextDayAvailable;
      expressAvailable = postalCode.expressAvailable;
    }
  }

  if (deliveryDays === null) {
    const result = {
      available: false,
      country,
      postal_code: normalizedPostalCode,
      source: "none",
      disable_add_to_cart: settings.disableAddToCart,
      message: formatTemplate(settings.unavailableMessage, {
        country,
        postal_code: normalizedPostalCode,
      }),
    } satisfies DeliveryResult;
    if (!settings.inventoryAwareEnabled) {
      checkCache.set(cacheKey, { expiresAt: Date.now() + CHECK_CACHE_TTL_MS, result });
    }
    await trackSearchEvent(input, result);
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
  const codMessage = codAvailable ? settings.codAvailableMessage : settings.codUnavailableMessage;
  const deliveryChargeMessage = deliveryCharge !== null && currency
    ? formatTemplate(settings.deliveryChargeMessage, {
        currency,
        delivery_charge: deliveryCharge,
      })
    : "";
  const message = formatTemplate(settings.successMessage, {
    date: prettyDate,
    days: deliveryDays,
    country,
    postal_code: normalizedPostalCode,
    cod_message: codMessage,
    delivery_charge_message: deliveryChargeMessage,
    delivery_charge: deliveryCharge,
    currency,
  });

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
    delivery_charge: deliveryCharge,
    currency,
    same_day_available: sameDayAvailable,
    next_day_available: nextDayAvailable,
    express_available: expressAvailable,
    disable_add_to_cart: settings.disableAddToCart,
    message,
  };

  if (!settings.inventoryAwareEnabled) {
    checkCache.set(cacheKey, { expiresAt: Date.now() + CHECK_CACHE_TTL_MS, result });
  }

  await trackSearchEvent(input, result);
  return result;
}

export function parseCodRequestParam(value: string | null): boolean {
  return parseBoolean(value);
}
