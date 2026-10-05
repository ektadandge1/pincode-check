export const DELIVERY_MESSAGE_SHORTCODES = [
  "min_delivery_date",
  "max_delivery_date",
  "delivery_date_range",
  "min_lead_days",
  "max_lead_days",
  "order_date",
  "dispatch_date_formatted",
  "date",
  "dispatch_date",
  "estimated_date",
  "estimated_date_max",
  "days",
  "processing_days",
  "transit_days",
  "cod_message",
  "delivery_charge_message",
  "delivery_charge",
  "currency",
  "country",
  "postal_code",
] as const;

export function renderDeliveryMessage(
  template: string,
  values: Record<string, string | number | null | undefined>,
): string {
  return template
    .replace(/\{([a-z_]+)(?:,\s*([^}]+))?\}/gi, (_match, rawKey: string, fallback?: string) => {
      const value = values[rawKey.toLowerCase()];
      return value === null || value === undefined ? String(fallback ?? "").trim() : String(value);
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function unsupportedDeliveryShortcodes(template: string): string[] {
  const supported = new Set<string>(DELIVERY_MESSAGE_SHORTCODES);
  return [...new Set(
    [...template.matchAll(/\{([a-z_]+)(?:,\s*[^}]+)?\}/gi)]
      .map((match) => match[1].toLowerCase())
      .filter((key) => !supported.has(key)),
  )];
}
