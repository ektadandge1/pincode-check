export type DeliveryComputationInput = {
  baseDays: number;
  cutoffHour24: number;
  holidays: Set<string>;
  weekendDays: Set<number>;
  now?: Date;
};

const DEFAULT_LOCALE = "en";

const POSTAL_CODE_PATTERNS: Record<string, RegExp> = {
  AU: /^\d{4}$/,
  CA: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/,
  DE: /^\d{5}$/,
  ES: /^\d{5}$/,
  FR: /^\d{5}$/,
  GB: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/,
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

  return /^[A-Z]{2}$/.test(normalized) ? normalized : "US";
}

export function normalizePostalCode(country: string, postalCode: string): string {
  const countryCode = normalizeCountryCode(country);
  const value = String(postalCode ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");

  if (["IN", "AU", "DE", "ES", "FR", "IT", "NZ"].includes(countryCode)) {
    return value.replace(/\D/g, "");
  }

  if (countryCode === "US") {
    return value.replace(/\s+/g, "");
  }

  if (countryCode === "JP") {
    return value.replace(/\s+/g, "");
  }

  return value;
}

export function validatePostalCode(country: string, postalCode: string): boolean {
  const countryCode = normalizeCountryCode(country);
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
  const values = csv
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);

  return new Set(values.length > 0 ? values : [0]);
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

export function computeEstimatedDate(input: DeliveryComputationInput): Date {
  const now = input.now ? new Date(input.now) : new Date();
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

export function formatReadableDate(date: Date, locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "2-digit",
    month: "short",
  }).format(date);
}
