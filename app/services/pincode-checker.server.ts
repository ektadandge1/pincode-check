import prisma from "../db.server";
import {
  computeEstimatedDate,
  formatReadableDate,
  normalizePincode,
  parseCsvToStringSet,
  parseWeekendDays,
  toYyyyMmDd,
  validateIndianPincode,
} from "../utils/delivery.server";

type CheckPincodeInput = {
  pincode: string;
  shop?: string;
  codRequested?: boolean;
};

type PincodeResult = {
  available: boolean;
  pincode: string;
  source: "courier_api" | "db_fallback" | "none";
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
  holidayCsv: "",
  weekendDaysCsv: "0",
};

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
    holidayCsv: record.holidaysCsv,
    weekendDaysCsv: record.weekendDaysCsv,
  };
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
  pincode: string,
  codRequested: boolean,
  retries: number,
  timeoutMs: number,
): Promise<CourierEstimate | null> {
  let attempts = 0;
  while (attempts <= retries) {
    const result = await callShiprocketServiceability(pincode, codRequested, timeoutMs);
    if (result) {
      return result;
    }
    attempts += 1;
  }
  return null;
}

export async function checkPincodeDelivery(input: CheckPincodeInput): Promise<PincodeResult> {
  const normalizedPin = normalizePincode(input.pincode);

  if (!validateIndianPincode(normalizedPin)) {
    return {
      available: false,
      pincode: normalizedPin,
      source: "none",
      message: "Please enter a valid 6-digit pincode.",
    };
  }

  const settings = await getShopSettings(input.shop);
  const holidays = parseCsvToStringSet(settings.holidayCsv);
  const weekendDays = parseWeekendDays(settings.weekendDaysCsv);

  let source: PincodeResult["source"] = "none";
  let deliveryDays: number | null = null;
  let codAvailable = false;
  let courierName: string | undefined;

  if (settings.courierEnabled) {
    const courier = await resolveCourierEstimate(
      normalizedPin,
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
    const pincode = await prisma.pincode.findUnique({ where: { pincode: normalizedPin } });
    if (pincode && pincode.serviceable) {
      source = "db_fallback";
      deliveryDays = pincode.deliveryDays;
      codAvailable = pincode.codAvailable;
    }
  }

  if (deliveryDays === null) {
    return {
      available: false,
      pincode: normalizedPin,
      source: "none",
      message: "Sorry, delivery is not available for this pincode.",
    };
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

  return {
    available: true,
    pincode: normalizedPin,
    source,
    courier_name: courierName,
    delivery_days: deliveryDays,
    estimated_date: estimatedDateIso,
    cod_available: codAvailable,
    message: `Delivery by ${prettyDate}. ${codLabel}.`,
  };
}

export function parseCodRequestParam(value: string | null): boolean {
  return parseBoolean(value);
}
