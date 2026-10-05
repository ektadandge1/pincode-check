export const POSTAL_CSV_TEMPLATE_HEADERS = [
  "country",
  "postal_code",
  "delivery_days",
  "serviceable",
  "cod_available",
  "delivery_charge",
  "currency",
  "city",
  "state",
  "zone",
  "same_day",
  "next_day",
  "express",
] as const;

export function buildPostalCsvTemplate(): string {
  return `\uFEFF${POSTAL_CSV_TEMPLATE_HEADERS.join(",")}\r\n`;
}
