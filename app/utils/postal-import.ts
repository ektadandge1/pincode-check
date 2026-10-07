export type PostalImportOptions = {
  serviceable?: boolean;
  codAvailable?: boolean;
  sameDayAvailable?: boolean;
  nextDayAvailable?: boolean;
  expressAvailable?: boolean;
  deliveryCharge?: number;
  currency?: string;
  city?: string;
  state?: string;
  zone?: string;
};

// Blank cells are omissions, not requests to reset existing values.
export function parsePostalImportOptions(row: Record<string, string>): PostalImportOptions {
  const options: PostalImportOptions = {};
  const value = (...keys: string[]) => keys.map((key) => row[key]?.trim()).find(Boolean);
  for (const [field, keys] of [
    ["serviceable", ["serviceable"]],
    ["codAvailable", ["cod_available", "codavailable"]],
    ["sameDayAvailable", ["same_day", "sameday"]],
    ["nextDayAvailable", ["next_day", "nextday"]],
    ["expressAvailable", ["express", "express_available", "expressavailable"]],
  ] as const) {
    const raw = value(...keys)?.toLowerCase();
    if (!raw) continue;
    if (["true", "1", "yes", "y", "on"].includes(raw)) options[field] = true;
    else if (["false", "0", "no", "n", "off"].includes(raw)) options[field] = false;
    else throw new Error("Boolean fields must use true/false, yes/no, or 1/0.");
  }
  const charge = value("delivery_charge", "deliverycharge");
  if (charge !== undefined) {
    const parsed = Number(charge);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error("Delivery charge must be a non-negative number.");
    }
    options.deliveryCharge = parsed;
  }
  const currency = value("currency")?.toUpperCase();
  if (currency) {
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a 3-letter code.");
    options.currency = currency;
  }
  for (const field of ["city", "state", "zone"] as const) {
    const raw = value(field);
    if (raw) options[field] = raw;
  }
  if (options.zone && options.zone.length > 60) {
    throw new Error("Zone name must be 60 characters or fewer.");
  }
  return options;
}

export function validateImportCurrency(
  options: PostalImportOptions,
  existing: { deliveryCharge: number | null; currency: string | null } | null,
): void {
  const charge = options.deliveryCharge ?? existing?.deliveryCharge ?? null;
  const currency = options.currency ?? existing?.currency ?? null;
  if (charge !== null && (!currency || !/^[A-Z]{3}$/.test(currency))) {
    throw new Error("Currency is required when delivery_charge is set.");
  }
}

export function importErrorCsvValue(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // eslint-disable-next-line no-control-regex -- Control prefixes can hide spreadsheet formulas.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
