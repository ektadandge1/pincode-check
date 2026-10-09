import { COUNTRY_CODES } from "./countries.ts";

export type DeliveryComputationInput = {
  baseDays: number;
  cutoffHour24: number;
  holidays: Set<string>;
  weekendDays: Set<number>;
  now?: Date;
};

export type DeliveryDetailsInput = {
  processingDays: number;
  transitDays: number;
  cutoffHour24: number;
  holidays: Set<string>;
  weekendDays: Set<number>;
  timeZone: string;
  now?: Date;
};

export type DeliveryDetails = {
  orderDate: Date;
  dispatchDate: Date;
  estimatedDate: Date;
  cutoffRemainingSeconds: number;
};

export const MAX_CART_DELIVERY_ITEMS = 250;
export const MAX_CART_DELIVERY_BYTES = 65_536;
// Shopify CartLine.quantity is a signed 32-bit GraphQL Int.
export const MAX_DELIVERY_QUANTITY = 2_147_483_647;

export function validDeliveryQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= 1 && value <= MAX_DELIVERY_QUANTITY;
}

export type CartDeliveryItemInput = {
  productId?: string;
  variantId?: string;
  quantity?: number;
  productVendor?: string;
  productTags?: string[];
  collectionHandles?: string[];
};

export type ParsedCartDeliveryItems = {
  provided: boolean;
  complete: boolean;
  items: CartDeliveryItemInput[];
  error?: "invalid_cart" | "cart_too_large";
};

export type AggregatedCartDeliveryItem = {
  item: CartDeliveryItemInput;
  itemCount: number;
};

export type DeliveryDateWindow = {
  estimated_date?: string;
  estimated_date_max?: string;
  estimated_date_label?: string;
  estimated_date_max_label?: string;
  dispatch_date?: string;
  dispatch_date_label?: string;
};

const DEFAULT_LOCALE = "en";

const POSTAL_CODE_PATTERNS: Record<string, RegExp> = {
  AU: /^\d{4}$/,
  CA: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/,
  DE: /^\d{5}$/,
  ES: /^\d{5}$/,
  FR: /^\d{5}$/,
  GB: /^(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/,
  IN: /^[1-9][0-9]{5}$/,
  IT: /^\d{5}$/,
  JP: /^\d{3}-?\d{4}$/,
  NL: /^\d{4}\s?[A-Z]{2}$/,
  NZ: /^\d{4}$/,
  US: /^\d{5}(-?\d{4})?$/,
};

export function normalizeCountryCode(country: string | null | undefined): string {
  const normalized = String(country ?? "")
    .trim()
    .toUpperCase();

  // Missing countries have historically defaulted to US in delivery callers.
  if (!normalized) return "US";
  if (normalized === "UK") return "GB";
  return normalized;
}

export function normalizePostalCode(country: string, postalCode: string): string {
  const countryCode = normalizeCountryCode(country);
  const value = String(postalCode ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");

  if (["IN", "AU", "DE", "ES", "FR", "IT", "NZ"].includes(countryCode)) {
    return value.replace(/\s+/g, "");
  }

  const compact = value.replace(/\s+/g, "");
  if (countryCode === "CA") {
    return compact.replace(/^([A-Z]\d[A-Z])(\d[A-Z]\d)$/, "$1 $2");
  }
  if (countryCode === "GB") {
    return compact.replace(/^(GIR|[A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/, "$1 $2");
  }
  if (countryCode === "NL") {
    return compact.replace(/^(\d{4})([A-Z]{2})$/, "$1 $2");
  }
  if (countryCode === "US") {
    return compact.replace(/^(\d{5})(\d{4})$/, "$1-$2");
  }
  if (countryCode === "JP") {
    return compact.replace(/^(\d{3})(\d{4})$/, "$1-$2");
  }

  return value;
}

/** Canonical first, then compact optional-separator keys for legacy exact rows. */
export function postalCodeLookupValues(country: string, code: string): string[] {
  const countryCode = normalizeCountryCode(country);
  const canonical = normalizePostalCode(countryCode, code);
  if (["CA", "GB", "NL", "JP", "US"].includes(countryCode)
    && validatePostalCode(countryCode, canonical)) {
    return [...new Set([canonical, canonical.replace(/[ -]/g, "")])];
  }
  return canonical ? [canonical] : [];
}

export function validatePostalCode(country: string, postalCode: string): boolean {
  const countryCode = normalizeCountryCode(country);
  if (!COUNTRY_CODES.has(countryCode)) return false;
  const normalized = normalizePostalCode(countryCode, postalCode);
  const pattern = POSTAL_CODE_PATTERNS[countryCode];

  if (pattern) {
    return pattern.test(normalized);
  }

  return /^[A-Z0-9][A-Z0-9 -]{1,18}[A-Z0-9]$/.test(normalized);
}

export function parseCsvToStringSet(csv: string): Set<string> {
  return new Set(
    csv
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function parseWeekendDays(csv: string): Set<number> {
  if (!csv.trim()) return new Set();
  const values = csv
    .split(",")
    .filter((item) => item.trim() !== "")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);

  return new Set(values.length > 0 ? values : [0]);
}

function assertBusinessDaysAvailable(weekendDays: Set<number>): void {
  for (const day of weekendDays) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new RangeError("weekendDays must contain only integers from 0 through 6");
    }
  }
  if (weekendDays.size === 7) {
    throw new RangeError("weekendDays cannot close all seven weekdays");
  }
}

export function toYyyyMmDd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isBusinessDay(
  date: Date,
  holidays: Set<string>,
  weekendDays: Set<number>,
): boolean {
  const day = date.getDay();
  if (weekendDays.has(day)) {
    return false;
  }

  return !holidays.has(toYyyyMmDd(date));
}

export function nextBusinessDay(
  date: Date,
  holidays: Set<string>,
  weekendDays: Set<number>,
): Date {
  assertBusinessDaysAvailable(weekendDays);
  const value = new Date(date);
  while (!isBusinessDay(value, holidays, weekendDays)) {
    value.setDate(value.getDate() + 1);
  }
  return value;
}

export function addBusinessDays(
  date: Date,
  days: number,
  holidays: Set<string>,
  weekendDays: Set<number>,
): Date {
  assertBusinessDaysAvailable(weekendDays);
  const value = new Date(date);
  let remaining = Math.max(0, days);

  while (remaining > 0) {
    value.setDate(value.getDate() + 1);
    if (isBusinessDay(value, holidays, weekendDays)) {
      remaining -= 1;
    }
  }

  return value;
}

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

type ZonedDateTime = CalendarDate & {
  hour: number;
  minute: number;
  second: number;
};

function assertDeliveryDetailsInput(input: DeliveryDetailsInput, now: Date): void {
  for (const [name, value] of [
    ["processingDays", input.processingDays],
    ["transitDays", input.transitDays],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative integer`);
    }
  }

  if (!Number.isInteger(input.cutoffHour24) || input.cutoffHour24 < 0 || input.cutoffHour24 > 23) {
    throw new RangeError("cutoffHour24 must be an integer from 0 through 23");
  }
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("now must be a valid Date");
  }
  assertBusinessDaysAvailable(input.weekendDays);

  // Constructing the formatter validates the IANA zone before any calculation.
  new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format(now);
}

function getZonedDateTime(date: Date, timeZone: string): ZonedDateTime {
  const parts = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function calendarDateToKey(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function calendarWeekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function isCalendarBusinessDay(
  date: CalendarDate,
  holidays: Set<string>,
  weekendDays: Set<number>,
): boolean {
  return !weekendDays.has(calendarWeekday(date)) && !holidays.has(calendarDateToKey(date));
}

function nextCalendarBusinessDay(
  date: CalendarDate,
  holidays: Set<string>,
  weekendDays: Set<number>,
): CalendarDate {
  let value = date;
  while (!isCalendarBusinessDay(value, holidays, weekendDays)) {
    value = addCalendarDays(value, 1);
  }
  return value;
}

function addCalendarBusinessDays(
  date: CalendarDate,
  days: number,
  holidays: Set<string>,
  weekendDays: Set<number>,
): CalendarDate {
  let value = date;
  let remaining = days;
  while (remaining > 0) {
    value = addCalendarDays(value, 1);
    if (isCalendarBusinessDay(value, holidays, weekendDays)) {
      remaining -= 1;
    }
  }
  return value;
}

function zonedCalendarDateToDate(date: CalendarDate, timeZone: string): Date {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let timestamp = target;

  // Resolve local midnight iteratively from Intl's zone projection. This accounts
  // for the offset in effect on that date, including daylight-saving changes.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const projected = getZonedDateTime(new Date(timestamp), timeZone);
    const projectedTimestamp = Date.UTC(
      projected.year,
      projected.month - 1,
      projected.day,
      projected.hour,
      projected.minute,
      projected.second,
    );
    const adjustment = target - projectedTimestamp;
    timestamp += adjustment;
    if (adjustment === 0) break;
  }

  return new Date(timestamp);
}

export function computeDeliveryDetails(input: DeliveryDetailsInput): DeliveryDetails {
  const orderDate = input.now ? new Date(input.now) : new Date();
  assertDeliveryDetailsInput(input, orderDate);

  const localOrder = getZonedDateTime(orderDate, input.timeZone);
  const secondsSinceMidnight =
    localOrder.hour * 60 * 60 + localOrder.minute * 60 + localOrder.second;
  const cutoffSeconds = input.cutoffHour24 * 60 * 60;
  const beforeCutoff = secondsSinceMidnight < cutoffSeconds;
  const cutoffRemainingSeconds = beforeCutoff
    ? Math.max(0, Math.ceil((cutoffSeconds * 1000 - (secondsSinceMidnight * 1000 + orderDate.getMilliseconds())) / 1000))
    : 0;

  const orderCalendarDate: CalendarDate = {
    year: localOrder.year,
    month: localOrder.month,
    day: localOrder.day,
  };
  const eligibleDate = nextCalendarBusinessDay(
    beforeCutoff ? orderCalendarDate : addCalendarDays(orderCalendarDate, 1),
    input.holidays,
    input.weekendDays,
  );
  const dispatchCalendarDate = addCalendarBusinessDays(
    eligibleDate,
    input.processingDays,
    input.holidays,
    input.weekendDays,
  );
  const estimatedCalendarDate = addCalendarBusinessDays(
    dispatchCalendarDate,
    input.transitDays,
    input.holidays,
    input.weekendDays,
  );

  return {
    orderDate,
    dispatchDate: zonedCalendarDateToDate(dispatchCalendarDate, input.timeZone),
    estimatedDate: zonedCalendarDateToDate(estimatedCalendarDate, input.timeZone),
    cutoffRemainingSeconds,
  };
}

export function computeEstimatedDate(input: DeliveryComputationInput): Date {
  const now = input.now ? new Date(input.now) : new Date();
  if (!Number.isInteger(input.baseDays) || input.baseDays < 0) {
    throw new RangeError("baseDays must be a non-negative integer");
  }
  if (!Number.isInteger(input.cutoffHour24) || input.cutoffHour24 < 0 || input.cutoffHour24 > 23) {
    throw new RangeError("cutoffHour24 must be an integer from 0 through 23");
  }
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("now must be a valid Date");
  }
  assertBusinessDaysAvailable(input.weekendDays);
  const dispatchDate = new Date(now);

  if (dispatchDate.getHours() >= input.cutoffHour24) {
    dispatchDate.setDate(dispatchDate.getDate() + 1);
  }

  const businessDispatchDate = nextBusinessDay(
    dispatchDate,
    input.holidays,
    input.weekendDays,
  );

  return addBusinessDays(
    businessDispatchDate,
    input.baseDays,
    input.holidays,
    input.weekendDays,
  );
}

export function formatReadableDate(
  date: Date,
  locale = DEFAULT_LOCALE,
  timeZone?: string,
  dateFormat = "weekday_day_month",
): string {
  if (dateFormat.startsWith("custom:")) {
    const pattern = dateFormat.slice(7);
    const parts = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const monthLong = new Intl.DateTimeFormat(locale, { month: "long", timeZone }).format(date);
    const monthShort = new Intl.DateTimeFormat(locale, { month: "short", timeZone }).format(date);
    const weekdayLong = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone }).format(date);
    const replacements: Record<string, string> = {
      YYYY: values.year ?? "",
      YY: (values.year ?? "").slice(-2),
      MMMM: monthLong,
      MMM: monthShort,
      MM: values.month ?? "",
      M: String(Number(values.month ?? "0")),
      DD: values.day ?? "",
      D: String(Number(values.day ?? "0")),
      dddd: weekdayLong,
      ddd: weekdayLong.slice(0, 3),
    };
    return pattern.replace(/YYYY|MMMM|dddd|MMM|ddd|YY|MM|DD|M|D/g, (token) => replacements[token]);
  }
  const options: Intl.DateTimeFormatOptions = dateFormat === "month_day"
    ? { month: "short", day: "2-digit", timeZone }
    : dateFormat === "day_month"
      ? { day: "2-digit", month: "short", timeZone }
      : dateFormat === "numeric"
        ? { day: "2-digit", month: "2-digit", year: "numeric", timeZone }
        : { weekday: "long", day: "2-digit", month: "short", timeZone };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatIsoDateInZone(date: Date, timeZone: string): string {
  const parts = getZonedDateTime(date, timeZone);
  return calendarDateToKey(parts);
}

function parseCartString(value: unknown, maxLength = 100): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return String(value).trim().slice(0, maxLength) || undefined;
}

function parseCartStringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return null;
  return value.slice(0, 20).map((entry) => entry.slice(0, 100));
}

export function parseCartDeliveryItems(value: string | null): ParsedCartDeliveryItems {
  if (value === null) return { provided: false, complete: true, items: [] };
  if (!value || value.length > MAX_CART_DELIVERY_BYTES
    || new TextEncoder().encode(value).byteLength > MAX_CART_DELIVERY_BYTES) {
    return {
      provided: true,
      complete: false,
      items: [],
      error: value ? "cart_too_large" : "invalid_cart",
    };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return { provided: true, complete: false, items: [], error: "invalid_cart" };
    }
    if (parsed.length > MAX_CART_DELIVERY_ITEMS) {
      return { provided: true, complete: false, items: [], error: "cart_too_large" };
    }

    const items: CartDeliveryItemInput[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return { provided: true, complete: false, items: [], error: "invalid_cart" };
      }
      const row = entry as Record<string, unknown>;
      const variantId = parseCartString(row.variantId);
      const quantity = typeof row.quantity === "string" && row.quantity.trim()
        ? Number(row.quantity) : row.quantity;
      const productTags = parseCartStringList(row.productTags);
      const collectionHandles = parseCartStringList(row.collectionHandles);
      if (!variantId || !validDeliveryQuantity(quantity)
        || productTags === null || collectionHandles === null) {
        return { provided: true, complete: false, items: [], error: "invalid_cart" };
      }
      items.push({
        productId: parseCartString(row.productId),
        variantId,
        quantity,
        productVendor: parseCartString(row.productVendor),
        productTags,
        collectionHandles,
      });
    }

    return {
      provided: true,
      complete: true,
      items,
    };
  } catch {
    return { provided: true, complete: false, items: [], error: "invalid_cart" };
  }
}

function mergeCartStrings(first: string[] | undefined, second: string[] | undefined): string[] {
  return [...new Set([...(first ?? []), ...(second ?? [])])];
}

export function aggregateCartDeliveryItems(items: CartDeliveryItemInput[]): AggregatedCartDeliveryItem[] {
  const aggregated: AggregatedCartDeliveryItem[] = [];
  const variantIndexes = new Map<string, number>();

  for (const item of items) {
    const variantId = item.variantId?.trim();
    const variantKey = variantId && /^(?:gid:\/\/shopify\/ProductVariant\/)?[0-9]+$/.test(variantId)
      ? variantId.replace(/^gid:\/\/shopify\/ProductVariant\//, "") : variantId;
    const existingIndex = variantKey ? variantIndexes.get(variantKey) : undefined;
    if (existingIndex === undefined) {
      if (variantKey) variantIndexes.set(variantKey, aggregated.length);
      aggregated.push({
        item: {
          ...item,
          variantId: variantId || undefined,
          quantity: Math.max(1, Math.floor(item.quantity ?? 1)),
          productTags: [...(item.productTags ?? [])],
          collectionHandles: [...(item.collectionHandles ?? [])],
        },
        itemCount: 1,
      });
      continue;
    }

    const existing = aggregated[existingIndex];
    existing.item.quantity = Math.min(
      Number.MAX_SAFE_INTEGER,
      (existing.item.quantity ?? 1) + Math.max(1, Math.floor(item.quantity ?? 1)),
    );
    existing.item.productTags = mergeCartStrings(existing.item.productTags, item.productTags);
    existing.item.collectionHandles = mergeCartStrings(existing.item.collectionHandles, item.collectionHandles);
    existing.itemCount += 1;
  }

  return aggregated;
}

export async function mapCartDeliveryItems<T>(
  items: CartDeliveryItemInput[],
  check: (entry: AggregatedCartDeliveryItem) => Promise<T>,
): Promise<T[]> {
  const aggregated = aggregateCartDeliveryItems(items);
  const results: T[] = [];
  // Preserve the old maximum fan-out while checking every line of larger carts.
  for (let offset = 0; offset < aggregated.length; offset += 20) {
    results.push(...await Promise.all(aggregated.slice(offset, offset + 20).map(check)));
  }
  return results;
}

function maxByIsoDate<T>(items: T[], value: (item: T) => string | undefined): T | undefined {
  return items.reduce<T | undefined>((latest, item) => {
    if (!value(item)) return latest;
    return !latest || String(value(item)).localeCompare(String(value(latest))) > 0 ? item : latest;
  }, undefined);
}

export function aggregateDeliveryDateWindow(results: DeliveryDateWindow[]): DeliveryDateWindow {
  const earliest = maxByIsoDate(results, (result) => result.estimated_date);
  const latest = maxByIsoDate(results, (result) => result.estimated_date_max ?? result.estimated_date);
  const dispatch = maxByIsoDate(results, (result) => result.dispatch_date);

  return {
    estimated_date: earliest?.estimated_date,
    estimated_date_label: earliest?.estimated_date_label,
    estimated_date_max: latest?.estimated_date_max ?? latest?.estimated_date,
    estimated_date_max_label: latest?.estimated_date_max_label ?? latest?.estimated_date_label,
    dispatch_date: dispatch?.dispatch_date,
    dispatch_date_label: dispatch?.dispatch_date_label,
  };
}

export type PostalPatternType = "exact" | "range" | "wildcard";

export type ParsedPostalPattern =
  | { type: "exact"; pattern: string }
  | { type: "range"; pattern: string; start: string; end: string }
  | { type: "wildcard"; pattern: string; regex: RegExp };

function compareRangeBounds(country: string, start: string, end: string): number | null {
  const startDigits = /^\d+$/.test(start);
  const endDigits = /^\d+$/.test(end);

  if (startDigits && endDigits) {
    const startNum = Number(start);
    const endNum = Number(end);
    if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) return null;
    if (startNum > endNum) return null;
    return 0;
  }

  if (start.length === end.length && start.length > 0) {
    if (start.localeCompare(end) > 0) return null;
    return 0;
  }

  if (!POSTAL_CODE_PATTERNS[country] && start.length > 0 && start.localeCompare(end) <= 0) {
    return 0;
  }

  return null;
}

function normalizePostalWildcardLiteral(country: string, value: string): string {
  const normalized = normalizePostalCode(country, value);
  if (["CA", "GB", "NL"].includes(country)) return normalized.replace(/\s/g, "");
  if (country === "JP" || country === "US") return normalized.replace(/[\s-]/g, "");
  return normalized;
}

export function parsePostalPattern(country: string, rawPattern: string): ParsedPostalPattern | null {
  const countryCode = normalizeCountryCode(country);
  if (!COUNTRY_CODES.has(countryCode)) return null;
  const pattern = String(rawPattern ?? "").trim().replace(/\s+/g, " ");
  if (!pattern) return null;

  if (pattern.includes("*")) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 *-]*$/.test(pattern) || pattern.replace(/\*/g, "").length < 2) {
      return null;
    }

    const normalizedPattern = pattern
      .split("*")
      .map((part) => normalizePostalWildcardLiteral(countryCode, part))
      .join("*");
    if (normalizedPattern.replace(/\*/g, "").length < 2) return null;
    const parts = normalizedPattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return {
      type: "wildcard",
      pattern: normalizedPattern,
      regex: new RegExp(`^${parts.join(".*")}$`, "i"),
    };
  }

  const explicitRange = pattern.match(/^(.+?)\s+-\s+(.+)$/);
  if (!explicitRange && validatePostalCode(countryCode, pattern)) {
    return { type: "exact", pattern: normalizePostalCode(countryCode, pattern) };
  }

  const rangeMatch = explicitRange ?? pattern.match(/^(.+?)-(.+)$/);
  if (rangeMatch) {
    const rawStart = rangeMatch[1].trim();
    const rawEnd = rangeMatch[2].trim();
    const start = normalizePostalCode(countryCode, rawStart);
    const end = normalizePostalCode(countryCode, rawEnd);

    if (!start || !end) return null;
    if (!validatePostalCode(countryCode, start) || !validatePostalCode(countryCode, end)) {
      return null;
    }
    if (compareRangeBounds(countryCode, start, end) === null) return null;

    // Preserve an unambiguous range delimiter for generic exact formats and
    // endpoints that already contain a postal-code hyphen.
    const delimiter = (explicitRange && !POSTAL_CODE_PATTERNS[countryCode])
      || start.includes("-") || end.includes("-") ? " - " : "-";
    return { type: "range", pattern: `${start}${delimiter}${end}`, start, end };
  }

  return null;
}

export function classifyPostalPattern(country: string, rawPattern: string): PostalPatternType | null {
  return parsePostalPattern(country, rawPattern)?.type ?? null;
}

export function validatePostalPattern(country: string, rawPattern: string): boolean {
  return parsePostalPattern(country, rawPattern) !== null;
}

export function matchesPostalPattern(
  parsed: ParsedPostalPattern,
  country: string,
  postalCode: string,
): boolean {
  const countryCode = normalizeCountryCode(country);
  if (!COUNTRY_CODES.has(countryCode)) return false;
  const value = normalizePostalCode(countryCode, postalCode);
  if (!value) return false;

  if (parsed.type === "exact") {
    return normalizePostalCode(countryCode, parsed.pattern) === value;
  }

  if (parsed.type === "wildcard") {
    const wildcard = parsePostalPattern(countryCode, parsed.pattern);
    const matchValue = normalizePostalWildcardLiteral(countryCode, value);
    return wildcard?.type === "wildcard" && wildcard.regex.test(matchValue);
  }

  const startDigits = /^\d+$/.test(parsed.start);
  const endDigits = /^\d+$/.test(parsed.end);
  const valueDigits = /^\d+$/.test(value);

  if (startDigits && endDigits && valueDigits) {
    const startNum = Number(parsed.start);
    const endNum = Number(parsed.end);
    const valueNum = Number(value);
    return valueNum >= startNum && valueNum <= endNum;
  }

  const minLength = Math.min(parsed.start.length, parsed.end.length);
  if (minLength === 0) return false;
  if (value.length < minLength) return false;

  const slice = value.slice(0, Math.max(parsed.start.length, parsed.end.length));
  if (slice.length < parsed.start.length || slice.length < parsed.end.length) {
    return slice >= parsed.start && slice <= parsed.end;
  }

  return slice >= parsed.start && slice <= parsed.end;
}

export function matchesPostalPatternsCsv(country: string, postalCode: string, csv: string): boolean {
  return csv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .some((pattern) => {
      const parsed = parsePostalPattern(country, pattern);
      return parsed ? matchesPostalPattern(parsed, country, postalCode) : false;
    });
}

export function postalPatternSpecificity(parsed: ParsedPostalPattern): number {
  if (parsed.type === "exact") return 3000;
  if (parsed.type === "wildcard") {
    const literalLength = parsed.pattern.replace(/\*/g, "").length;
    return 2000 + literalLength;
  }

  const startNum = Number(parsed.start);
  const endNum = Number(parsed.end);
  if (Number.isFinite(startNum) && Number.isFinite(endNum)) {
    const span = Math.max(1, endNum - startNum + 1);
    return 1000 + Math.max(0, 500 - Math.floor(Math.log10(span) * 50));
  }

  return 1000;
}
