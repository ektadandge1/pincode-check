export type TargetKind = "product" | "collection" | "vendor" | "tag";
export type InventoryMode = "any" | "in_stock" | "backorder" | "out_of_stock";
export type ActivationMode = "always" | "date_range" | "weekly";

export type DeliveryTargetRecord = {
  id: number;
  shop: string;
  name: string;
  targetKind: string;
  targetValue: string;
  countryCode?: string | null;
  stateRegion?: string | null;
  inventoryMode?: string;
  customSuccessMessage?: string | null;
  activationMode?: string;
  activeFromLocal?: string | null;
  activeUntilLocal?: string | null;
  weekdaysCsv?: string;
  startTimeLocal?: string | null;
  endTimeLocal?: string | null;
  requireValidPin: boolean;
  processingDays: number | null;
  transitDays: number | null;
  excluded: boolean;
  enabled: boolean;
  priority: number;
};

export type ProductTargetContext = {
  productId?: string | null;
  tags?: string[] | null;
  collectionHandles?: string[] | null;
  vendor?: string | null;
  country?: string | null;
  state?: string | null;
  inventoryStatus?: Exclude<InventoryMode, "any"> | null;
  timeZone?: string;
  now?: Date;
};

export const PRODUCT_ESTIMATE_BATCH_LIMIT = 24;

export type ProductEstimateBatchItem = {
  key: string;
  productId: string;
  productVendor: string | null;
  productTags: string[];
  collectionHandles: string[];
};

export type ProductEstimateBatchParseResult =
  | { items: ProductEstimateBatchItem[]; error: null }
  | { items: []; error: "invalid_batch" | "too_many_items" };

const KIND_RANK: Record<TargetKind, number> = {
  product: 0,
  collection: 1,
  vendor: 2,
  tag: 3,
};

const INVENTORY_MODES = new Set<InventoryMode>(["any", "in_stock", "backorder", "out_of_stock"]);
const ACTIVATION_MODES = new Set<ActivationMode>(["always", "date_range", "weekly"]);

export function normalizeInventoryMode(value: string): InventoryMode | null {
  const normalized = String(value ?? "").trim().toLowerCase() as InventoryMode;
  return INVENTORY_MODES.has(normalized) ? normalized : null;
}

export function normalizeActivationMode(value: string): ActivationMode | null {
  const normalized = String(value ?? "").trim().toLowerCase() as ActivationMode;
  return ACTIVATION_MODES.has(normalized) ? normalized : null;
}

function localDateTimeParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: weekdays[value("weekday")],
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function timeToMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

export function isDeliveryTargetActive(
  target: DeliveryTargetRecord,
  timeZone = "UTC",
  now = new Date(),
): boolean {
  if (!target.enabled) return false;
  const mode = normalizeActivationMode(target.activationMode ?? "always");
  if (!mode) return false;
  if (mode === "always") return true;

  const local = localDateTimeParts(now, timeZone);
  if (mode === "date_range") {
    return Boolean(
      target.activeFromLocal
      && target.activeUntilLocal
      && local.date >= target.activeFromLocal
      && local.date <= target.activeUntilLocal,
    );
  }

  const start = timeToMinutes(target.startTimeLocal);
  const end = timeToMinutes(target.endTimeLocal);
  const weekdays = new Set(
    String(target.weekdaysCsv ?? "")
      .split(",")
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
  );
  return start !== null
    && end !== null
    && start < end
    && weekdays.has(local.weekday)
    && local.minutes >= start
    && local.minutes < end;
}

export function normalizeTargetKind(value: string): TargetKind | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "product" || normalized === "collection" || normalized === "vendor" || normalized === "tag") {
    return normalized;
  }
  return null;
}

export function normalizeTargetValue(kind: TargetKind, value: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (kind === "product") {
    const numeric = raw.replace(/\D/g, "");
    if (!numeric) return null;
    return numeric;
  }

  if (kind === "collection") {
    const handle = raw.toLowerCase().replace(/^\//, "");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(handle)) return null;
    return handle;
  }

  const text = raw.toLowerCase();
  if (!text || text.length > 100) return null;
  return text;
}

export function normalizeProductContext(
  context: ProductTargetContext,
): {
  productId: string | null;
  tags: string[];
  collectionHandles: string[];
  vendor: string | null;
  country: string | null;
  state: string | null;
  inventoryStatus: Exclude<InventoryMode, "any"> | null;
  timeZone: string;
  now?: Date;
} {
  const productId = normalizeTargetValue("product", String(context.productId ?? ""));

  const tags = [
    ...new Set(
      (context.tags ?? [])
        .map((tag) => normalizeTargetValue("tag", tag))
        .filter((tag): tag is string => Boolean(tag)),
    ),
  ];

  const collectionHandles = [
    ...new Set(
      (context.collectionHandles ?? [])
        .map((handle) => normalizeTargetValue("collection", handle))
        .filter((handle): handle is string => Boolean(handle)),
    ),
  ];

  const vendor = normalizeTargetValue("vendor", String(context.vendor ?? ""));
  const country = /^[A-Z]{2}$/.test(String(context.country ?? "").trim().toUpperCase())
    ? String(context.country).trim().toUpperCase()
    : null;
  const state = String(context.state ?? "").trim() || null;
  const inventoryStatus = context.inventoryStatus ?? null;
  return {
    productId,
    tags,
    collectionHandles,
    vendor,
    country,
    state,
    inventoryStatus,
    timeZone: context.timeZone || "UTC",
    now: context.now,
  };
}

function targetMatches(
  target: DeliveryTargetRecord,
  context: ReturnType<typeof normalizeProductContext>,
): boolean {
  if (!isDeliveryTargetActive(target, context.timeZone, context.now)) return false;
  const kind = normalizeTargetKind(target.targetKind);
  if (!kind) return false;
  const value = normalizeTargetValue(kind, target.targetValue);
  if (!value) return false;

  const countryCode = String(target.countryCode ?? "").trim().toUpperCase();
  const contextCountry = String(context.country ?? "").trim().toUpperCase();
  if (countryCode && countryCode !== contextCountry) return false;

  const stateRegion = String(target.stateRegion ?? "").trim().toLowerCase();
  const contextState = String(context.state ?? "").trim().toLowerCase();
  if (stateRegion && (!contextState || stateRegion !== contextState)) return false;

  const inventoryMode = normalizeInventoryMode(target.inventoryMode ?? "any");
  if (!inventoryMode || (inventoryMode !== "any" && inventoryMode !== context.inventoryStatus)) return false;

  if (kind === "product") {
    return Boolean(context.productId && context.productId === value);
  }
  if (kind === "collection") {
    return context.collectionHandles.includes(value);
  }
  if (kind === "vendor") {
    return context.vendor === value;
  }
  return context.tags.includes(value);
}

export function matchDeliveryTarget(
  targets: DeliveryTargetRecord[],
  rawContext: ProductTargetContext,
): DeliveryTargetRecord | null {
  const context = normalizeProductContext(rawContext);
  const matches = targets.filter((target) => targetMatches(target, context));
  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    const aKind = normalizeTargetKind(a.targetKind);
    const bKind = normalizeTargetKind(b.targetKind);
    const aRank = aKind ? KIND_RANK[aKind] : 99;
    const bRank = bKind ? KIND_RANK[bKind] : 99;
    if (aRank !== bRank) return aRank - bRank;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id - b.id;
  });

  return matches[0];
}

export function deliveryTargetSuccessMessage(
  target: DeliveryTargetRecord | null,
  globalMessage: string,
): string {
  return target?.customSuccessMessage?.trim() || globalMessage;
}

export function parseListParam(value: string | null | undefined): string[] {
  if (!value) return [];
  const trimmed = String(value).trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
      }
    } catch {
      // Fall through to delimited parsing.
    }
  }
  return trimmed
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseProductEstimateBatch(value: unknown): ProductEstimateBatchParseResult {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) {
    return { items: [], error: "invalid_batch" };
  }

  const rawItems = (value as { items: unknown[] }).items;
  if (rawItems.length > PRODUCT_ESTIMATE_BATCH_LIMIT) {
    return { items: [], error: "too_many_items" };
  }

  const seen = new Set<string>();
  const items: ProductEstimateBatchItem[] = [];
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return { items: [], error: "invalid_batch" };
    }
    const item = rawItem as Record<string, unknown>;
    const key = String(item.key ?? "").trim().toLowerCase();
    const productId = normalizeTargetValue("product", String(item.productId ?? ""));
    if (!productId || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(key)) {
      return { items: [], error: "invalid_batch" };
    }
    if (seen.has(key)) continue;

    const vendor = String(item.productVendor ?? "").trim().slice(0, 100) || null;
    const tags = Array.isArray(item.productTags)
      ? item.productTags.slice(0, 20).map((tag) => String(tag ?? "").trim().slice(0, 100)).filter(Boolean)
      : [];
    const collections = Array.isArray(item.collectionHandles)
      ? item.collectionHandles
          .slice(0, 20)
          .map((handle) => normalizeTargetValue("collection", String(handle ?? "")))
          .filter((handle): handle is string => Boolean(handle))
      : [];

    seen.add(key);
    items.push({
      key,
      productId,
      productVendor: vendor,
      productTags: [...new Set(tags)],
      collectionHandles: [...new Set(collections)],
    });
  }

  return { items, error: null };
}

export function productContextCacheKey(context: ProductTargetContext): string {
  const normalized = normalizeProductContext(context);
  const tags = [...normalized.tags].sort().join(",");
  const collections = [...normalized.collectionHandles].sort().join(",");
  return `${normalized.productId ?? ""}|${normalized.vendor ?? ""}|${tags}|${collections}`;
}
