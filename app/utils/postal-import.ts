export type PostalImportOptions = {
  serviceable?: boolean;
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
  ] as const) {
    const raw = value(...keys)?.toLowerCase();
    if (!raw) continue;
    if (["true", "1", "yes", "y", "on"].includes(raw)) options[field] = true;
    else if (["false", "0", "no", "n", "off"].includes(raw)) options[field] = false;
    else throw new Error("Boolean fields must use true/false, yes/no, or 1/0.");
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

export function importErrorCsvValue(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // eslint-disable-next-line no-control-regex -- Control prefixes can hide spreadsheet formulas.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
