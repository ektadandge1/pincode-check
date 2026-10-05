import prisma from "../db.server";
import { parseCsv, type CsvRow } from "../utils/csv.server";
import {
  normalizeCountryCode,
  parsePostalPattern,
  validatePostalCode,
} from "../utils/delivery.server";

type ImportSource = "csv" | "google_sheet";

export type PostalImportPolicy = {
  patterns: boolean;
  zones: boolean;
  deliveryOptions: boolean;
};

const FULL_IMPORT_POLICY: PostalImportPolicy = {
  patterns: true,
  zones: true,
  deliveryOptions: true,
};

type ImportResult = {
  jobId: number;
  totalRows: number;
  successRows: number;
  failedRows: number;
  status: "completed" | "failed" | "partial";
};

type ValidatedPostalCodeData = {
  shop: string;
  country: string;
  postalCode: string;
  patternType: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  zoneName: string | null;
  deliveryDays: number;
  serviceable: boolean;
  codAvailable: boolean;
  deliveryCharge: number | null;
  currency: string | null;
  sameDayAvailable: boolean;
  nextDayAvailable: boolean;
  expressAvailable: boolean;
  city: string | null;
  state: string | null;
  zone: string | null;
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return null;
}

function parseOptionalMoney(value: string | undefined): number | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function normalizeCurrency(value: string | undefined): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function getPostalCode(row: CsvRow): string {
  return String(row.postal_code ?? row.postalcode ?? row.pincode ?? "");
}

function getDeliveryDays(row: CsvRow): number {
  return Number(row.delivery_days ?? row.deliverydays ?? "");
}

function validateRow(row: CsvRow): { ok: true; data: ValidatedPostalCodeData } | { ok: false; reason: string } {
  const hasLegacyPincodeColumn = typeof row.pincode === "string" && !row.country;
  const rawCountry = String(row.country ?? (hasLegacyPincodeColumn ? "IN" : "")).trim();
  const rawDeliveryDays = String(row.delivery_days ?? row.deliverydays ?? "").trim();
  const rawPostalPattern = getPostalCode(row);
  if (!rawCountry) return { ok: false, reason: "Country is required." };
  if (!/^[A-Za-z]{2}$/.test(rawCountry)) return { ok: false, reason: "Country must be a 2-letter ISO code." };
  if (!rawDeliveryDays) return { ok: false, reason: "Delivery days is required." };

  const country = normalizeCountryCode(rawCountry);
  const explicitType = String(row.pattern_type ?? row.patterntype ?? "").trim().toLowerCase();
  const parsedPattern = parsePostalPattern(country, rawPostalPattern);
  if (!parsedPattern) {
    return {
      ok: false,
      reason: "Invalid postal pattern. Use a postal code, a range like 10000-10999, or a wildcard like 123*.",
    };
  }
  if (
    explicitType &&
    explicitType !== parsedPattern.type &&
    !(explicitType === "exact" && parsedPattern.type === "exact")
  ) {
    if (["exact", "range", "wildcard"].includes(explicitType) && explicitType !== parsedPattern.type) {
      return { ok: false, reason: `pattern_type "${explicitType}" does not match postal_code "${rawPostalPattern}".` };
    }
  }

  const postalCode = parsedPattern.pattern;
  const patternType = parsedPattern.type;
  const rangeStart = parsedPattern.type === "range" ? parsedPattern.start : null;
  const rangeEnd = parsedPattern.type === "range" ? parsedPattern.end : null;
  const zoneName = String(row.zone ?? "").trim() || null;
  const deliveryDays = getDeliveryDays(row);
  const deliveryCharge = parseOptionalMoney(row.delivery_charge ?? row.deliverycharge);
  const currency = normalizeCurrency(row.currency);
  const serviceable = parseBoolean(row.serviceable, true);
  const codAvailable = parseBoolean(row.cod_available ?? row.codavailable, false);
  const sameDayAvailable = parseBoolean(row.same_day ?? row.sameday, false);
  const nextDayAvailable = parseBoolean(row.next_day ?? row.nextday, false);
  const expressAvailable = parseBoolean(row.express ?? row.express_available ?? row.expressavailable, false);

  if (patternType === "exact" && !validatePostalCode(country, postalCode)) {
    return { ok: false, reason: "Invalid postal code for country." };
  }

  if (!Number.isInteger(deliveryDays) || deliveryDays < 0 || deliveryDays > 60) {
    return { ok: false, reason: "Delivery days must be an integer from 0 to 60." };
  }

  if (Number.isNaN(deliveryCharge)) {
    return { ok: false, reason: "Delivery charge must be a positive number." };
  }

  if (deliveryCharge !== null && !currency) {
    return { ok: false, reason: "Currency is required when delivery_charge is set." };
  }

  if ([serviceable, codAvailable, sameDayAvailable, nextDayAvailable, expressAvailable].includes(null)) {
    return { ok: false, reason: "Boolean fields must use true/false, yes/no, or 1/0." };
  }

  if (zoneName && zoneName.length > 60) {
    return { ok: false, reason: "Zone name must be 60 characters or fewer." };
  }

  return {
    ok: true,
    data: {
      shop: "",
      country,
      postalCode,
      patternType,
      rangeStart,
      rangeEnd,
      zoneName,
      deliveryDays,
      serviceable: serviceable as boolean,
      codAvailable: codAvailable as boolean,
      deliveryCharge,
      currency,
      sameDayAvailable: sameDayAvailable as boolean,
      nextDayAvailable: nextDayAvailable as boolean,
      expressAvailable: expressAvailable as boolean,
      city: String(row.city ?? "").trim() || null,
      state: String(row.state ?? "").trim() || null,
      zone: zoneName,
    },
  };
}

async function ensureZoneId(shop: string, zoneName: string | null, country: string): Promise<number | null> {
  if (!zoneName) return null;

  const existing = await prisma.zone.findUnique({
    where: { shop_name: { shop, name: zoneName } },
  });
  if (existing) return existing.id;

  const created = await prisma.zone.create({
    data: {
      shop,
      name: zoneName,
      country,
      priority: 100,
      enabled: true,
    },
  });
  return created.id;
}

export async function importPostalCodesFromCsv(
  shop: string,
  content: string,
  source: ImportSource,
  policy: PostalImportPolicy = FULL_IMPORT_POLICY,
): Promise<ImportResult> {
  if (content.length > 8 * 1024 * 1024) throw new Error("CSV should be smaller than 8MB.");
  const rows = parseCsv(content);
  if (rows.length === 0) throw new Error("CSV must include a header and at least one data row.");
  if (rows.length > 100_000) throw new Error("CSV cannot contain more than 100,000 data rows.");

  const headers = new Set(Object.keys(rows[0]));
  const hasPostalCode = headers.has("postal_code") || headers.has("postalcode") || headers.has("pincode");
  const hasDeliveryDays = headers.has("delivery_days") || headers.has("deliverydays");
  const legacyIndiaFormat = headers.has("pincode") && !headers.has("country");
  if (!hasPostalCode || !hasDeliveryDays || (!headers.has("country") && !legacyIndiaFormat)) {
    throw new Error("CSV requires country, postal_code, and delivery_days columns. Legacy pincode CSVs may omit country.");
  }
  const job = await prisma.importJob.create({
    data: {
      shop,
      source,
      status: "failed",
      totalRows: rows.length,
      successRows: 0,
      failedRows: 0,
    },
  });

  let successRows = 0;
  let failedRows = 0;
  const errors: Array<{ importJobId: number; rowNumber: number; rawRow: string; reason: string }> = [];

  for (const [index, row] of rows.entries()) {
    const validation = validateRow(row);
    if (!validation.ok) {
      failedRows += 1;
      errors.push({
        importJobId: job.id,
        rowNumber: index + 2,
        rawRow: JSON.stringify(row),
        reason: validation.reason,
      });
      continue;
    }

    if (!policy.patterns && validation.data.patternType !== "exact") {
      failedRows += 1;
      errors.push({
        importJobId: job.id,
        rowNumber: index + 2,
        rawRow: JSON.stringify(row),
        reason: "ZIP ranges and wildcards require an active Standard subscription.",
      });
      continue;
    }
    if (!policy.zones && validation.data.zoneName) {
      failedRows += 1;
      errors.push({
        importJobId: job.id,
        rowNumber: index + 2,
        rawRow: JSON.stringify(row),
        reason: "Zones require an active Standard subscription.",
      });
      continue;
    }
    if (
      !policy.deliveryOptions &&
      (validation.data.deliveryCharge !== null ||
        validation.data.sameDayAvailable ||
        validation.data.nextDayAvailable ||
        validation.data.expressAvailable)
    ) {
      failedRows += 1;
      errors.push({
        importJobId: job.id,
        rowNumber: index + 2,
        rawRow: JSON.stringify(row),
        reason: "Delivery charges and speed options require an active Standard subscription.",
      });
      continue;
    }

    const data = { ...validation.data, shop };
    const zoneId = await ensureZoneId(shop, data.zoneName, data.country);
    await prisma.postalCode.upsert({
      where: {
        shop_country_postalCode: {
          shop,
          country: data.country,
          postalCode: data.postalCode,
        },
      },
      create: {
        shop,
        country: data.country,
        postalCode: data.postalCode,
        patternType: data.patternType,
        rangeStart: data.rangeStart,
        rangeEnd: data.rangeEnd,
        zoneId,
        zone: data.zone,
        deliveryDays: data.deliveryDays,
        serviceable: data.serviceable,
        codAvailable: data.codAvailable,
        deliveryCharge: data.deliveryCharge,
        currency: data.currency,
        sameDayAvailable: data.sameDayAvailable,
        nextDayAvailable: data.nextDayAvailable,
        expressAvailable: data.expressAvailable,
        city: data.city,
        state: data.state,
      },
      update: {
        patternType: data.patternType,
        rangeStart: data.rangeStart,
        rangeEnd: data.rangeEnd,
        zoneId,
        deliveryDays: data.deliveryDays,
        serviceable: data.serviceable,
        codAvailable: data.codAvailable,
        deliveryCharge: data.deliveryCharge,
        currency: data.currency,
        sameDayAvailable: data.sameDayAvailable,
        nextDayAvailable: data.nextDayAvailable,
        expressAvailable: data.expressAvailable,
        city: data.city,
        state: data.state,
        zone: data.zone,
      },
    });
    successRows += 1;
  }

  if (errors.length > 0) {
    await prisma.importError.createMany({ data: errors });
  }

  const status = failedRows === 0 ? "completed" : successRows > 0 ? "partial" : "failed";
  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status,
      successRows,
      failedRows,
      errorSummary: failedRows > 0 ? `${failedRows} rows failed validation.` : null,
    },
  });

  return { jobId: job.id, totalRows: rows.length, successRows, failedRows, status };
}

export async function fetchGoogleSheetCsv(csvUrl: string): Promise<string> {
  const url = new URL(csvUrl);
  if (url.protocol !== "https:") {
    throw new Error("Google Sheet URL must use HTTPS.");
  }

  const allowedHost = url.hostname === "docs.google.com" || url.hostname === "drive.google.com";
  if (!allowedHost) {
    throw new Error("Use a published Google Sheets CSV URL.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error("Unable to fetch Google Sheet CSV.");
    }
    const text = await response.text();
    if (text.length > 8 * 1024 * 1024) {
      throw new Error("Google Sheet CSV is too large.");
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
