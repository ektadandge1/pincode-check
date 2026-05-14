export type DeliveryComputationInput = {
  baseDays: number;
  cutoffHour24: number;
  holidays: Set<string>;
  weekendDays: Set<number>;
  now?: Date;
};

const DEFAULT_LOCALE = "en-IN";

export function normalizePincode(pin: string): string {
  return pin.replace(/\D/g, "").trim();
}

export function validateIndianPincode(pin: string): boolean {
  return /^[1-9][0-9]{5}$/.test(pin);
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
