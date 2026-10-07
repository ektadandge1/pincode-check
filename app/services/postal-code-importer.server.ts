import prisma from "../db.server";
import {
  parsePostalImportOptions,
  validateImportCurrency,
  type PostalImportOptions,
} from "../utils/postal-import";
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

type ValidatedPostalCodeData = PostalImportOptions & {
  shop: string;
  country: string;
  postalCode: string;
  patternType: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  zoneName?: string;
  deliveryDays: number;
};

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
  const deliveryDays = getDeliveryDays(row);
  let options: PostalImportOptions;
  try {
    options = parsePostalImportOptions(row);
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }

  if (patternType === "exact" && !validatePostalCode(country, postalCode)) {
    return { ok: false, reason: "Invalid postal code for country." };
  }

  if (!Number.isInteger(deliveryDays) || deliveryDays < 0 || deliveryDays > 60) {
    return { ok: false, reason: "Delivery days must be an integer from 0 to 60." };
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
      zoneName: options.zone,
      deliveryDays,
      ...options,
    },
  };
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
  const transactionOptions = { maxWait: 10_000, timeout: 10_000 };
  const recordFailure = async (row: CsvRow, index: number, reason: string) => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.importError.create({
          data: { importJobId: job.id, rowNumber: index + 2, rawRow: JSON.stringify(row), reason },
        });
        await tx.importJob.update({
          where: { id: job.id },
          data: {
            failedRows: { increment: 1 },
            status: successRows > 0 ? "partial" : "failed",
            errorSummary: `${failedRows + 1} rows failed.`,
          },
        });
      }, transactionOptions);
      failedRows += 1;
    } catch {
      throw new Error(`Import job ${job.id} stopped at row ${index + 2}: unable to persist the row failure. Previously committed progress is retained.`);
    }
  };

  for (const [index, row] of rows.entries()) {
    const validation = validateRow(row);
    if (!validation.ok) {
      await recordFailure(row, index, validation.reason);
      continue;
    }

    if (!policy.patterns && validation.data.patternType !== "exact") {
      await recordFailure(row, index, "ZIP ranges and wildcards require an active Standard subscription.");
      continue;
    }
    if (!policy.zones && validation.data.zoneName) {
      await recordFailure(row, index, "Zones require an active Standard subscription.");
      continue;
    }
    if (
      !policy.deliveryOptions &&
      (validation.data.deliveryCharge !== undefined ||
        validation.data.currency !== undefined ||
        validation.data.sameDayAvailable ||
        validation.data.nextDayAvailable ||
        validation.data.expressAvailable)
    ) {
      await recordFailure(row, index, "Delivery charges and speed options require an active Standard subscription.");
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const { zoneName, ...data } = { ...validation.data, shop };
        const where = {
          shop_country_postalCode: { shop, country: data.country, postalCode: data.postalCode },
        };
        const existing = await tx.postalCode.findUnique({
          where,
          select: { deliveryCharge: true, currency: true },
        });
        validateImportCurrency(data, existing);
        const zone = zoneName ? await tx.zone.upsert({
          where: { shop_name: { shop, name: zoneName } },
          create: { shop, name: zoneName, country: data.country },
          update: {},
        }) : null;
        const writeData = { ...data, ...(zone ? { zoneId: zone.id } : {}) };
        await tx.postalCode.upsert({ where, create: writeData, update: writeData });
        // Commit the row and its progress together, never one without the other.
        await tx.importJob.update({
          where: { id: job.id },
          data: { successRows: { increment: 1 }, status: "partial" },
        });
      }, transactionOptions);
      successRows += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown database error.";
      await recordFailure(row, index, `Row import failed: ${reason}`);
    }
  }

  const status = failedRows === 0 ? "completed" : successRows > 0 ? "partial" : "failed";
  try {
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status,
        successRows,
        failedRows,
        errorSummary: failedRows > 0 ? `${failedRows} rows failed.` : null,
      },
    });
  } catch {
    throw new Error(`Import job ${job.id} processed all rows but could not finalize its status. Row counts and errors are retained.`);
  }

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
