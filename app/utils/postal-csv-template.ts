export const POSTAL_CSV_TEMPLATE_HEADERS = [
  "country",
  "postal_code",
  "delivery_days",
  "serviceable",
  "city",
  "state",
  "zone",
] as const;

export function buildPostalCsvTemplate(): string {
  return `\uFEFF${POSTAL_CSV_TEMPLATE_HEADERS.join(",")}\r\n`;
}
