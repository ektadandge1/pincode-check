import prisma from "../db.server";
import { parseCsv, type CsvRow } from "../utils/csv.server";
import {
  normalizeCountryCode,
  normalizePostalCode,
  validatePostalCode,
} from "../utils/delivery.server";

type ImportSource = "csv" | "google_sheet";

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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
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
  const country = normalizeCountryCode(row.country ?? (hasLegacyPincodeColumn ? "IN" : "US"));
  const postalCode = normalizePostalCode(country, getPostalCode(row));
  const deliveryDays = getDeliveryDays(row);
  const deliveryCharge = parseOptionalMoney(row.delivery_charge ?? row.deliverycharge);
  const currency = normalizeCurrency(row.currency);

  if (!validatePostalCode(country, postalCode)) {
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

  return {
    ok: true,
    data: {
      shop: "",
      country,
      postalCode,
      deliveryDays,
      serviceable: parseBoolean(row.serviceable, true),
      codAvailable: parseBoolean(row.cod_available ?? row.codavailable, false),
      deliveryCharge,
      currency,
      sameDayAvailable: parseBoolean(row.same_day ?? row.sameday, false),
      nextDayAvailable: parseBoolean(row.next_day ?? row.nextday, false),
      expressAvailable: parseBoolean(row.express ?? row.express_available ?? row.expressavailable, false),
      city: String(row.city ?? "").trim() || null,
      state: String(row.state ?? "").trim() || null,
      zone: String(row.zone ?? "").trim() || null,
    },
  };
}

export async function importPostalCodesFromCsv(shop: string, content: string, source: ImportSource): Promise<ImportResult> {
  const rows = parseCsv(content).slice(0, 100_000);
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

    const data = { ...validation.data, shop };
    await prisma.postalCode.upsert({
      where: {
        shop_country_postalCode: {
          shop,
          country: data.country,
          postalCode: data.postalCode,
        },
      },
      create: data,
      update: {
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
