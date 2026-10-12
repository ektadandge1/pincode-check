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

const DEFAULT_LOCALE = "en";

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

export function assertBusinessDaysAvailable(weekendDays: Set<number>): void {
  for (const day of weekendDays) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new RangeError("weekendDays must contain only integers from 0 through 6");
    }
  }
  if (weekendDays.size === 7) {
    throw new RangeError("weekendDays cannot close all seven weekdays");
  }
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
