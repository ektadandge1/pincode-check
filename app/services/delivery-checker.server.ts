import prisma from "../db.server";
import type { FulfillmentLocationRule } from "@prisma/client";
import { selectFulfillmentLocation } from "../utils/location-selection";
import {
  aggregateCartDeliveryItems,
  aggregateDeliveryDateWindow,
  computeDeliveryDetails,
  formatReadableDate,
  formatIsoDateInZone,
  matchesPostalPattern,
  matchesPostalPatternsCsv,
  normalizeCountryCode,
  normalizePostalCode,
  parseCsvToStringSet,
  parsePostalPattern,
  parseWeekendDays,
  postalPatternSpecificity,
  validatePostalCode,
  type CartDeliveryItemInput,
} from "../utils/delivery.server";
import {
  deliveryTargetSuccessMessage,
  matchDeliveryTarget,
  productContextCacheKey,
  type DeliveryTargetRecord,
  type ProductEstimateBatchItem,
  type ProductTargetContext,
} from "../utils/targeting.server";
import { renderDeliveryMessage } from "../utils/delivery-message";
import {
  serializeShippingMethod,
  shippingMethodEligible,
} from "../utils/shipping-method";
import { STANDARD_FEATURES, type PlanFeatures } from "./plans.server";

export type CheckDeliveryInput = {
  country?: string;
  postalCode?: string;
  shop?: string;
  codRequested?: boolean;
  variantId?: string;
  quantity?: number;
  productId?: string | null;
  productTags?: string[] | null;
  collectionHandles?: string[] | null;
  productVendor?: string | null;
  features?: PlanFeatures;
  trackAnalytics?: boolean;
  admin?: {
    graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
  };
};

export type DeliveryResult = {
  available: boolean;
  country: string;
  postal_code: string;
  source: "courier_api" | "db_fallback" | "none";
  reason?: "variant_required" | "out_of_stock" | "inventory_unavailable" | "cart_incomplete";
  in_stock?: boolean;
  courier_name?: string;
  delivery_days?: number;
  estimated_date?: string;
  estimated_date_max?: string;
  estimated_date_label?: string;
  estimated_date_max_label?: string;
  dispatch_date?: string;
  dispatch_date_label?: string;
  min_lead_days?: number;
  max_lead_days?: number;
  processing_days?: number;
  transit_days?: number;
  seconds_until_cutoff?: number;
  fulfillment_location_id?: string;
  fulfillment_location_name?: string;
  local_delivery_available?: boolean;
  pickup_available?: boolean;
  pickup_instructions?: string;
  cart_items_checked?: number;
  cart_complete?: boolean;
  unavailable_items?: number;
  shipping_methods?: Array<{
    handle: string;
    name: string;
    kind: string;
    description: string | null;
    custom_message: string | null;
    dispatch_date: string;
    dispatch_date_label: string;
    estimated_date: string;
    estimated_date_label: string;
    processing_days: number;
    transit_days: number;
  }>;
  shipping_method_display_style?: "visual" | "dropdown";
  cod_available?: boolean;
  delivery_charge?: number | null;
  currency?: string | null;
  same_day_available?: boolean;
  next_day_available?: boolean;
  express_available?: boolean;
  disable_add_to_cart?: boolean;
  require_valid_pin?: boolean;
  matched_target?: string | null;
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
  processingDays: 0,
  deliveryWindowDays: 2,
  dateFormat: "weekday_day_month",
  timeZone: "UTC",
  locale: "en",
  fallbackDays: 5,
  courierTimeoutMs: 2000,
  retryCount: 1,
  courierEnabled: false,
  dbFallbackEnabled: true,
  inventoryAwareEnabled: false,
  locationPriorityMode: "manual",
  holidayCsv: "",
  weekendDaysCsv: "0",
  disableAddToCart: false,
  requireValidPin: false,
  successMessage: "Receive your order between {min_delivery_date} and {max_delivery_date}. {cod_message}{delivery_charge_message}",
  unavailableMessage: "Sorry, delivery is not available for this postal code.",
  codAvailableMessage: "COD available.",
  codUnavailableMessage: "Prepaid only.",
  deliveryChargeMessage: " Delivery charge: {currency}{delivery_charge}.",
  shippingMethodDisplayStyle: "visual" as const,
};

const CHECK_CACHE_TTL_MS = 60_000;
const CHECK_CACHE_MAX_ENTRIES = 5_000;
const PATTERN_CACHE_TTL_MS = 60_000;
const ANALYTICS_RETENTION_DAYS = 90;
const checkCache = new Map<string, { expiresAt: number; result: DeliveryResult }>();
const patternCache = new Map<
  string,
  {
    expiresAt: number;
    rows: Array<{
      id: number;
      country: string;
      postalCode: string;
      patternType: string;
      rangeStart: string | null;
      rangeEnd: string | null;
      zoneId: number | null;
      zoneName: string | null;
      zonePriority: number;
      zoneEnabled: boolean;
      serviceable: boolean;
      deliveryDays: number;
      codAvailable: boolean;
      deliveryCharge: number | null;
      currency: string | null;
      sameDayAvailable: boolean;
      nextDayAvailable: boolean;
       expressAvailable: boolean;
       state: string | null;
    }>;
  }
>;
let analyticsWrites = 0;

function setCachedResult(key: string, result: DeliveryResult) {
  const now = Date.now();
  for (const [cachedKey, cached] of checkCache) {
    if (cached.expiresAt <= now) checkCache.delete(cachedKey);
  }
  while (checkCache.size >= CHECK_CACHE_MAX_ENTRIES) {
    const oldestKey = checkCache.keys().next().value;
    if (!oldestKey) break;
    checkCache.delete(oldestKey);
  }
  const secondsUntilCutoff = result.seconds_until_cutoff;
  const ttl = typeof secondsUntilCutoff === "number" && secondsUntilCutoff > 0
    ? Math.min(CHECK_CACHE_TTL_MS, Math.max(0, secondsUntilCutoff * 1000 - 1_000))
    : CHECK_CACHE_TTL_MS;
  if (ttl > 0) {
    checkCache.set(key, { expiresAt: now + ttl, result });
  }
}

async function loadPostalPatterns(shopKey: string, country: string) {
  const cacheKey = `${shopKey}|${country}`;
  const cached = patternCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.rows;
  }

  const records = await prisma.postalCode.findMany({
    where: {
      shop: shopKey,
      country,
      patternType: { not: "exact" },
    },
    include: {
      zoneGroup: {
        select: { id: true, name: true, priority: true, enabled: true },
      },
    },
    take: 50_000,
  });

  const rows = records.map((record) => ({
    id: record.id,
    country: record.country,
    postalCode: record.postalCode,
    patternType: record.patternType,
    rangeStart: record.rangeStart,
    rangeEnd: record.rangeEnd,
    zoneId: record.zoneId,
    zoneName: record.zoneGroup?.name ?? record.zone,
    zonePriority: record.zoneGroup?.priority ?? 100,
    zoneEnabled: record.zoneGroup ? record.zoneGroup.enabled : true,
    serviceable: record.serviceable,
    deliveryDays: record.deliveryDays,
    codAvailable: record.codAvailable,
    deliveryCharge: record.deliveryCharge,
    currency: record.currency,
    sameDayAvailable: record.sameDayAvailable,
    nextDayAvailable: record.nextDayAvailable,
    expressAvailable: record.expressAvailable,
    state: record.state,
  }));

  patternCache.set(cacheKey, { expiresAt: now + PATTERN_CACHE_TTL_MS, rows });
  if (patternCache.size > 50) {
    const oldest = patternCache.keys().next().value;
    if (oldest) patternCache.delete(oldest);
  }

  return rows;
}

async function findPatternMatch(shopKey: string, country: string, postalCode: string) {
  const rows = await loadPostalPatterns(shopKey, country);
  type Candidate = {
    specificity: number;
    zonePriority: number;
    row: (typeof rows)[number];
  };

  const candidates: Candidate[] = [];

  for (const row of rows) {
    if (row.zoneId !== null && !row.zoneEnabled) continue;

    let parsed;
    if (row.patternType === "range" && row.rangeStart && row.rangeEnd) {
      parsed = {
        type: "range" as const,
        pattern: row.postalCode,
        start: row.rangeStart,
        end: row.rangeEnd,
      };
    } else {
      parsed = parsePostalPattern(country, row.postalCode);
      if (!parsed || parsed.type === "exact") continue;
    }

    if (!matchesPostalPattern(parsed, country, postalCode)) continue;

    candidates.push({
      specificity: postalPatternSpecificity(parsed),
      zonePriority: row.zonePriority,
      row,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.specificity !== a.specificity) return b.specificity - a.specificity;
    if (a.zonePriority !== b.zonePriority) return a.zonePriority - b.zonePriority;
    return a.row.id - b.row.id;
  });

  return candidates[0].row;
}

function maskPostalCode(postalCode: string): string {
  const visibleLength = Math.min(3, Math.max(1, Math.floor(postalCode.length / 2)));
  return `${postalCode.slice(0, visibleLength)}${"*".repeat(Math.max(1, postalCode.length - visibleLength))}`;
}

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
    processingDays: record.processingDays,
    deliveryWindowDays: record.deliveryWindowDays,
    dateFormat: record.dateFormat,
    timeZone: record.timeZone,
    locale: record.locale,
    fallbackDays: record.fallbackDays,
    courierTimeoutMs: record.courierTimeoutMs,
    retryCount: record.retryCount,
    courierEnabled: record.courierEnabled,
    dbFallbackEnabled: record.dbFallbackEnabled,
    inventoryAwareEnabled: record.inventoryAwareEnabled,
    locationPriorityMode: record.locationPriorityMode === "highest_stock" ? "highest_stock" : "manual",
    holidayCsv: record.holidaysCsv,
    weekendDaysCsv: record.weekendDaysCsv,
    disableAddToCart: record.disableAddToCart,
    requireValidPin: record.requireValidPin,
    successMessage: record.successMessage,
    unavailableMessage: record.unavailableMessage,
    codAvailableMessage: record.codAvailableMessage,
    codUnavailableMessage: record.codUnavailableMessage,
    deliveryChargeMessage: record.deliveryChargeMessage,
    shippingMethodDisplayStyle: record.shippingMethodDisplayStyle === "dropdown" ? "dropdown" as const : "visual" as const,
  };
}

async function trackSearchEvent(input: CheckDeliveryInput, result: DeliveryResult) {
  if (!input.shop) return;
  try {
    analyticsWrites += 1;
    if (analyticsWrites % 100 === 0) {
      const retentionCutoff = new Date();
      retentionCutoff.setUTCDate(retentionCutoff.getUTCDate() - ANALYTICS_RETENTION_DAYS);
      await prisma.postalCodeSearchEvent.deleteMany({
        where: { shop: input.shop, createdAt: { lt: retentionCutoff } },
      });
    }
    await prisma.postalCodeSearchEvent.create({
      data: {
        shop: input.shop,
        country: result.country,
        postalCode: maskPostalCode(result.postal_code),
        productId: input.productId ? String(input.productId).replace(/\D/g, "").slice(-30) || null : null,
        variantId: input.variantId ? String(input.variantId).replace(/\D/g, "").slice(-30) || null : null,
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

type VariantInventoryResult = {
  sellableQuantity: number;
  continueSelling: boolean;
  levels: Array<{ locationId: string; available: number }>;
};

type InventoryStatus = "in_stock" | "backorder" | "out_of_stock";

function inventoryStatusFor(inventory: VariantInventoryResult, quantity: number): InventoryStatus {
  if (inventory.sellableQuantity >= quantity) return "in_stock";
  return inventory.continueSelling ? "backorder" : "out_of_stock";
}

async function checkVariantInventory(
  admin: CheckDeliveryInput["admin"],
  variantId: string,
): Promise<VariantInventoryResult | null> {
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
        inventoryItem {
          inventoryLevels(first: 100) {
            nodes {
              quantities(names: ["available"]) {
                name
                quantity
              }
              location { id }
            }
          }
        }
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
        inventoryItem?: {
          inventoryLevels?: {
            nodes?: Array<{
              quantities?: Array<{ name?: string; quantity?: number }>;
              location?: { id?: string } | null;
            }>;
          };
        } | null;
      } | null;
    };
  };

  const variant = json.data?.productVariant;
  if (!variant) {
    return null;
  }

  const levels = (variant.inventoryItem?.inventoryLevels?.nodes ?? []).flatMap((level) => {
    const locationId = level.location?.id;
    const available = level.quantities?.find((quantity) => quantity.name === "available")?.quantity;
    return locationId && typeof available === "number" ? [{ locationId, available }] : [];
  });
  return {
    sellableQuantity: typeof variant.sellableOnlineQuantity === "number"
      ? variant.sellableOnlineQuantity
      : 0,
    continueSelling: variant.inventoryPolicy === "CONTINUE",
    levels,
  };
}

async function loadLocationRules(shop: string): Promise<FulfillmentLocationRule[]> {
  return prisma.fulfillmentLocationRule.findMany({
    where: { shop, enabled: true },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    take: 100,
  });
}

async function loadShippingMethodRules(shop: string) {
  return prisma.shippingMethodRule.findMany({
    where: { shop, enabled: true },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    take: 50,
  });
}

function matchesLocalDelivery(rule: FulfillmentLocationRule, country: string, postalCode: string): boolean {
  return rule.localDeliveryEnabled
    && matchesPostalPatternsCsv(country, postalCode, rule.localDeliveryPostalCodesCsv);
}

function parseBoolean(value: string | null | undefined): boolean {
  return value === "1" || value === "true";
}

async function loadDeliveryTargets(shopKey: string): Promise<DeliveryTargetRecord[]> {
  const records = await prisma.deliveryTarget.findMany({
    where: { shop: shopKey, enabled: true },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    take: 2_000,
  });

  return records.map((record) => ({
    id: record.id,
    shop: record.shop,
    name: record.name,
    targetKind: record.targetKind,
    targetValue: record.targetValue,
    countryCode: record.countryCode,
    stateRegion: record.stateRegion,
    inventoryMode: record.inventoryMode,
    customSuccessMessage: record.customSuccessMessage,
    activationMode: record.activationMode,
    activeFromLocal: record.activeFromLocal,
    activeUntilLocal: record.activeUntilLocal,
    weekdaysCsv: record.weekdaysCsv,
    startTimeLocal: record.startTimeLocal,
    endTimeLocal: record.endTimeLocal,
    requireValidPin: record.requireValidPin,
    processingDays: record.processingDays,
    transitDays: record.transitDays,
    excluded: record.excluded,
    enabled: record.enabled,
    priority: record.priority,
  }));
}

function productContextFromInput(
  input: CheckDeliveryInput,
  options: {
    country?: string | null;
    state?: string | null;
    inventoryStatus?: InventoryStatus | null;
    timeZone?: string;
  } = {},
): ProductTargetContext {
  return {
    productId: input.productId ?? null,
    tags: input.productTags ?? [],
    collectionHandles: input.collectionHandles ?? [],
    vendor: input.productVendor ?? null,
    country: options.country ?? input.country ?? null,
    state: options.state ?? null,
    inventoryStatus: options.inventoryStatus ?? null,
    timeZone: options.timeZone ?? "UTC",
  };
}

function resolvePinPolicy(
  shopRequireValidPin: boolean,
  targets: DeliveryTargetRecord[],
  context: ProductTargetContext,
): { requireValidPin: boolean; matchedTarget: DeliveryTargetRecord | null } {
  const matched = matchDeliveryTarget(targets, context);
  if (matched) {
    return {
      requireValidPin: matched.requireValidPin,
      matchedTarget: matched,
    };
  }
  return { requireValidPin: shopRequireValidPin, matchedTarget: null };
}

async function inventoryForTargeting(
  input: CheckDeliveryInput,
  targets: DeliveryTargetRecord[],
  quantity: number,
): Promise<{ inventory: VariantInventoryResult | null; status: InventoryStatus | null }> {
  const needsInventory = targets.some((target) => target.inventoryMode && target.inventoryMode !== "any");
  if (!needsInventory || !input.variantId || !input.admin) {
    return { inventory: null, status: null };
  }
  const inventory = await checkVariantInventory(input.admin, input.variantId);
  return {
    inventory,
    status: inventory ? inventoryStatusFor(inventory, quantity) : null,
  };
}

function withPinPolicy(
  result: DeliveryResult,
  requireValidPin: boolean,
  matchedTarget: string | null,
): DeliveryResult {
  return {
    ...result,
    disable_add_to_cart:
      result.disable_add_to_cart !== undefined
        ? result.disable_add_to_cart
        : false,
    require_valid_pin: requireValidPin,
    matched_target: matchedTarget,
  };
}

export async function checkDeliveryPolicy(input: CheckDeliveryInput): Promise<{
  disable_add_to_cart: boolean;
  require_valid_pin: boolean;
  matched_target: string | null;
  message: string;
}> {
  const shopKey = input.shop && input.shop.length > 0 ? input.shop : "default";
  const settings = await getShopSettings(input.shop);
  const features = input.features ?? STANDARD_FEATURES;
  const targets = features.targeting ? await loadDeliveryTargets(shopKey) : [];
  const quantity = Math.max(1, Math.floor(input.quantity ?? 1));
  const { status } = await inventoryForTargeting(input, targets, quantity);
  const policy = resolvePinPolicy(
    features.cartProtection ? settings.requireValidPin : false,
    targets,
    productContextFromInput(input, {
      country: input.country ? normalizeCountryCode(input.country) : null,
      inventoryStatus: status,
      timeZone: settings.timeZone,
    }),
  );

  return {
    disable_add_to_cart: features.cartProtection && settings.disableAddToCart,
    require_valid_pin: policy.requireValidPin,
    matched_target: policy.matchedTarget?.name ?? null,
    message: policy.requireValidPin
      ? "Enter a valid postal code and check delivery to unlock Add to Cart."
      : "",
  };
}

export async function getGeneralDeliveryEstimate(input: CheckDeliveryInput) {
  const shopKey = input.shop && input.shop.length > 0 ? input.shop : "default";
  const settings = await getShopSettings(input.shop);
  const features = input.features ?? STANDARD_FEATURES;
  const targets = features.targeting ? await loadDeliveryTargets(shopKey) : [];
  return generalDeliveryEstimate(input, settings, targets);
}

async function generalDeliveryEstimate(
  input: CheckDeliveryInput,
  settings: Awaited<ReturnType<typeof getShopSettings>>,
  targets: DeliveryTargetRecord[],
) {
  const quantity = Math.max(1, Math.floor(input.quantity ?? 1));
  const { status } = await inventoryForTargeting(input, targets, quantity);
  const matchedTarget = matchDeliveryTarget(targets, productContextFromInput(input, {
    country: input.country ? normalizeCountryCode(input.country) : null,
    inventoryStatus: status,
    timeZone: settings.timeZone,
  }));

  if (matchedTarget?.excluded) {
    return { enabled: false, matched_target: matchedTarget.name };
  }

  const processingDays = matchedTarget?.processingDays ?? settings.processingDays;
  const transitDays = matchedTarget?.transitDays ?? settings.fallbackDays;
  const calculation = {
    processingDays,
    transitDays,
    cutoffHour24: settings.cutoffHour24,
    holidays: parseCsvToStringSet(settings.holidayCsv),
    weekendDays: parseWeekendDays(settings.weekendDaysCsv),
    timeZone: settings.timeZone,
  };
  const earliest = computeDeliveryDetails(calculation);
  const latest = computeDeliveryDetails({
    ...calculation,
    transitDays: transitDays + settings.deliveryWindowDays,
  });
  const orderDateLabel = formatReadableDate(earliest.orderDate, settings.locale, settings.timeZone, settings.dateFormat);
  const dispatchDateLabel = formatReadableDate(earliest.dispatchDate, settings.locale, settings.timeZone, settings.dateFormat);
  const earliestLabel = formatReadableDate(earliest.estimatedDate, settings.locale, settings.timeZone, settings.dateFormat);
  const latestLabel = formatReadableDate(latest.estimatedDate, settings.locale, settings.timeZone, settings.dateFormat);

  return {
    enabled: true,
    order_date: formatIsoDateInZone(earliest.orderDate, settings.timeZone),
    order_date_label: orderDateLabel,
    dispatch_date: formatIsoDateInZone(earliest.dispatchDate, settings.timeZone),
    dispatch_date_label: dispatchDateLabel,
    estimated_date: formatIsoDateInZone(earliest.estimatedDate, settings.timeZone),
    estimated_date_max: formatIsoDateInZone(latest.estimatedDate, settings.timeZone),
    estimated_date_label: earliestLabel,
    estimated_date_max_label: latestLabel,
    delivery_date_range: earliestLabel === latestLabel ? earliestLabel : `${earliestLabel} to ${latestLabel}`,
    processing_days: processingDays,
    transit_days: transitDays,
    matched_target: matchedTarget?.name ?? null,
  };
}

export async function getProductCardDeliveryEstimates(
  input: Omit<CheckDeliveryInput, "productId" | "productVendor" | "productTags" | "collectionHandles">,
  items: ProductEstimateBatchItem[],
) {
  const shopKey = input.shop && input.shop.length > 0 ? input.shop : "default";
  const settings = await getShopSettings(input.shop);
  const features = input.features ?? STANDARD_FEATURES;
  const targets = features.targeting ? await loadDeliveryTargets(shopKey) : [];

  return Promise.all(items.map(async (item) => {
    const estimate = await generalDeliveryEstimate({
      ...input,
      productId: item.productId,
      productVendor: item.productVendor,
      productTags: item.productTags,
      collectionHandles: item.collectionHandles,
    }, settings, targets);

    return {
      key: item.key,
      estimate: estimate.matched_target ? estimate : { enabled: false },
    };
  }));
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const auth = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });

    if (!auth.ok) return null;

    const authJson = (await auth.json()) as { token?: string };
    if (!authJson.token) return null;

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
  const normalizedPostalCode = normalizePostalCode(country, input.postalCode ?? "");
  const shopKey = input.shop && input.shop.length > 0 ? input.shop : "default";

  if (!validatePostalCode(country, normalizedPostalCode)) {
    const invalidPolicy = await checkDeliveryPolicy(input);
    return withPinPolicy(
      {
        available: false,
        country,
        postal_code: normalizedPostalCode,
        source: "none",
        message: "Please enter a valid postal code.",
      },
      invalidPolicy.require_valid_pin,
      invalidPolicy.matched_target,
    );
  }

  const settings = await getShopSettings(input.shop);
  const features = input.features ?? STANDARD_FEATURES;
  const targets = features.targeting ? await loadDeliveryTargets(shopKey) : [];
  const inventoryAware = features.inventory && settings.inventoryAwareEnabled;
  const inventoryTargeting = targets.some((target) => target.inventoryMode && target.inventoryMode !== "any");
  const requestedQuantity = Math.max(1, Math.floor(input.quantity ?? 1));
  const exactRecord = await prisma.postalCode.findFirst({
    where: {
      shop: shopKey,
      country,
      postalCode: normalizedPostalCode,
      patternType: "exact",
    },
    include: { zoneGroup: { select: { enabled: true } } },
  });
  const exactMatch = exactRecord?.zoneId !== null && exactRecord?.zoneGroup?.enabled === false
    ? null
    : exactRecord;
  const matchedPostalRecord = exactMatch ?? (features.patterns
    ? await findPatternMatch(shopKey, country, normalizedPostalCode)
    : null);

  let inventory: VariantInventoryResult | null = null;
  let inventoryStatus: InventoryStatus | null = null;
  if ((inventoryAware || inventoryTargeting) && input.variantId && input.admin) {
    inventory = await checkVariantInventory(input.admin, input.variantId);
    inventoryStatus = inventory ? inventoryStatusFor(inventory, requestedQuantity) : null;
  }
  const pinPolicy = resolvePinPolicy(
    features.cartProtection ? settings.requireValidPin : false,
    targets,
    productContextFromInput(input, {
      country,
      state: matchedPostalRecord?.state ?? null,
      inventoryStatus,
      timeZone: settings.timeZone,
    }),
  );
  if (pinPolicy.matchedTarget?.excluded) {
    const result = withPinPolicy({
      available: false,
      country,
      postal_code: normalizedPostalCode,
      source: "none",
      disable_add_to_cart: features.cartProtection && settings.disableAddToCart,
      message: features.customMessages ? settings.unavailableMessage : DEFAULT_SETTINGS.unavailableMessage,
    }, pinPolicy.requireValidPin, pinPolicy.matchedTarget.name);
    if (features.analytics && input.trackAnalytics !== false) await trackSearchEvent(input, result);
    return result;
  }
  const contextKey = productContextCacheKey(productContextFromInput(input));
  const cacheKey = [
    shopKey,
    country,
    normalizedPostalCode,
    input.codRequested ? "cod" : "prepaid",
    contextKey,
    features.patterns ? "patterns" : "exact",
    features.deliveryOptions ? "options" : "core",
    features.customMessages ? "custom" : "standard",
    settings.courierEnabled ? "courier-on" : "courier-off",
    settings.dbFallbackEnabled ? "coverage-fallback-on" : "coverage-fallback-off",
    pinPolicy.requireValidPin ? "lock" : "open",
    pinPolicy.matchedTarget?.name ?? "",
  ].join("|");
  const disableAddToCart = features.cartProtection && settings.disableAddToCart;
  const cached = !inventoryAware && !inventoryTargeting ? checkCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    if (features.analytics && input.trackAnalytics !== false) await trackSearchEvent(input, cached.result);
    return withPinPolicy(cached.result, pinPolicy.requireValidPin, pinPolicy.matchedTarget?.name ?? null);
  }

  const holidays = parseCsvToStringSet(settings.holidayCsv);
  const weekendDays = parseWeekendDays(settings.weekendDaysCsv);
  let selectedLocation: FulfillmentLocationRule | null = null;

  if (inventoryAware) {
    if (!input.variantId) {
      return withPinPolicy(
        {
          available: false,
          country,
          postal_code: normalizedPostalCode,
          source: "none",
          reason: "variant_required",
          disable_add_to_cart: disableAddToCart,
          message: "Please select a product variant to check delivery.",
        },
        pinPolicy.requireValidPin,
        pinPolicy.matchedTarget?.name ?? null,
      );
    }

    if (inventory === null) {
      return withPinPolicy(
        {
          available: false,
          country,
          postal_code: normalizedPostalCode,
          source: "none",
          reason: "inventory_unavailable",
          disable_add_to_cart: disableAddToCart,
          message: "Unable to verify stock right now. Please try again.",
        },
        pinPolicy.requireValidPin,
        pinPolicy.matchedTarget?.name ?? null,
      );
    }

    const locationRules = await loadLocationRules(shopKey);
    if (locationRules.length > 0) {
      selectedLocation = selectFulfillmentLocation(
        locationRules,
        inventory.levels,
        requestedQuantity,
        inventory.continueSelling,
        settings.locationPriorityMode === "highest_stock" ? "highest_stock" : "manual",
      );
    }

    if ((locationRules.length > 0 && !selectedLocation)
      || inventoryStatus === "out_of_stock") {
      return withPinPolicy(
        {
          available: false,
          country,
          postal_code: normalizedPostalCode,
          source: "none",
          reason: "out_of_stock",
          in_stock: false,
          disable_add_to_cart: disableAddToCart,
          message: "Out of stock for the selected variant.",
        },
        pinPolicy.requireValidPin,
        pinPolicy.matchedTarget?.name ?? null,
      );
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

  if (features.courier && settings.courierEnabled && country === "IN") {
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

  const courierIsPrimary = features.courier && settings.courierEnabled && country === "IN";
  if (deliveryDays === null && (!courierIsPrimary || settings.dbFallbackEnabled)) {
    const matched = matchedPostalRecord;

    if (matched) {
      source = "db_fallback";
      if (matched.serviceable) {
        deliveryDays = matched.deliveryDays;
        codAvailable = matched.codAvailable;
        deliveryCharge = features.deliveryOptions ? matched.deliveryCharge : null;
        currency = features.deliveryOptions ? matched.currency : null;
        sameDayAvailable = features.deliveryOptions && matched.sameDayAvailable;
        nextDayAvailable = features.deliveryOptions && matched.nextDayAvailable;
        expressAvailable = features.deliveryOptions && matched.expressAvailable;
      }
    }
  }

  if (deliveryDays === null) {
    const baseResult = {
      available: false,
      country,
      postal_code: normalizedPostalCode,
      source: "none",
      disable_add_to_cart: disableAddToCart,
      message: renderDeliveryMessage(features.customMessages ? settings.unavailableMessage : DEFAULT_SETTINGS.unavailableMessage, {
        country,
        postal_code: normalizedPostalCode,
      }),
    } satisfies DeliveryResult;
    const result = withPinPolicy(baseResult, pinPolicy.requireValidPin, pinPolicy.matchedTarget?.name ?? null);
    if (!inventoryAware && !inventoryTargeting) {
      setCachedResult(cacheKey, result);
    }
    if (features.analytics && input.trackAnalytics !== false) await trackSearchEvent(input, result);
    return result;
  }

  const processingDays = pinPolicy.matchedTarget?.processingDays
    ?? selectedLocation?.processingDays
    ?? settings.processingDays;
  const transitDays = pinPolicy.matchedTarget?.transitDays
    ?? selectedLocation?.transitDays
    ?? deliveryDays;
  const deliveryDetails = computeDeliveryDetails({
    processingDays,
    transitDays,
    cutoffHour24: settings.cutoffHour24,
    holidays,
    weekendDays,
    timeZone: settings.timeZone,
  });
  const latestDeliveryDetails = settings.deliveryWindowDays > 0
    ? computeDeliveryDetails({
        processingDays,
        transitDays: transitDays + settings.deliveryWindowDays,
        cutoffHour24: settings.cutoffHour24,
        holidays,
        weekendDays,
        timeZone: settings.timeZone,
      })
    : deliveryDetails;

  const estimatedDateIso = formatIsoDateInZone(deliveryDetails.estimatedDate, settings.timeZone);
  const estimatedDateMaxIso = formatIsoDateInZone(latestDeliveryDetails.estimatedDate, settings.timeZone);
  const dispatchDateIso = formatIsoDateInZone(deliveryDetails.dispatchDate, settings.timeZone);
  const minDeliveryDate = formatReadableDate(deliveryDetails.estimatedDate, settings.locale, settings.timeZone, settings.dateFormat);
  const maxDeliveryDate = formatReadableDate(latestDeliveryDetails.estimatedDate, settings.locale, settings.timeZone, settings.dateFormat);
  const orderDate = formatReadableDate(deliveryDetails.orderDate, settings.locale, settings.timeZone, settings.dateFormat);
  const dispatchDate = formatReadableDate(deliveryDetails.dispatchDate, settings.locale, settings.timeZone, settings.dateFormat);
  const minLeadDays = processingDays + transitDays;
  const maxLeadDays = minLeadDays + settings.deliveryWindowDays;
  const codAvailableMessage = features.customMessages ? settings.codAvailableMessage : DEFAULT_SETTINGS.codAvailableMessage;
  const codUnavailableMessage = features.customMessages ? settings.codUnavailableMessage : DEFAULT_SETTINGS.codUnavailableMessage;
  const successMessage = features.customMessages
    ? deliveryTargetSuccessMessage(pinPolicy.matchedTarget, settings.successMessage)
    : DEFAULT_SETTINGS.successMessage;
  const deliveryChargeTemplate = features.customMessages ? settings.deliveryChargeMessage : DEFAULT_SETTINGS.deliveryChargeMessage;
  const codMessage = codAvailable ? codAvailableMessage : codUnavailableMessage;
  const deliveryChargeMessage = deliveryCharge !== null && currency
    ? renderDeliveryMessage(deliveryChargeTemplate, {
        currency,
        delivery_charge: deliveryCharge,
      })
    : "";
  const message = renderDeliveryMessage(successMessage, {
    date: maxDeliveryDate,
    min_delivery_date: minDeliveryDate,
    max_delivery_date: maxDeliveryDate,
    delivery_date_range: minDeliveryDate === maxDeliveryDate ? minDeliveryDate : `${minDeliveryDate} to ${maxDeliveryDate}`,
    min_lead_days: minLeadDays,
    max_lead_days: maxLeadDays,
    order_date: orderDate,
    dispatch_date_formatted: dispatchDate,
    estimated_date: estimatedDateIso,
    estimated_date_max: estimatedDateMaxIso,
    estimated_date_label: minDeliveryDate,
    estimated_date_max_label: maxDeliveryDate,
    dispatch_date_label: dispatchDate,
    days: minLeadDays,
    processing_days: processingDays,
    transit_days: transitDays,
    dispatch_date: dispatchDateIso,
    country,
    postal_code: normalizedPostalCode,
    cod_message: codMessage,
    delivery_charge_message: deliveryChargeMessage,
    delivery_charge: deliveryCharge,
    currency,
  });
  const localDeliveryAvailable = selectedLocation
    ? matchesLocalDelivery(selectedLocation, country, normalizedPostalCode)
    : false;
  const pickupAvailable = selectedLocation?.pickupEnabled ?? false;
  const methodRules = features.deliveryOptions ? await loadShippingMethodRules(shopKey) : [];
  const shippingMethods = methodRules.flatMap((method) => {
    if (!shippingMethodEligible(method.kind, {
      express: expressAvailable,
      sameDay: sameDayAvailable,
      nextDay: nextDayAvailable,
      local: localDeliveryAvailable,
      pickup: pickupAvailable,
    })) return [];
    const methodProcessingDays = method.processingDays ?? processingDays;
    const details = computeDeliveryDetails({
      processingDays: methodProcessingDays,
      transitDays: method.transitDays,
      cutoffHour24: settings.cutoffHour24,
      holidays,
      weekendDays,
      timeZone: settings.timeZone,
    });
    return [serializeShippingMethod(method, {
      dispatchDate: formatIsoDateInZone(details.dispatchDate, settings.timeZone),
      dispatchDateLabel: formatReadableDate(details.dispatchDate, settings.locale, settings.timeZone, settings.dateFormat),
      estimatedDate: formatIsoDateInZone(details.estimatedDate, settings.timeZone),
      estimatedDateLabel: formatReadableDate(details.estimatedDate, settings.locale, settings.timeZone, settings.dateFormat),
      processingDays: methodProcessingDays,
    })];
  });

  const result = {
    available: true,
    country,
    postal_code: normalizedPostalCode,
    source,
    ...(inventoryAware ? { in_stock: inventoryStatus === "in_stock" } : {}),
    courier_name: courierName,
    delivery_days: processingDays + transitDays,
    estimated_date: estimatedDateIso,
    estimated_date_max: estimatedDateMaxIso,
    estimated_date_label: minDeliveryDate,
    estimated_date_max_label: maxDeliveryDate,
    dispatch_date: dispatchDateIso,
    dispatch_date_label: dispatchDate,
    min_lead_days: minLeadDays,
    max_lead_days: maxLeadDays,
    processing_days: processingDays,
    transit_days: transitDays,
    seconds_until_cutoff: deliveryDetails.cutoffRemainingSeconds,
    fulfillment_location_id: selectedLocation?.shopifyLocationId,
    fulfillment_location_name: selectedLocation?.name,
    local_delivery_available: localDeliveryAvailable,
    pickup_available: pickupAvailable,
    pickup_instructions: selectedLocation?.pickupEnabled
      ? selectedLocation.pickupInstructions || undefined
      : undefined,
    shipping_methods: shippingMethods,
    shipping_method_display_style: settings.shippingMethodDisplayStyle,
    cod_available: codAvailable,
    delivery_charge: deliveryCharge,
    currency,
    same_day_available: sameDayAvailable,
    next_day_available: nextDayAvailable,
    express_available: expressAvailable,
    disable_add_to_cart: disableAddToCart,
    message,
  } satisfies DeliveryResult;

  const successResult = withPinPolicy(result, pinPolicy.requireValidPin, pinPolicy.matchedTarget?.name ?? null);

  if (!inventoryAware && !inventoryTargeting) {
    setCachedResult(cacheKey, successResult);
  }

  if (features.analytics && input.trackAnalytics !== false) await trackSearchEvent(input, successResult);
  return successResult;
}

export type CartDeliveryItem = CartDeliveryItemInput;

export async function checkCartDelivery(
  input: Omit<CheckDeliveryInput, "productId" | "variantId" | "quantity" | "productVendor" | "productTags" | "collectionHandles">,
  items: CartDeliveryItem[],
  options: { complete?: boolean } = {},
): Promise<DeliveryResult> {
  const boundedItems = items.slice(0, 20);
  if (boundedItems.length === 0) return checkDelivery(input);

  const aggregatedItems = aggregateCartDeliveryItems(boundedItems);
  const checked = await Promise.all(aggregatedItems.map(async ({ item, itemCount }) => ({
    itemCount,
    result: await checkDelivery({
      ...input,
      ...item,
      trackAnalytics: false,
    }),
  })));
  const results = checked.map(({ result }) => result);
  const unavailableItems = checked.reduce(
    (total, entry) => total + (entry.result.available ? 0 : entry.itemCount),
    0,
  );
  const latest = [...results].sort((a, b) =>
    String(b.estimated_date ?? "").localeCompare(String(a.estimated_date ?? "")),
  )[0];
  const cartComplete = options.complete !== false && items.length <= 20;
  const dateWindow = aggregateDeliveryDateWindow(results);

  if (!cartComplete) {
    return {
      ...(results.find((result) => !result.available) ?? latest),
      ...dateWindow,
      available: false,
      reason: "cart_incomplete",
      cart_items_checked: boundedItems.length,
      cart_complete: false,
      unavailable_items: unavailableItems,
      message: `Only ${boundedItems.length} cart items were received. Full cart delivery availability could not be verified.`,
    };
  }

  if (unavailableItems > 0) {
    return {
      ...results.find((result) => !result.available)!,
      cart_items_checked: boundedItems.length,
      cart_complete: true,
      unavailable_items: unavailableItems,
      message: unavailableItems === 1
        ? "One cart item is not available for this postal code."
        : `${unavailableItems} cart items are not available for this postal code.`,
    };
  }

  const locationIds = new Set(results.map((result) => result.fulfillment_location_id).filter(Boolean));
  const onePickupLocation = locationIds.size <= 1;
  const commonShippingMethods = (results[0].shipping_methods ?? []).flatMap((method) => {
    const matching = results.map((result) => result.shipping_methods?.find((candidate) => candidate.handle === method.handle));
    if (matching.some((candidate) => !candidate)) return [];
    return [[...matching].sort((a, b) =>
      String(b?.estimated_date ?? "").localeCompare(String(a?.estimated_date ?? "")),
    )[0]!];
  });
  const combined: DeliveryResult = {
    ...latest,
    ...dateWindow,
    cart_items_checked: boundedItems.length,
    cart_complete: true,
    unavailable_items: 0,
    local_delivery_available: results.every((result) => result.local_delivery_available === true),
    pickup_available: onePickupLocation && results.every((result) => result.pickup_available === true),
    pickup_instructions: onePickupLocation ? latest.pickup_instructions : undefined,
    shipping_methods: commonShippingMethods,
    same_day_available: results.every((result) => result.same_day_available === true),
    next_day_available: results.every((result) => result.next_day_available === true),
    express_available: results.every((result) => result.express_available === true),
    cod_available: results.every((result) => result.cod_available === true),
    delivery_charge: results.some((result) => result.delivery_charge !== null && result.delivery_charge !== undefined)
      ? results.reduce((total, result) => total + (result.delivery_charge ?? 0), 0)
      : null,
    message: `All ${boundedItems.length} cart items can be delivered by ${dateWindow.estimated_date_max_label ?? dateWindow.estimated_date_max}.`,
  };
  if (input.features?.analytics !== false && input.trackAnalytics !== false) {
    await trackSearchEvent(input, combined);
  }
  return combined;
}

export function parseCodRequestParam(value: string | null): boolean {
  return parseBoolean(value);
}
