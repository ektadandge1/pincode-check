import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  Autocomplete,
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  DataTable,
  DropZone,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  fetchGoogleSheetCsv,
  importPostalCodesFromCsv,
} from "../services/postal-code-importer.server";
import {
  normalizeCountryCode,
  parsePostalPattern,
} from "../utils/delivery.server";
import {
  normalizeActivationMode,
  normalizeInventoryMode,
  normalizeTargetKind,
  normalizeTargetValue,
} from "../utils/targeting.server";
import { resolvePlanAccess } from "../services/partner-api.server";
import { requireFeature } from "../services/plans.server";
import {
  DELIVERY_MESSAGE_SHORTCODES,
  renderDeliveryMessage,
  unsupportedDeliveryShortcodes,
} from "../utils/delivery-message";
import { regionsForCountry, suggestedRegions } from "../utils/regions";
import { compactCollectionName } from "../utils/target-display";
import { buildPostalCsvTemplate } from "../utils/postal-csv-template";

type ActionData = {
  ok: boolean;
  message: string;
  intent?: string;
  zoneId?: number;
  savedRules?: string[];
  postalRuleId?: number;
};

const COUNTRY_OPTIONS = [
  { label: "Australia", value: "AU" },
  { label: "Canada", value: "CA" },
  { label: "France", value: "FR" },
  { label: "Germany", value: "DE" },
  { label: "India", value: "IN" },
  { label: "Italy", value: "IT" },
  { label: "Japan", value: "JP" },
  { label: "Netherlands", value: "NL" },
  { label: "New Zealand", value: "NZ" },
  { label: "Spain", value: "ES" },
  { label: "United Kingdom", value: "GB" },
  { label: "United States", value: "US" },
];

const ISO_COUNTRY_CODES = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "),
);

const PROCESSING_DAY_OPTIONS = [
  { label: "Ships today (0 days)", value: "0" },
  { label: "Next business day (1 day)", value: "1" },
  { label: "Standard preparation (2 days)", value: "2" },
  { label: "3 business days", value: "3" },
  { label: "5 business days", value: "5" },
  { label: "Custom manufacturing (7 days)", value: "7" },
  { label: "10 business days", value: "10" },
  { label: "14 business days", value: "14" },
  { label: "21 business days", value: "21" },
  { label: "30 business days", value: "30" },
  { label: "60 business days", value: "60" },
];

const DELIVERY_WINDOW_OPTIONS = Array.from({ length: 15 }, (_, value) => ({
  label: value === 0 ? "Exact date (0 days)" : `${value} business ${value === 1 ? "day" : "days"}`,
  value: String(value),
}));

const FALLBACK_DAY_OPTIONS = Array.from({ length: 61 }, (_, value) => ({
  label: `${value} ${value === 1 ? "day" : "days"}`,
  value: String(value),
}));

const TIMEZONE_OPTIONS = [
  { label: "India (Asia/Kolkata)", value: "Asia/Kolkata" },
  { label: "United Arab Emirates (Asia/Dubai)", value: "Asia/Dubai" },
  { label: "Singapore (Asia/Singapore)", value: "Asia/Singapore" },
  { label: "United Kingdom (Europe/London)", value: "Europe/London" },
  { label: "Central Europe (Europe/Berlin)", value: "Europe/Berlin" },
  { label: "United States Eastern (America/New_York)", value: "America/New_York" },
  { label: "United States Central (America/Chicago)", value: "America/Chicago" },
  { label: "United States Pacific (America/Los_Angeles)", value: "America/Los_Angeles" },
  { label: "Australia Eastern (Australia/Sydney)", value: "Australia/Sydney" },
  { label: "Japan (Asia/Tokyo)", value: "Asia/Tokyo" },
  { label: "UTC", value: "UTC" },
];

const LOCALE_OPTIONS = [
  { label: "India (English) - en-IN", value: "en-IN" },
  { label: "India (Hindi) - hi-IN", value: "hi-IN" },
  { label: "United States - en-US", value: "en-US" },
  { label: "United Kingdom - en-GB", value: "en-GB" },
  { label: "Australia - en-AU", value: "en-AU" },
  { label: "Germany - de-DE", value: "de-DE" },
  { label: "France - fr-FR", value: "fr-FR" },
  { label: "Japan - ja-JP", value: "ja-JP" },
];

const CUTOFF_OPTIONS = Array.from({ length: 24 }, (_, value) => ({
  label: `${value === 0 ? "12" : value > 12 ? String(value - 12) : String(value)}:00 ${value < 12 ? "AM" : "PM"}`,
  value: String(value),
}));

const COURIER_TIMEOUT_OPTIONS = [
  { label: "1 second", value: "1000" },
  { label: "2 seconds (recommended)", value: "2000" },
  { label: "3 seconds", value: "3000" },
  { label: "5 seconds", value: "5000" },
  { label: "10 seconds", value: "10000" },
];

const RETRY_OPTIONS = [
  { label: "No retry", value: "0" },
  { label: "Retry once (recommended)", value: "1" },
  { label: "Retry twice", value: "2" },
  { label: "Retry 3 times", value: "3" },
];

const WEEKEND_OPTIONS = [
  { label: "Sunday only", value: "0" },
  { label: "Saturday and Sunday", value: "0,6" },
  { label: "Saturday only", value: "6" },
];

function withCurrentOption(options: Array<{ label: string; value: string }>, value: string) {
  return options.some((option) => option.value === value)
    ? options
    : [{ label: `Current value (${value || "none"})`, value }, ...options];
}

const LOCATION_SUGGESTIONS: Record<string, Array<{ state: string; cities: string[] }>> = {
  AU: [
    { state: "New South Wales", cities: ["Sydney", "Newcastle", "Wollongong"] },
    { state: "Victoria", cities: ["Melbourne", "Geelong"] },
    { state: "Queensland", cities: ["Brisbane", "Gold Coast"] },
  ],
  CA: [
    { state: "Ontario", cities: ["Toronto", "Ottawa", "Mississauga"] },
    { state: "Quebec", cities: ["Montreal", "Quebec City"] },
    { state: "British Columbia", cities: ["Vancouver", "Victoria"] },
  ],
  DE: [
    { state: "Bavaria", cities: ["Munich", "Nuremberg"] },
    { state: "Berlin", cities: ["Berlin"] },
    { state: "North Rhine-Westphalia", cities: ["Cologne", "Dusseldorf"] },
  ],
  ES: [
    { state: "Madrid", cities: ["Madrid"] },
    { state: "Catalonia", cities: ["Barcelona"] },
    { state: "Andalusia", cities: ["Seville", "Malaga"] },
  ],
  FR: [
    { state: "Ile-de-France", cities: ["Paris"] },
    { state: "Auvergne-Rhone-Alpes", cities: ["Lyon", "Grenoble"] },
    { state: "Provence-Alpes-Cote d'Azur", cities: ["Marseille", "Nice"] },
  ],
  GB: [
    { state: "England", cities: ["London", "Manchester", "Birmingham"] },
    { state: "Scotland", cities: ["Edinburgh", "Glasgow"] },
    { state: "Wales", cities: ["Cardiff", "Swansea"] },
  ],
  IN: [
    { state: "Maharashtra", cities: ["Pune", "Mumbai", "Nagpur", "Nashik", "Thane", "Kolhapur"] },
    { state: "Karnataka", cities: ["Bengaluru", "Mysuru", "Mangaluru"] },
    { state: "Delhi", cities: ["New Delhi", "Delhi"] },
    { state: "Gujarat", cities: ["Ahmedabad", "Surat", "Vadodara"] },
    { state: "Tamil Nadu", cities: ["Chennai", "Coimbatore", "Madurai"] },
    { state: "Telangana", cities: ["Hyderabad", "Warangal"] },
    { state: "West Bengal", cities: ["Kolkata", "Siliguri"] },
    { state: "Uttar Pradesh", cities: ["Lucknow", "Noida", "Varanasi"] },
  ],
  IT: [
    { state: "Lazio", cities: ["Rome"] },
    { state: "Lombardy", cities: ["Milan", "Bergamo"] },
    { state: "Campania", cities: ["Naples", "Salerno"] },
  ],
  JP: [
    { state: "Tokyo", cities: ["Tokyo"] },
    { state: "Osaka", cities: ["Osaka"] },
    { state: "Kanagawa", cities: ["Yokohama", "Kawasaki"] },
  ],
  NL: [
    { state: "North Holland", cities: ["Amsterdam", "Haarlem"] },
    { state: "South Holland", cities: ["Rotterdam", "The Hague"] },
    { state: "Utrecht", cities: ["Utrecht"] },
  ],
  NZ: [
    { state: "Auckland", cities: ["Auckland"] },
    { state: "Wellington", cities: ["Wellington"] },
    { state: "Canterbury", cities: ["Christchurch"] },
  ],
  US: [
    { state: "California", cities: ["Los Angeles", "San Francisco", "San Diego"] },
    { state: "New York", cities: ["New York City", "Buffalo", "Rochester"] },
    { state: "Texas", cities: ["Houston", "Dallas", "Austin"] },
    { state: "Florida", cities: ["Miami", "Orlando", "Tampa"] },
  ],
};

function locationOptions(country: string, state?: string) {
  const locations = LOCATION_SUGGESTIONS[country] ?? [];
  return locations
    .filter((location) => !state || location.state === state)
    .flatMap((location) => location.cities.map((city) => ({ label: city, value: city })));
}

function stateForCity(country: string, city: string): string {
  return LOCATION_SUGGESTIONS[country]?.find((location) => location.cities.includes(city))?.state ?? "";
}

function parseBool(value: FormDataEntryValue | null): boolean {
  const normalized = String(value ?? "").toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const DATE_FORMAT_OPTIONS = [
  { label: "Wednesday, 11 Jun", value: "weekday_day_month" },
  { label: "Jun 11", value: "month_day" },
  { label: "11 Jun", value: "day_month" },
  { label: "25/11/2020", value: "numeric" },
  { label: "Custom format", value: "custom" },
];

function isValidCustomDatePattern(pattern: string): boolean {
  if (!pattern || pattern.length > 50) return false;
  const remainder = pattern.replace(/YYYY|MMMM|dddd|MMM|ddd|YY|MM|DD|M|D/g, "");
  return /^[\s,./-]*$/.test(remainder);
}

function previewDate(locale: string, days = 5, dateFormat = "weekday_day_month"): string {
  try {
    if (dateFormat.startsWith("custom:")) {
      const date = new Date(Date.now() + days * 86_400_000);
      const pattern = dateFormat.slice(7);
      const numeric = Object.fromEntries(new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
        year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(date).map((part) => [part.type, part.value]));
      const monthLong = new Intl.DateTimeFormat(locale || "en", { month: "long" }).format(date);
      const monthShort = new Intl.DateTimeFormat(locale || "en", { month: "short" }).format(date);
      const weekday = new Intl.DateTimeFormat(locale || "en", { weekday: "long" }).format(date);
      const replacements: Record<string, string> = {
        YYYY: numeric.year, YY: numeric.year.slice(-2), MMMM: monthLong, MMM: monthShort,
        MM: numeric.month, M: String(Number(numeric.month)), DD: numeric.day,
        D: String(Number(numeric.day)), dddd: weekday, ddd: weekday.slice(0, 3),
      };
      return pattern.replace(/YYYY|MMMM|dddd|MMM|ddd|YY|MM|DD|M|D/g, (token) => replacements[token]);
    }
    const options: Intl.DateTimeFormatOptions = dateFormat === "month_day"
      ? { month: "short", day: "2-digit" }
      : dateFormat === "day_month"
        ? { day: "2-digit", month: "short" }
        : dateFormat === "numeric"
          ? { day: "2-digit", month: "2-digit", year: "numeric" }
          : { weekday: "long", day: "2-digit", month: "short" };
    return new Intl.DateTimeFormat(locale || "en", options).format(new Date(Date.now() + days * 86_400_000));
  } catch {
    return "Friday, Oct 02";
  }
}

function previewIsoDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const ETA_MESSAGE_TEMPLATES = [
  { label: "Choose a ready template", value: "" },
  { label: "Delivery date range", value: "Receive your order between {min_delivery_date} and {max_delivery_date}. {cod_message}{delivery_charge_message}" },
  { label: "Promised delivery date", value: "Get it by {max_delivery_date}. {cod_message}{delivery_charge_message}" },
  { label: "Order to doorstep", value: "Order on {order_date}, ships by {dispatch_date_formatted}, and arrives between {min_delivery_date} and {max_delivery_date}." },
  { label: "Dates and lead days", value: "Estimated delivery: {delivery_date_range} ({min_lead_days}-{max_lead_days} business days)." },
];

const SHORTCODE_OPTIONS = [
  { label: "Insert dynamic value", value: "" },
  ...DELIVERY_MESSAGE_SHORTCODES.map((shortcode) => ({
    label: `{${shortcode}}`,
    value: shortcode,
  })),
];

const ETA_DAY_PRESETS = [
  { label: "Custom value", value: "custom" },
  { label: "Ships immediately · 0 days", value: "0" },
  { label: "Standard preparation · 2 days", value: "2" },
  { label: "Custom manufacturing · 7 days", value: "7" },
];

function hasCourierIntegrationConfig() {
  return Boolean(
    process.env.SHIPROCKET_EMAIL &&
      process.env.SHIPROCKET_PASSWORD &&
      process.env.SHIPROCKET_PICKUP_PINCODE,
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const access = await resolvePlanAccess({ shop, admin });

  const setting =
    (await prisma.deliverySetting.findUnique({ where: { shop } })) ??
    (await prisma.deliverySetting.findUnique({ where: { shop: "default" } }));

  const rows = await prisma.postalCode.findMany({
    where: { shop },
    orderBy: [{ country: "asc" }, { patternType: "asc" }, { postalCode: "asc" }],
    take: 150,
    include: {
      zoneGroup: { select: { id: true, name: true, priority: true, enabled: true } },
    },
  });

  const zones = await prisma.zone.findMany({
    where: { shop },
    orderBy: [{ priority: "asc" }, { name: "asc" }],
    include: { _count: { select: { postalCodes: true } } },
  });

  const totalPatterns = await prisma.postalCode.count({ where: { shop } });
  const patternCount = await prisma.postalCode.count({
    where: { shop, patternType: { not: "exact" } },
  });
  const targets = await prisma.deliveryTarget.findMany({
    where: { shop },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    take: 200,
  });
  const targetCount = await prisma.deliveryTarget.count({ where: { shop } });

  const recentImports = await prisma.importJob.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  let collections: Array<{ id: string; title: string; handle: string }> = [];
  let products: Array<{ id: string; title: string; handle: string }> = [];
  try {
    const response = await admin.graphql(`#graphql
      query DeliverySettingsCatalog {
        collections(first: 100, sortKey: TITLE) {
          nodes { id title handle }
        }
        products(first: 100, sortKey: TITLE) {
          nodes { id title handle }
        }
      }
    `);
    if (response.ok) {
      const json = await response.json() as { data?: {
        collections?: { nodes?: Array<{ id: string; title: string; handle: string }> };
        products?: { nodes?: Array<{ id: string; title: string; handle: string }> };
      } };
      collections = json.data?.collections?.nodes ?? [];
      products = json.data?.products?.nodes ?? [];
    }
  } catch {
    collections = [];
    products = [];
  }

    return {
      shop,
      apiKey: process.env.SHOPIFY_API_KEY || "",
      courierIntegrationAvailable: hasCourierIntegrationConfig(),
    setting: setting ?? {
      cutoffHour24: 14,
      processingDays: 0,
      deliveryWindowDays: 2,
      dateFormat: "weekday_day_month",
      timeZone: "UTC",
      locale: "en",
      holidaysCsv: "",
      fallbackDays: 5,
      courierEnabled: false,
      dbFallbackEnabled: true,
      inventoryAwareEnabled: false,
      weekendDaysCsv: "0",
      courierTimeoutMs: 2000,
      retryCount: 1,
      disableAddToCart: false,
      requireValidPin: false,
      successMessage: "Receive your order between {min_delivery_date} and {max_delivery_date}. {cod_message}{delivery_charge_message}",
      unavailableMessage: "Sorry, delivery is not available for this postal code.",
      codAvailableMessage: "COD available.",
      codUnavailableMessage: "Prepaid only.",
      deliveryChargeMessage: " Delivery charge: {currency}{delivery_charge}.",
      googleSheetCsvUrl: "",
      lastGoogleSheetSyncAt: null,
      lastGoogleSheetSyncStatus: null,
    },
    samplePostalCodes: rows,
    zones,
    targets,
    targetCount,
    products,
    totalPatterns,
    patternCount,
    recentImports,
    collections,
    access,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const access = await resolvePlanAccess({ shop, admin });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save_settings") {
    const cutoffHour24 = Number(formData.get("cutoffHour24") ?? 14);
    const processingDays = Number(formData.get("processingDays") ?? 0);
    const fallbackDays = Number(formData.get("fallbackDays") ?? 5);
    const deliveryWindowDays = Number(formData.get("deliveryWindowDays") ?? 2);
    const dateFormat = String(formData.get("dateFormat") ?? "weekday_day_month");
    const timeZone = String(formData.get("timeZone") ?? "UTC").trim();
    const locale = String(formData.get("locale") ?? "en").trim();
    const courierEnabled = hasCourierIntegrationConfig()
      ? parseBool(formData.get("courierEnabled"))
      : false;
    const dbFallbackEnabled = parseBool(formData.get("dbFallbackEnabled"));
    const inventoryAwareEnabled = parseBool(formData.get("inventoryAwareEnabled"));
    const disableAddToCart = parseBool(formData.get("disableAddToCart"));
    const requireValidPin = parseBool(formData.get("requireValidPin"));
    const weekendDays = String(formData.get("weekendDaysCsv") ?? "0")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const weekendDaysCsv = [...new Set(weekendDays)].sort().join(",") || "0";
    const courierTimeoutMs = Number(formData.get("courierTimeoutMs") ?? 2000);
    const retryCount = Number(formData.get("retryCount") ?? 1);
    const successMessage = String(formData.get("successMessage") ?? "").trim();
    const unavailableMessage = String(formData.get("unavailableMessage") ?? "").trim();
    const codAvailableMessage = String(formData.get("codAvailableMessage") ?? "").trim();
    const codUnavailableMessage = String(formData.get("codUnavailableMessage") ?? "").trim();
    const deliveryChargeMessage = String(formData.get("deliveryChargeMessage") ?? "").trim();

    if (!Number.isInteger(cutoffHour24) || cutoffHour24 < 0 || cutoffHour24 > 23) {
      return { ok: false, message: "Cutoff hour must be an integer from 0 to 23." } satisfies ActionData;
    }
    if (!Number.isInteger(processingDays) || processingDays < 0 || processingDays > 60) {
      return { ok: false, message: "Processing days must be an integer from 0 to 60." } satisfies ActionData;
    }
    if (!Number.isInteger(fallbackDays) || fallbackDays < 0 || fallbackDays > 60) {
      return { ok: false, message: "Default transit days must be an integer from 0 to 60." } satisfies ActionData;
    }
    if (!Number.isInteger(deliveryWindowDays) || deliveryWindowDays < 0 || deliveryWindowDays > 14) {
      return { ok: false, message: "Delivery window must be an integer from 0 to 14 business days." } satisfies ActionData;
    }
    const customDatePattern = dateFormat.startsWith("custom:") ? dateFormat.slice(7) : "";
    if (!DATE_FORMAT_OPTIONS.some((option) => option.value === dateFormat) && !isValidCustomDatePattern(customDatePattern)) {
      return { ok: false, message: "Choose a supported date format." } satisfies ActionData;
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format();
    } catch {
      return { ok: false, message: "Enter a valid IANA timezone, such as Asia/Kolkata or America/New_York." } satisfies ActionData;
    }
    try {
      new Intl.DateTimeFormat(locale).format();
    } catch {
      return { ok: false, message: "Enter a valid locale, such as en, hi-IN, or de-DE." } satisfies ActionData;
    }
    if (weekendDays.some((value) => !/^[0-6]$/.test(value))) {
      return { ok: false, message: "Weekend days must contain values from 0 (Sunday) to 6 (Saturday)." } satisfies ActionData;
    }
    if (new Set(weekendDays).size === 7) {
      return { ok: false, message: "At least one delivery day is required. You cannot mark all seven days as weekends." } satisfies ActionData;
    }
    if (!Number.isInteger(courierTimeoutMs) || courierTimeoutMs < 500 || courierTimeoutMs > 15_000) {
      return { ok: false, message: "Courier timeout must be an integer from 500 to 15000 milliseconds." } satisfies ActionData;
    }
    if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 3) {
      return { ok: false, message: "Retry count must be an integer from 0 to 3." } satisfies ActionData;
    }
    const messages = [successMessage, unavailableMessage, codAvailableMessage, codUnavailableMessage, deliveryChargeMessage];
    if (access.features.customMessages && messages.some((message) => !message || message.length > 500)) {
      return { ok: false, message: "Storefront messages are required and must be 500 characters or fewer." } satisfies ActionData;
    }
    const unsupportedShortcodes = unsupportedDeliveryShortcodes(successMessage);
    if (access.features.customMessages && unsupportedShortcodes.length > 0) {
      return { ok: false, message: `Unsupported ETA values: ${unsupportedShortcodes.map((key) => `{${key}}`).join(", ")}.` } satisfies ActionData;
    }

    const advancedSettings = access.features.customMessages
      ? {
          courierEnabled,
          inventoryAwareEnabled,
          disableAddToCart,
          requireValidPin,
          successMessage,
          unavailableMessage,
          codAvailableMessage,
          codUnavailableMessage,
          deliveryChargeMessage,
        }
      : {};

    await prisma.deliverySetting.upsert({
      where: { shop },
      create: {
        shop,
        cutoffHour24,
        processingDays,
        fallbackDays,
        deliveryWindowDays,
        dateFormat,
        timeZone,
        locale,
        dbFallbackEnabled,
        weekendDaysCsv,
        courierTimeoutMs,
        retryCount,
        holidaysCsv: "",
        ...advancedSettings,
      },
      update: {
        cutoffHour24,
        processingDays,
        fallbackDays,
        deliveryWindowDays,
        dateFormat,
        timeZone,
        locale,
        dbFallbackEnabled,
        weekendDaysCsv,
        courierTimeoutMs,
        retryCount,
        ...advancedSettings,
      },
    });

    return { ok: true, message: "Settings saved." } satisfies ActionData;
  }

  if (intent === "save_google_sheet") {
    requireFeature(access, "googleSheets");
    const googleSheetCsvUrl = String(formData.get("googleSheetCsvUrl") ?? "").trim() || null;
    if (googleSheetCsvUrl) {
      try {
        const url = new URL(googleSheetCsvUrl);
        if (url.protocol !== "https:" || !["docs.google.com", "drive.google.com"].includes(url.hostname)) {
          return { ok: false, message: "Use a published HTTPS Google Sheets CSV URL." } satisfies ActionData;
        }
      } catch {
        return { ok: false, message: "Enter a valid Google Sheets CSV URL." } satisfies ActionData;
      }
    }

    await prisma.deliverySetting.upsert({
      where: { shop },
      update: { googleSheetCsvUrl },
      create: { shop, googleSheetCsvUrl },
    });

    return { ok: true, message: "Google Sheet URL saved." } satisfies ActionData;
  }

  if (intent === "sync_google_sheet") {
    requireFeature(access, "googleSheets");
    const setting = await prisma.deliverySetting.findUnique({ where: { shop } });
    if (!setting?.googleSheetCsvUrl) {
      return { ok: false, message: "Save a Google Sheet CSV URL first." } satisfies ActionData;
    }

    try {
      const csv = await fetchGoogleSheetCsv(setting.googleSheetCsvUrl);
      const result = await importPostalCodesFromCsv(shop, csv, "google_sheet", access.features);
      await prisma.deliverySetting.update({
        where: { shop },
        data: {
          lastGoogleSheetSyncAt: new Date(),
          lastGoogleSheetSyncStatus: result.status,
        },
      });
      return {
        ok: result.status !== "failed",
        message: `Google Sheet sync ${result.status}. Success: ${result.successRows}, Failed: ${result.failedRows}.`,
      } satisfies ActionData;
    } catch (error) {
      await prisma.deliverySetting.update({
        where: { shop },
        data: {
          lastGoogleSheetSyncAt: new Date(),
          lastGoogleSheetSyncStatus: "failed",
        },
      });
      return { ok: false, message: error instanceof Error ? error.message : "Google Sheet sync failed." } satisfies ActionData;
    }
  }

  if (intent === "add_holiday") {
    const holiday = String(formData.get("holidayDate") ?? "").trim();
    if (!isValidIsoDate(holiday)) {
      return { ok: false, message: "Enter a real holiday date in YYYY-MM-DD format." } satisfies ActionData;
    }

    const setting =
      (await prisma.deliverySetting.findUnique({ where: { shop } })) ??
      (await prisma.deliverySetting.upsert({
        where: { shop },
        update: {},
        create: { shop, holidaysCsv: "" },
      }));

    const set = new Set(setting.holidaysCsv.split(",").map((x) => x.trim()).filter(Boolean));
    set.add(holiday);

    await prisma.deliverySetting.update({
      where: { shop },
      data: { holidaysCsv: [...set].sort().join(",") },
    });

    return { ok: true, message: "Holiday added." } satisfies ActionData;
  }

  if (intent === "remove_holiday") {
    const holiday = String(formData.get("holidayDate") ?? "").trim();
    const setting = await prisma.deliverySetting.findUnique({ where: { shop } });
    if (!setting) {
      return { ok: false, message: "No settings found for this shop." } satisfies ActionData;
    }

    const set = new Set(setting.holidaysCsv.split(",").map((x) => x.trim()).filter(Boolean));
    set.delete(holiday);

    await prisma.deliverySetting.update({
      where: { shop },
      data: { holidaysCsv: [...set].sort().join(",") },
    });

    return { ok: true, message: "Holiday removed." } satisfies ActionData;
  }

  if (intent === "create_zone") {
    requireFeature(access, "zones");
    const name = String(formData.get("zoneName") ?? "").trim();
    const countryRaw = String(formData.get("zoneCountry") ?? "").trim();
    const priority = Number(formData.get("zonePriority") ?? 100);

    if (!name || name.length > 60) {
      return { ok: false, message: "Zone name is required and must be 60 characters or fewer." } satisfies ActionData;
    }
    if (countryRaw && !ISO_COUNTRY_CODES.has(countryRaw.toUpperCase())) {
      return { ok: false, message: "Zone country must be a 2-letter ISO code or blank." } satisfies ActionData;
    }
    if (!Number.isInteger(priority) || priority < 0 || priority > 9999) {
      return { ok: false, message: "Zone priority must be an integer from 0 to 9999 (lower wins)." } satisfies ActionData;
    }

    const existing = await prisma.zone.findUnique({
      where: { shop_name: { shop, name } },
    });
    if (existing) {
      return { ok: false, message: "A zone with this name already exists for this shop." } satisfies ActionData;
    }

    await prisma.zone.create({
      data: {
        shop,
        name,
        country: countryRaw ? countryRaw.toUpperCase() : null,
        priority,
        enabled: true,
      },
    });

    return { ok: true, message: `Zone "${name}" created.`, intent: "create_zone" } satisfies ActionData;
  }

  if (intent === "delete_zone") {
    requireFeature(access, "zones");
    const zoneId = Number(formData.get("zoneId") ?? 0);
    const zone = await prisma.zone.findFirst({ where: { id: zoneId, shop } });
    if (!zone) {
      return { ok: false, message: "Zone not found." } satisfies ActionData;
    }

    await prisma.postalCode.updateMany({
      where: { zoneId },
      data: { zoneId: null },
    });
    await prisma.zone.delete({ where: { id: zoneId } });

    return { ok: true, message: `Zone "${zone.name}" deleted. Its postal rules were kept.`, intent: "delete_zone", zoneId } satisfies ActionData;
  }

  if (intent === "toggle_zone") {
    requireFeature(access, "zones");
    const zoneId = Number(formData.get("zoneId") ?? 0);
    const zone = await prisma.zone.findFirst({ where: { id: zoneId, shop } });
    if (!zone) {
      return { ok: false, message: "Zone not found." } satisfies ActionData;
    }

    await prisma.zone.update({
      where: { id: zoneId },
      data: { enabled: !zone.enabled },
    });

    return {
      ok: true,
      message: `Zone "${zone.name}" ${zone.enabled ? "disabled" : "enabled"}.`,
      intent: "toggle_zone",
      zoneId,
    } satisfies ActionData;
  }

  if (intent === "create_target" || intent === "update_target") {
    requireFeature(access, "targeting");
    const targetId = intent === "update_target" ? Number(formData.get("targetId") ?? 0) : null;
    const name = String(formData.get("targetName") ?? "").trim();
    const kindRaw = String(formData.get("targetKind") ?? "").trim();
    const valueRaw = String(formData.get("targetValue") ?? "").trim();
    const priority = Number(formData.get("targetPriority") ?? 100);
    const requireValidPin = parseBool(formData.get("targetRequireValidPin"));
    const excluded = parseBool(formData.get("targetExcluded"));
    const processingDaysRaw = String(formData.get("targetProcessingDays") ?? "").trim();
    const transitDaysRaw = String(formData.get("targetTransitDays") ?? "").trim();
    const processingDays = processingDaysRaw ? Number(processingDaysRaw) : null;
    const transitDays = transitDaysRaw ? Number(transitDaysRaw) : null;
    const countryRaw = String(formData.get("targetCountryCode") ?? "").trim();
    const countryCode = countryRaw.toUpperCase() || null;
    const stateRegion = String(formData.get("targetStateRegion") ?? "").trim() || null;
    const inventoryMode = normalizeInventoryMode(String(formData.get("targetInventoryMode") ?? "any"));
    const customSuccessMessage = String(formData.get("targetCustomSuccessMessage") ?? "").trim() || null;
    const activationMode = normalizeActivationMode(String(formData.get("targetActivationMode") ?? "always"));
    const activeFromLocalRaw = String(formData.get("targetActiveFromLocal") ?? "").trim();
    const activeUntilLocalRaw = String(formData.get("targetActiveUntilLocal") ?? "").trim();
    const weekdays = [...new Set(
      String(formData.get("targetWeekdaysCsv") ?? "")
        .split(",")
        .map((day) => day.trim())
        .filter(Boolean),
    )].sort();
    const startTimeLocalRaw = String(formData.get("targetStartTimeLocal") ?? "").trim();
    const endTimeLocalRaw = String(formData.get("targetEndTimeLocal") ?? "").trim();

    if (!name || name.length > 60) {
      return { ok: false, message: "Rule name is required and must be 60 characters or fewer." } satisfies ActionData;
    }
    if (targetId !== null && (!Number.isInteger(targetId) || targetId <= 0)) {
      return { ok: false, message: "The selected targeting rule is invalid." } satisfies ActionData;
    }
    const kind = normalizeTargetKind(kindRaw);
    if (!kind) {
      return { ok: false, message: "Target kind must be product, collection, vendor, or tag." } satisfies ActionData;
    }
    const value = normalizeTargetValue(kind, valueRaw);
    if (!value) {
      const hint =
        kind === "product"
          ? "Enter a numeric product ID (or product handle URL id)."
          : kind === "collection"
            ? "Enter a collection handle such as sale-items."
            : kind === "vendor"
              ? "Enter the product vendor name."
              : "Enter a product tag.";
      return { ok: false, message: hint } satisfies ActionData;
    }
    if (!Number.isInteger(priority) || priority < 0 || priority > 9999) {
      return { ok: false, message: "Priority must be an integer from 0 to 9999 (lower wins)." } satisfies ActionData;
    }
    if ([processingDays, transitDays].some((days) => days !== null && (!Number.isInteger(days) || days < 0 || days > 60))) {
      return { ok: false, message: "ETA override days must be integers from 0 to 60, or left blank." } satisfies ActionData;
    }
    if (countryRaw && !ISO_COUNTRY_CODES.has(countryCode ?? "")) {
      return { ok: false, message: "Country must be blank or a 2-letter ISO country code." } satisfies ActionData;
    }
    if (stateRegion && stateRegion.length > 100) {
      return { ok: false, message: "State or region must be 100 characters or fewer." } satisfies ActionData;
    }
    if (!inventoryMode) {
      return { ok: false, message: "Choose a supported inventory condition." } satisfies ActionData;
    }
    if (customSuccessMessage && customSuccessMessage.length > 500) {
      return { ok: false, message: "Custom success message must be 500 characters or fewer." } satisfies ActionData;
    }
    const unsupportedShortcodes = unsupportedDeliveryShortcodes(customSuccessMessage ?? "");
    if (unsupportedShortcodes.length > 0) {
      return { ok: false, message: `Unsupported target message values: ${unsupportedShortcodes.map((key) => `{${key}}`).join(", ")}.` } satisfies ActionData;
    }
    if (!activationMode) {
      return { ok: false, message: "Choose always, date range, or weekly activation." } satisfies ActionData;
    }
    const validDate = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    if (activationMode === "date_range"
      && (!validDate(activeFromLocalRaw) || !validDate(activeUntilLocalRaw) || activeFromLocalRaw > activeUntilLocalRaw)) {
      return { ok: false, message: "Date range requires valid start and end dates, with the start on or before the end." } satisfies ActionData;
    }
    if (activationMode === "weekly") {
      if (weekdays.length === 0 || weekdays.some((day) => !/^[0-6]$/.test(day))) {
        return { ok: false, message: "Weekly schedules require at least one valid weekday." } satisfies ActionData;
      }
      const validTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
      if (!validTime(startTimeLocalRaw) || !validTime(endTimeLocalRaw) || startTimeLocalRaw >= endTimeLocalRaw) {
        return { ok: false, message: "Weekly start and end times are required, and the start must be before the end." } satisfies ActionData;
      }
    }

    const existing = await prisma.deliveryTarget.findUnique({
      where: { shop_name: { shop, name } },
    });
    if (existing && existing.id !== targetId) {
      return { ok: false, message: "A targeting rule with this name already exists." } satisfies ActionData;
    }

    const targetData = {
        shop,
        name,
        targetKind: kind,
        targetValue: value,
        countryCode,
        stateRegion,
        inventoryMode,
        customSuccessMessage,
        activationMode,
        activeFromLocal: activationMode === "date_range" ? activeFromLocalRaw : null,
        activeUntilLocal: activationMode === "date_range" ? activeUntilLocalRaw : null,
        weekdaysCsv: activationMode === "weekly" ? weekdays.join(",") : "",
        startTimeLocal: activationMode === "weekly" ? startTimeLocalRaw : null,
        endTimeLocal: activationMode === "weekly" ? endTimeLocalRaw : null,
        requireValidPin,
        processingDays,
        transitDays,
        excluded,
        priority,
    };
    if (targetId === null) {
      await prisma.deliveryTarget.create({ data: { ...targetData, enabled: true } });
    } else {
      const target = await prisma.deliveryTarget.findFirst({ where: { id: targetId, shop } });
      if (!target) {
        return { ok: false, message: "Targeting rule not found." } satisfies ActionData;
      }
      await prisma.deliveryTarget.update({ where: { id: targetId }, data: targetData });
    }

    return {
      ok: true,
      message: `Targeting rule "${name}" ${targetId === null ? "created" : "updated"} for ${kind} ${value}.`,
      intent,
    } satisfies ActionData;
  }

  if (intent === "toggle_target") {
    requireFeature(access, "targeting");
    const targetId = Number(formData.get("targetId") ?? 0);
    const target = await prisma.deliveryTarget.findFirst({ where: { id: targetId, shop } });
    if (!target) {
      return { ok: false, message: "Targeting rule not found." } satisfies ActionData;
    }

    await prisma.deliveryTarget.update({
      where: { id: targetId },
      data: { enabled: !target.enabled },
    });

    return {
      ok: true,
      message: `Targeting rule "${target.name}" ${target.enabled ? "disabled" : "enabled"}.`,
    } satisfies ActionData;
  }

  if (intent === "delete_target") {
    requireFeature(access, "targeting");
    const targetId = Number(formData.get("targetId") ?? 0);
    const target = await prisma.deliveryTarget.findFirst({ where: { id: targetId, shop } });
    if (!target) {
      return { ok: false, message: "Targeting rule not found." } satisfies ActionData;
    }

    await prisma.deliveryTarget.delete({ where: { id: targetId } });

    return {
      ok: true,
      message: `Targeting rule "${target.name}" deleted.`,
    } satisfies ActionData;
  }

  if (intent === "upsert_single_postal_code") {
    const postalRuleIdRaw = String(formData.get("postalRuleId") ?? "").trim();
    const postalRuleId = postalRuleIdRaw ? Number(postalRuleIdRaw) : null;
    const country = normalizeCountryCode(formData.get("country")?.toString());
    const rawPattern = String(
      formData.get("postalCode") ?? formData.get("pincode") ?? formData.get("postalPattern") ?? "",
    );
    const parsedPatterns = rawPattern
      .split(/[,\r\n]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => parsePostalPattern(country, value));
    if (parsedPatterns.length === 0 || parsedPatterns.some((parsed) => !parsed)) {
      return {
        ok: false,
        message: "Enter a valid postal code, range (10000-10999), or wildcard (123*).",
      } satisfies ActionData;
    }
    if (postalRuleId !== null && (!Number.isInteger(postalRuleId) || postalRuleId <= 0)) {
      return { ok: false, message: "The selected postal rule is invalid." } satisfies ActionData;
    }
    if (postalRuleId !== null && parsedPatterns.length !== 1) {
      return { ok: false, message: "Edit one postal rule at a time. Use manual import to add multiple rules." } satisfies ActionData;
    }
    if (parsedPatterns.some((parsed) => parsed?.type !== "exact")) requireFeature(access, "patterns");

    const deliveryDaysRaw = String(formData.get("deliveryDays") ?? "").trim();
    if (!deliveryDaysRaw) {
      return { ok: false, message: "Delivery days is required." } satisfies ActionData;
    }
    const deliveryDays = Number(deliveryDaysRaw);
    const serviceable = parseBool(formData.get("serviceable"));
    const codAvailable = parseBool(formData.get("codAvailable"));
    const city = String(formData.get("city") ?? "").trim() || null;
    const state = String(formData.get("state") ?? "").trim() || null;
    const zoneName = String(formData.get("zone") ?? "").trim() || null;
    const zoneIdRaw = Number(formData.get("zoneId") ?? 0);
    const zonePriority = Number(formData.get("zonePriority") ?? 100);
    const deliveryChargeRaw = String(formData.get("deliveryCharge") ?? "").trim();
    const deliveryCharge = deliveryChargeRaw ? Number(deliveryChargeRaw) : null;
    const currency = String(formData.get("currency") ?? "").trim().toUpperCase() || null;
    const sameDayAvailable = parseBool(formData.get("sameDayAvailable"));
    const nextDayAvailable = parseBool(formData.get("nextDayAvailable"));
    const expressAvailable = parseBool(formData.get("expressAvailable"));
    if (
      !access.features.deliveryOptions &&
      (deliveryChargeRaw || sameDayAvailable || nextDayAvailable || expressAvailable)
    ) {
      requireFeature(access, "deliveryOptions");
    }
    if ((zoneIdRaw > 0 || zoneName) && !access.features.zones) requireFeature(access, "zones");

    if (!Number.isInteger(deliveryDays) || deliveryDays < 0 || deliveryDays > 60) {
      return { ok: false, message: "Delivery days should be between 0 and 60." } satisfies ActionData;
    }

    if (deliveryCharge !== null && (!Number.isFinite(deliveryCharge) || deliveryCharge < 0 || !currency || !/^[A-Z]{3}$/.test(currency))) {
      return { ok: false, message: "Delivery charge requires a positive amount and 3-letter currency." } satisfies ActionData;
    }
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      return { ok: false, message: "Currency must be a 3-letter ISO code such as USD." } satisfies ActionData;
    }

    if (postalRuleId !== null) {
      const selectedRule = await prisma.postalCode.findFirst({ where: { id: postalRuleId, shop } });
      if (!selectedRule) {
        return { ok: false, message: "The selected postal rule was not found." } satisfies ActionData;
      }
      const parsed = parsedPatterns[0]!;
      const duplicate = await prisma.postalCode.findFirst({
        where: {
          shop,
          country,
          postalCode: parsed.pattern,
          id: { not: postalRuleId },
        },
        select: { id: true },
      });
      if (duplicate) {
        return { ok: false, message: `A postal rule for ${country} ${parsed.pattern} already exists.` } satisfies ActionData;
      }

      try {
        await prisma.$transaction(async (tx) => {
          let editZoneId: number | null = null;
          let editZoneName = zoneName;
          if (Number.isInteger(zoneIdRaw) && zoneIdRaw > 0) {
            const zone = await tx.zone.findFirst({ where: { id: zoneIdRaw, shop } });
            if (!zone) throw new Error("Selected zone was not found.");
            editZoneId = zone.id;
            editZoneName = zone.name;
          } else if (zoneName) {
            const zone = await tx.zone.upsert({
              where: { shop_name: { shop, name: zoneName } },
              create: {
                shop,
                name: zoneName,
                country,
                priority: Number.isInteger(zonePriority) ? zonePriority : 100,
                enabled: true,
              },
              update: {},
            });
            editZoneId = zone.id;
            editZoneName = zone.name;
          }

          await tx.postalCode.update({
            where: { id: selectedRule.id },
            data: {
              country,
              postalCode: parsed.pattern,
              patternType: parsed.type,
              rangeStart: parsed.type === "range" ? parsed.start : null,
              rangeEnd: parsed.type === "range" ? parsed.end : null,
              zoneId: editZoneId,
              deliveryDays,
              serviceable,
              codAvailable,
              deliveryCharge,
              currency,
              sameDayAvailable,
              nextDayAvailable,
              expressAvailable,
              city,
              state,
              zone: editZoneName,
            },
          });
        });
      } catch (error) {
        if (error instanceof Error && error.message === "Selected zone was not found.") {
          return { ok: false, message: error.message } satisfies ActionData;
        }
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
          return { ok: false, message: `A postal rule for ${country} ${parsed.pattern} already exists.` } satisfies ActionData;
        }
        throw error;
      }

      return {
        ok: true,
        message: `Postal rule updated (${parsed.type}): ${parsed.pattern}.`,
        intent: "upsert_single_postal_code",
        savedRules: [parsed.pattern],
        postalRuleId,
      } satisfies ActionData;
    }

    let zoneId: number | null = null;
    let resolvedZoneName = zoneName;
    if (Number.isInteger(zoneIdRaw) && zoneIdRaw > 0) {
      const zone = await prisma.zone.findFirst({ where: { id: zoneIdRaw, shop } });
      if (!zone) {
        return { ok: false, message: "Selected zone was not found." } satisfies ActionData;
      }
      zoneId = zone.id;
      resolvedZoneName = zone.name;
    } else if (zoneName) {
      const created = await prisma.zone.upsert({
        where: { shop_name: { shop, name: zoneName } },
        create: {
          shop,
          name: zoneName,
          country,
          priority: Number.isInteger(zonePriority) ? zonePriority : 100,
          enabled: true,
        },
        update: {},
      });
      zoneId = created.id;
      resolvedZoneName = created.name;
    }

    for (const parsed of parsedPatterns) {
      if (!parsed) continue;
      const rangeStart = parsed.type === "range" ? parsed.start : null;
      const rangeEnd = parsed.type === "range" ? parsed.end : null;

      await prisma.postalCode.upsert({
        where: { shop_country_postalCode: { shop, country, postalCode: parsed.pattern } },
        create: {
          shop,
          country,
          postalCode: parsed.pattern,
          patternType: parsed.type,
          rangeStart,
          rangeEnd,
          zoneId,
          deliveryDays,
          serviceable,
          codAvailable,
          deliveryCharge,
          currency,
          sameDayAvailable,
          nextDayAvailable,
          expressAvailable,
          city,
          state,
          zone: resolvedZoneName,
        },
        update: {
          patternType: parsed.type,
          rangeStart,
          rangeEnd,
          zoneId,
          deliveryDays,
          serviceable,
          codAvailable,
          deliveryCharge,
          currency,
          sameDayAvailable,
          nextDayAvailable,
          expressAvailable,
          city,
          state,
          zone: resolvedZoneName,
        },
      });
    }

    return {
      ok: true,
      message: parsedPatterns.length === 1
        ? `Postal rule saved (${parsedPatterns[0]?.type}): ${parsedPatterns[0]?.pattern}.`
        : `${parsedPatterns.length} postal rules saved.`,
      intent: "upsert_single_postal_code",
      savedRules: parsedPatterns.flatMap((parsed) => parsed?.pattern ? [parsed.pattern] : []),
    } satisfies ActionData;
  }

  if (intent === "delete_postal_rule") {
    const postalRuleId = Number(formData.get("postalRuleId") ?? 0);
    const postalRule = await prisma.postalCode.findFirst({ where: { id: postalRuleId, shop } });
    if (!postalRule) {
      return { ok: false, message: "Postal rule not found." } satisfies ActionData;
    }
    await prisma.postalCode.delete({ where: { id: postalRuleId } });
    return {
      ok: true,
      message: `Postal rule ${postalRule.postalCode} deleted.`,
      intent: "delete_postal_rule",
      postalRuleId,
    } satisfies ActionData;
  }

  if (intent === "bulk_import_csv") {
    const file = formData.get("postalCodeCsv") ?? formData.get("pincodeCsv");
    if (!(file instanceof File)) {
      return { ok: false, message: "Please upload a CSV file." } satisfies ActionData;
    }

    if (file.size > 8 * 1024 * 1024) {
      return { ok: false, message: "CSV should be smaller than 8MB." } satisfies ActionData;
    }

    try {
      const text = await file.text();
      const result = await importPostalCodesFromCsv(shop, text, "csv", access.features);
      return {
        ok: result.status !== "failed",
        message: `CSV import ${result.status}. Success: ${result.successRows}, Failed: ${result.failedRows}.`,
      } satisfies ActionData;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "CSV import failed." } satisfies ActionData;
    }
  }

  if (intent === "bulk_manual_rows") {
    const raw = String(formData.get("manualRows") ?? "").trim();
    if (!raw) {
      return { ok: false, message: "Please paste at least one row." } satisfies ActionData;
    }

    const rawLines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (rawLines.length > 1000) {
      return { ok: false, message: "Manual import cannot contain more than 1,000 rows." } satisfies ActionData;
    }
    const lines = rawLines;
    const csv = [
      "country,postal_code,delivery_days,serviceable,cod_available,city,state,zone,delivery_charge,currency,same_day,next_day,express",
      ...lines,
    ].join("\n");
    try {
      const result = await importPostalCodesFromCsv(shop, csv, "csv", access.features);
      return {
        ok: result.status !== "failed",
        message: `Manual import ${result.status}. Success: ${result.successRows}, Failed: ${result.failedRows}.`,
      } satisfies ActionData;
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Manual import failed." } satisfies ActionData;
    }
  }

  return { ok: false, message: "Unsupported action." } satisfies ActionData;
}

export default function DeliverySettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isSaving = fetcher.state !== "idle";
  const isAdvanced = data.access.plan === "advanced";
  const activeIntent = String(fetcher.formData?.get("intent") ?? "");
  const activeZoneId = Number(fetcher.formData?.get("zoneId") ?? 0);
  const activePostalRuleId = Number(fetcher.formData?.get("postalRuleId") ?? 0);
  const isIntentSaving = (intent: string) => isSaving && activeIntent === intent;
  const isZoneActionSaving = (intent: string, zoneId: number) => isIntentSaving(intent) && activeZoneId === zoneId;
  const isPostalActionSaving = (intent: string, id: number) => isIntentSaving(intent) && activePostalRuleId === id;
  const [settings, setSettings] = useState({
    cutoffHour24: String(data.setting.cutoffHour24),
    processingDays: String(data.setting.processingDays),
    fallbackDays: String(data.setting.fallbackDays),
    deliveryWindowDays: String(data.setting.deliveryWindowDays),
    dateFormat: data.setting.dateFormat.startsWith("custom:") ? "custom" : data.setting.dateFormat,
    customDateFormat: data.setting.dateFormat.startsWith("custom:") ? data.setting.dateFormat.slice(7) : "ddd, DD MMM",
    timeZone: data.setting.timeZone,
    locale: data.setting.locale,
    weekendDaysCsv: data.setting.weekendDaysCsv,
    courierTimeoutMs: String(data.setting.courierTimeoutMs),
    retryCount: String(data.setting.retryCount),
    courierEnabled: data.courierIntegrationAvailable && data.setting.courierEnabled,
    dbFallbackEnabled: data.setting.dbFallbackEnabled,
    inventoryAwareEnabled: data.setting.inventoryAwareEnabled,
    disableAddToCart: data.setting.disableAddToCart,
    requireValidPin: data.setting.requireValidPin,
    successMessage: data.setting.successMessage,
    unavailableMessage: data.setting.unavailableMessage,
    codAvailableMessage: data.setting.codAvailableMessage,
    codUnavailableMessage: data.setting.codUnavailableMessage,
    deliveryChargeMessage: data.setting.deliveryChargeMessage,
  });
  const [googleSheetCsvUrl, setGoogleSheetCsvUrl] = useState(data.setting.googleSheetCsvUrl ?? "");
  const [holidayDate, setHolidayDate] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvRejected, setCsvRejected] = useState(false);
  const [zoneForm, setZoneForm] = useState({
    name: "",
    country: "",
    priority: "100",
  });
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.intent === "create_zone") {
      setZoneForm({ name: "", country: "", priority: "100" });
    }
  }, [fetcher.data, fetcher.state]);
  const [targetForm, setTargetForm] = useState({
    name: "",
    kind: "product",
    value: "",
    priority: "100",
    requireValidPin: true,
    processingDays: "",
    transitDays: "",
    excluded: false,
    countryCode: "",
    stateRegion: "",
    inventoryMode: "any",
    customSuccessMessage: "",
    activationMode: "always",
    activeFromLocal: "",
    activeUntilLocal: "",
    weekdaysCsv: "1,2,3,4,5",
    startTimeLocal: "09:00",
    endTimeLocal: "17:00",
  });
  const [editingTargetId, setEditingTargetId] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const resetTargetForm = () => {
    setEditingTargetId(null);
    setProductSearch("");
    setTargetForm({
      name: "",
      kind: "product",
      value: "",
      priority: "100",
      requireValidPin: true,
      processingDays: "",
      transitDays: "",
      excluded: false,
      countryCode: "",
      stateRegion: "",
      inventoryMode: "any",
      customSuccessMessage: "",
      activationMode: "always",
      activeFromLocal: "",
      activeUntilLocal: "",
      weekdaysCsv: "1,2,3,4,5",
      startTimeLocal: "09:00",
      endTimeLocal: "17:00",
    });
  };
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok
      && (fetcher.data.intent === "create_target" || fetcher.data.intent === "update_target")) {
      resetTargetForm();
    }
  // resetTargetForm intentionally uses only state setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);
  const [postalCodeForm, setPostalCodeForm] = useState({
    country: "US",
    postalCode: "",
    deliveryDays: "",
    zoneId: "",
    zone: "",
    city: "",
    state: "",
    deliveryCharge: "",
    currency: "",
    serviceable: true,
    codAvailable: false,
    sameDayAvailable: false,
    nextDayAvailable: false,
    expressAvailable: false,
  });
  const [editingPostalRule, setEditingPostalRule] = useState<{ id: number; postalCode: string } | null>(null);
  const [activeRuleGroup, setActiveRuleGroup] = useState("all");
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.intent === "upsert_single_postal_code") {
      setPostalCodeForm((current) => ({
        country: current.country,
        postalCode: "",
        deliveryDays: "",
        zoneId: "",
        zone: "",
        city: "",
        state: "",
        deliveryCharge: "",
        currency: "",
        serviceable: true,
        codAvailable: false,
        sameDayAvailable: false,
        nextDayAvailable: false,
        expressAvailable: false,
      }));
      setEditingPostalRule(null);
    }
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.intent === "delete_postal_rule") {
      setEditingPostalRule(null);
    }
  }, [fetcher.data, fetcher.state]);
  const [manualRows, setManualRows] = useState("");
  const [selectedEtaTemplate, setSelectedEtaTemplate] = useState("");
  const [selectedShortcode, setSelectedShortcode] = useState("");
  const [etaPanel, setEtaPanel] = useState<"cutoff" | "weekoff" | "dates" | "countdown" | "translation" | null>(null);
  const holidays = data.setting.holidaysCsv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  const sampleProcessingDays = Math.max(0, Number(settings.processingDays) || 0);
  const sampleMinLeadDays = sampleProcessingDays + 3;
  const sampleMaxLeadDays = sampleMinLeadDays + Math.max(0, Number(settings.deliveryWindowDays) || 0);
  const selectedDateFormat = settings.dateFormat === "custom" ? `custom:${settings.customDateFormat}` : settings.dateFormat;
  const sampleOrderDate = previewDate(settings.locale, 0, selectedDateFormat);
  const sampleDispatchDate = previewDate(settings.locale, sampleProcessingDays, selectedDateFormat);
  const sampleMinDeliveryDate = previewDate(settings.locale, sampleMinLeadDays, selectedDateFormat);
  const sampleMaxDeliveryDate = previewDate(settings.locale, sampleMaxLeadDays, selectedDateFormat);
  const previewMessage = renderDeliveryMessage(settings.successMessage, {
    date: sampleMaxDeliveryDate,
    min_delivery_date: sampleMinDeliveryDate,
    max_delivery_date: sampleMaxDeliveryDate,
    delivery_date_range: `${sampleMinDeliveryDate} to ${sampleMaxDeliveryDate}`,
    min_lead_days: sampleMinLeadDays,
    max_lead_days: sampleMaxLeadDays,
    order_date: sampleOrderDate,
    dispatch_date_formatted: sampleDispatchDate,
    estimated_date: previewIsoDate(sampleMinLeadDays),
    estimated_date_max: previewIsoDate(sampleMaxLeadDays),
    days: sampleMinLeadDays,
    processing_days: settings.processingDays || "0",
    transit_days: 3,
    dispatch_date: previewIsoDate(sampleProcessingDays),
    country: "US",
    postal_code: "10001",
    cod_message: settings.codAvailableMessage,
    delivery_charge_message: "",
    delivery_charge: "",
    currency: "USD",
  });
  const zoneOptions = [
    { label: "No zone", value: "" },
    ...data.zones.map((zone) => ({
      label: `${zone.name}${zone.country ? ` (${zone.country})` : ""}${zone.enabled ? "" : " · disabled"}`,
      value: String(zone.id),
    })),
  ];
  const stateOptions = (LOCATION_SUGGESTIONS[postalCodeForm.country] ?? []).map((location) => ({
    label: location.state,
    value: location.state,
  }));
  const cityOptions = locationOptions(postalCodeForm.country, postalCodeForm.state);
  const normalizedProductSearch = productSearch.trim().toLowerCase();
  const productOptions = data.products
    .filter((product) => !normalizedProductSearch || `${product.title} ${product.handle} ${product.id}`.toLowerCase().includes(normalizedProductSearch))
    .slice(0, 20)
    .map((product) => ({
      label: `${product.title} · ${product.handle}`,
      value: product.id,
    }));
  const targetRegionOptions = suggestedRegions(targetForm.countryCode, targetForm.stateRegion);
  const targetRegionValues = regionsForCountry(targetForm.countryCode);
  const themeEditorUrl = `https://${data.shop}/admin/themes/current/editor?template=product&addAppBlockId=${data.apiKey}/delivery-checker&target=mainSection`;
  const previewDeliveryDate = sampleMaxDeliveryDate;
  const etaPanelTitle = {
    cutoff: "Cut-off time",
    weekoff: "Weekoff / holidays",
    dates: "Date visibility",
    countdown: "Countdown timer",
    translation: "Translation and ETA message",
  }[etaPanel ?? "cutoff"];
  const weekdayOptions = [
    ["1", "Mon"],
    ["2", "Tue"],
    ["3", "Wed"],
    ["4", "Thu"],
    ["5", "Fri"],
    ["6", "Sat"],
    ["0", "Sun"],
  ] as const;
  const selectedWeekends = new Set(settings.weekendDaysCsv.split(",").map((value) => value.trim()).filter(Boolean));
  const toggleWeekend = (value: string) => {
    setSettings((current) => {
      const set = new Set(current.weekendDaysCsv.split(",").map((item) => item.trim()).filter(Boolean));
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...current, weekendDaysCsv: [...set].sort().join(",") || "0" };
    });
  };
  const editPostalRule = (row: (typeof data.samplePostalCodes)[number]) => {
    setEditingPostalRule({ id: row.id, postalCode: row.postalCode });
    setPostalCodeForm({
      country: row.country,
      postalCode: row.postalCode,
      deliveryDays: String(row.deliveryDays),
      zoneId: row.zoneId ? String(row.zoneId) : "",
      zone: row.zoneGroup?.name ?? row.zone ?? "",
      city: row.city ?? "",
      state: row.state ?? "",
      deliveryCharge: row.deliveryCharge !== null && row.deliveryCharge !== undefined ? String(row.deliveryCharge) : "",
      currency: row.currency ?? "",
      serviceable: row.serviceable,
      codAvailable: row.codAvailable,
      sameDayAvailable: row.sameDayAvailable,
      nextDayAvailable: row.nextDayAvailable,
      expressAvailable: row.expressAvailable,
    });
  };
  const editTarget = (target: (typeof data.targets)[number]) => {
    const product = target.targetKind === "product"
      ? data.products.find((item) => item.id.replace(/\D/g, "") === target.targetValue)
      : undefined;
    setEditingTargetId(target.id);
    setProductSearch(product ? `${product.title} · ${product.handle}` : target.targetKind === "product" ? target.targetValue : "");
    setTargetForm({
      name: target.name,
      kind: target.targetKind,
      value: product?.id ?? target.targetValue,
      priority: String(target.priority),
      requireValidPin: target.requireValidPin,
      processingDays: target.processingDays === null ? "" : String(target.processingDays),
      transitDays: target.transitDays === null ? "" : String(target.transitDays),
      excluded: target.excluded,
      countryCode: target.countryCode ?? "",
      stateRegion: target.stateRegion ?? "",
      inventoryMode: target.inventoryMode,
      customSuccessMessage: target.customSuccessMessage ?? "",
      activationMode: target.activationMode,
      activeFromLocal: target.activeFromLocal ?? "",
      activeUntilLocal: target.activeUntilLocal ?? "",
      weekdaysCsv: target.weekdaysCsv || "1,2,3,4,5",
      startTimeLocal: target.startTimeLocal ?? "09:00",
      endTimeLocal: target.endTimeLocal ?? "17:00",
    });
    document.getElementById("targeting")?.scrollIntoView({ behavior: "smooth" });
  };
  const ruleGroups = [
    { id: "all", label: "All rules", count: data.samplePostalCodes.length },
    ...data.zones.map((zone) => ({
      id: String(zone.id),
      label: zone.name,
      count: data.samplePostalCodes.filter((row) => row.zoneId === zone.id).length,
    })),
    {
      id: "unassigned",
      label: "Unassigned",
      count: data.samplePostalCodes.filter((row) => !row.zoneId && !row.zone).length,
    },
  ].filter((group) => group.id === "all" || group.count > 0);
  const visibleRules = data.samplePostalCodes
    .filter((row) => activeRuleGroup === "all"
      || (activeRuleGroup === "unassigned" ? !row.zoneId && !row.zone : String(row.zoneId) === activeRuleGroup))
    .sort((a, b) => a.country.localeCompare(b.country) || a.postalCode.localeCompare(b.postalCode));
  const tableRows = visibleRules.map((row) => [
    row.country,
    row.postalCode,
    row.patternType,
    row.zoneGroup?.name ?? row.zone ?? "-",
    row.deliveryDays,
    row.serviceable ? <Badge key={`${row.id}-serviceable`} tone="success">Yes</Badge> : <Badge key={`${row.id}-serviceable`} tone="critical">No</Badge>,
    row.codAvailable ? <Badge key={`${row.id}-cod`} tone="success">Yes</Badge> : <Badge key={`${row.id}-cod`}>No</Badge>,
    row.deliveryCharge !== null && row.deliveryCharge !== undefined ? `${row.currency ?? ""} ${row.deliveryCharge}`.trim() : "-",
    row.city ?? "-",
    row.state ?? "-",
    <InlineStack key={`${row.id}-actions`} gap="100">
      <Button size="slim" onClick={() => editPostalRule(row)}>Edit</Button>
      <fetcher.Form method="post" onSubmit={(event) => { if (!window.confirm(`Delete postal rule ${row.postalCode}?`)) event.preventDefault(); }}>
        <input type="hidden" name="intent" value="delete_postal_rule" />
        <input type="hidden" name="postalRuleId" value={row.id} />
        <Button submit size="slim" tone="critical" loading={isPostalActionSaving("delete_postal_rule", row.id)}>Delete</Button>
      </fetcher.Form>
    </InlineStack>,
  ]);
  const zoneRows = data.zones.map((zone) => [
    zone.name,
    zone.country ?? "*",
    zone.priority,
    zone._count.postalCodes,
    zone.enabled ? <Badge key={`${zone.id}-on`} tone="success">Enabled</Badge> : <Badge key={`${zone.id}-on`}>Disabled</Badge>,
    <InlineStack key={`${zone.id}-actions`} gap="200">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="toggle_zone" />
        <input type="hidden" name="zoneId" value={zone.id} />
        <Button submit size="slim" loading={isZoneActionSaving("toggle_zone", zone.id)} disabled={!isAdvanced}>
          {zone.enabled ? "Disable" : "Enable"}
        </Button>
      </fetcher.Form>
      <fetcher.Form
        method="post"
        onSubmit={(event) => {
          if (!window.confirm(`Delete zone "${zone.name}"? Its postal rules will be kept.`)) event.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="delete_zone" />
        <input type="hidden" name="zoneId" value={zone.id} />
        <Button submit size="slim" tone="critical" loading={isZoneActionSaving("delete_zone", zone.id)} disabled={!isAdvanced}>
          Delete
        </Button>
      </fetcher.Form>
    </InlineStack>,
  ]);
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const targetRows = data.targets.map((target) => {
    const geography = [target.countryCode || "All countries", target.stateRegion].filter(Boolean).join(" / ");
    const schedule = target.activationMode === "date_range"
      ? `${target.activeFromLocal} to ${target.activeUntilLocal}`
      : target.activationMode === "weekly"
        ? `${target.weekdaysCsv.split(",").map((day) => weekdayLabels[Number(day)]).filter(Boolean).join(", ")} ${target.startTimeLocal}-${target.endTimeLocal}`
        : "Always";
    const behavior = [
      target.excluded ? "Excluded" : "Included",
      target.requireValidPin ? "Lock ATC" : "No lock",
      target.processingDays === null ? "default prep" : `${target.processingDays}d prep`,
      target.transitDays === null ? "postal transit" : `${target.transitDays}d transit`,
    ].join(" · ");
    const matchLabel = target.targetKind === "collection"
      ? compactCollectionName(target.targetValue)
      : `${target.targetKind}: ${target.targetValue}`;
    return [
    `${target.name} (#${target.priority})`,
    <span key={`${target.id}-match`} className="incode-target-match" title={`${target.targetKind}: ${target.targetValue}`}>
      {matchLabel}
    </span>,
    geography,
    target.inventoryMode.replaceAll("_", " "),
    schedule,
    target.customSuccessMessage || "Global message",
    behavior,
    target.enabled ? <Badge key={`${target.id}-on`} tone="success">Enabled</Badge> : <Badge key={`${target.id}-on`}>Disabled</Badge>,
    <InlineStack key={`${target.id}-actions`} gap="200">
      <Button size="slim" onClick={() => editTarget(target)} disabled={!isAdvanced}>Edit</Button>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="toggle_target" />
        <input type="hidden" name="targetId" value={target.id} />
        <Button submit size="slim" loading={isIntentSaving("toggle_target")} disabled={!isAdvanced}>
          {target.enabled ? "Disable" : "Enable"}
        </Button>
      </fetcher.Form>
      <fetcher.Form
        method="post"
        onSubmit={(event) => {
          if (!window.confirm(`Delete targeting rule "${target.name}"?`)) event.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="delete_target" />
        <input type="hidden" name="targetId" value={target.id} />
        <Button submit size="slim" tone="critical" loading={isIntentSaving("delete_target")} disabled={!isAdvanced}>
          Delete
        </Button>
      </fetcher.Form>
    </InlineStack>,
  ];
  });
  const importRows = data.recentImports.map((job) => [
    new Date(job.createdAt).toLocaleString(),
    job.source === "google_sheet" ? "Google Sheet" : "CSV",
    <Badge key={`${job.id}-status`} tone={job.status === "completed" ? "success" : job.status === "partial" ? "attention" : "critical"}>{job.status}</Badge>,
    job.totalRows,
    job.successRows,
    job.failedRows > 0 ? <Button key={`${job.id}-download`} url={`/app/import-errors/${job.id}`} size="slim">Download</Button> : "-",
  ]);

  const submitCsvImport = () => {
    if (!csvFile) return;

    const formData = new FormData();
    formData.append("intent", "bulk_import_csv");
    formData.append("postalCodeCsv", csvFile);
    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  const downloadCsvTemplate = () => {
    const file = new Blob([buildPostalCsvTemplate()], { type: "text/csv;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "incode-track-postal-code-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  };

  return (
    <Page
      title="Delivery settings"
      subtitle="Manage zones, ZIP ranges, wildcards, targeting rules, and delivery behavior."
      titleMetadata={
        <InlineStack gap="200">
          <Badge tone="info">{`${data.totalPatterns} rules`}</Badge>
          <Badge tone={data.zones.length > 0 ? "success" : undefined}>{`${data.zones.length} zones`}</Badge>
          <Badge>{`${data.patternCount} range/wildcard`}</Badge>
          <Badge tone={data.targetCount > 0 ? "success" : undefined}>{`${data.targetCount} targets`}</Badge>
          <Badge tone={isAdvanced ? "success" : "info"}>{`${data.access.planName} plan`}</Badge>
        </InlineStack>
      }
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {fetcher.data ? (
              <Banner title={fetcher.data.ok ? "Update complete" : "Could not complete update"} tone={fetcher.data.ok ? "success" : "critical"}>
                {fetcher.data.message}
              </Banner>
            ) : null}
            {!isAdvanced ? (
              <Banner title="Basic plan is active" tone="info" action={{ content: "Compare plans", url: "/app/plans" }}>
                Exact postal rules, CSV imports, delivery dates, COD, and schedules are available. Upgrade for ranges, zones, targeting, cart protection, integrations, export, and analytics.
              </Banner>
            ) : null}

            <div id="zones" className="incode-section-anchor" />
            {editingPostalRule ? (
              <div className="incode-modal-backdrop" role="presentation">
                <div className="incode-modal" role="dialog" aria-modal="true" aria-labelledby="edit-postal-rule-title">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd" id="edit-postal-rule-title">Edit postal rule</Text>
                      <Text as="p" tone="subdued">Update every field for {editingPostalRule.postalCode}, then save.</Text>
                    </BlockStack>
                    <Button size="slim" onClick={() => setEditingPostalRule(null)} accessibilityLabel="Close edit postal rule">Close</Button>
                  </InlineStack>
                  <div className="incode-modal__body">
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="upsert_single_postal_code" />
                      <input type="hidden" name="postalRuleId" value={editingPostalRule.id} />
                      <FormLayout>
                        <FormLayout.Group condensed>
                          <Select label="Country" name="country" options={COUNTRY_OPTIONS} value={postalCodeForm.country} onChange={(value) => setPostalCodeForm((current) => ({ ...current, country: value }))} />
                          <TextField label="Postal code / pattern" name="postalCode" value={postalCodeForm.postalCode} onChange={(value) => setPostalCodeForm((current) => ({ ...current, postalCode: value }))} autoComplete="off" />
                          <TextField label="Delivery days" name="deliveryDays" type="number" min={0} max={60} value={postalCodeForm.deliveryDays} onChange={(value) => setPostalCodeForm((current) => ({ ...current, deliveryDays: value }))} autoComplete="off" />
                        </FormLayout.Group>
                        <FormLayout.Group condensed>
                          <Select label="Zone" name="zoneId" options={zoneOptions} value={postalCodeForm.zoneId} onChange={(value) => setPostalCodeForm((current) => ({ ...current, zoneId: value, zone: "" }))} />
                          <TextField label="Zone name" name="zone" value={postalCodeForm.zone} onChange={(value) => setPostalCodeForm((current) => ({ ...current, zone: value }))} autoComplete="off" />
                        </FormLayout.Group>
                        <FormLayout.Group condensed>
                          <TextField label="City" name="city" value={postalCodeForm.city} onChange={(value) => setPostalCodeForm((current) => ({ ...current, city: value }))} autoComplete="address-level2" />
                          <TextField label="State" name="state" value={postalCodeForm.state} onChange={(value) => setPostalCodeForm((current) => ({ ...current, state: value }))} autoComplete="address-level1" />
                        </FormLayout.Group>
                        <FormLayout.Group condensed>
                          <TextField label="Delivery charge" name="deliveryCharge" type="number" min={0} value={postalCodeForm.deliveryCharge} onChange={(value) => setPostalCodeForm((current) => ({ ...current, deliveryCharge: value }))} autoComplete="off" />
                          <TextField label="Currency" name="currency" value={postalCodeForm.currency} onChange={(value) => setPostalCodeForm((current) => ({ ...current, currency: value.toUpperCase() }))} maxLength={3} autoComplete="off" />
                        </FormLayout.Group>
                        <InlineStack gap="400" wrap>
                          {([
                            ["serviceable", "Serviceable"],
                            ["codAvailable", "COD available"],
                            ["sameDayAvailable", "Same-day delivery"],
                            ["nextDayAvailable", "Next-day delivery"],
                            ["expressAvailable", "Express delivery"],
                          ] as const).map(([key, label]) => (
                            <Checkbox key={key} label={label} checked={postalCodeForm[key]} onChange={(checked) => setPostalCodeForm((current) => ({ ...current, [key]: checked }))} />
                          ))}
                        </InlineStack>
                        {(["serviceable", "codAvailable", "sameDayAvailable", "nextDayAvailable", "expressAvailable"] as const).map((key) => <input key={key} type="hidden" name={key} value={String(postalCodeForm[key])} />)}
                        <InlineStack align="end" gap="200">
                          <Button onClick={() => setEditingPostalRule(null)}>Cancel</Button>
                          <Button submit variant="primary" loading={isIntentSaving("upsert_single_postal_code")}>Save changes</Button>
                        </InlineStack>
                      </FormLayout>
                    </fetcher.Form>
                  </div>
                </div>
              </div>
            ) : null}

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Zones
                    </Text>
                    <Text as="p" tone="subdued">
                      Unlimited zones. Group ZIP codes, ranges, and wildcards.
                      Lower priority numbers win when rules overlap.
                    </Text>
                  </BlockStack>
                  <Badge tone="info">{`${data.zones.length} zones`}</Badge>
                </InlineStack>

                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="create_zone" />
                  <FormLayout>
                    <FormLayout.Group condensed>
                      <TextField
                        label="Zone name"
                        name="zoneName"
                        value={zoneForm.name}
                        onChange={(value) => setZoneForm((current) => ({ ...current, name: value }))}
                        placeholder="Metro delivery"
                        autoComplete="off"
                        requiredIndicator
                      />
                      <TextField
                        label="Country (optional)"
                        name="zoneCountry"
                        value={zoneForm.country}
                        onChange={(value) => setZoneForm((current) => ({ ...current, country: value.toUpperCase() }))}
                        placeholder="US"
                        maxLength={2}
                        autoComplete="off"
                        helpText="2-letter ISO code, or blank for any."
                      />
                      <TextField
                        label="Priority"
                        name="zonePriority"
                        type="number"
                        min={0}
                        max={9999}
                        value={zoneForm.priority}
                        onChange={(value) => setZoneForm((current) => ({ ...current, priority: value }))}
                        autoComplete="off"
                        helpText="Lower wins."
                      />
                    </FormLayout.Group>
                    <Button submit variant="primary" loading={isIntentSaving("create_zone")} disabled={!isAdvanced}>
                      Create zone
                    </Button>
                  </FormLayout>
                </fetcher.Form>

                {zoneRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "numeric", "text", "text"]}
                    headings={["Zone", "Country", "Priority", "Rules", "Status", "Actions"]}
                    rows={zoneRows}
                    increasedTableDensity
                  />
                ) : (
                  <Text as="p" tone="subdued">
                    No zones yet. Create a zone, then assign postal rules to it (optional).
                  </Text>
                )}
              </BlockStack>
            </Card>

            <div id="targeting" className="incode-section-anchor" />
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Product, collection, vendor, and tag ETA rules
                    </Text>
                    <Text as="p" tone="subdued">
                      Set ETA overrides, exclusions, and add-to-cart policy. Product targets
                      win over collection, vendor, then tag rules. Lowest priority wins.
                    </Text>
                  </BlockStack>
                  <Badge tone="info">{`${data.targetCount} targets`}</Badge>
                </InlineStack>

                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value={editingTargetId === null ? "create_target" : "update_target"} />
                  {editingTargetId !== null ? <input type="hidden" name="targetId" value={editingTargetId} /> : null}
                  <FormLayout>
                    <FormLayout.Group condensed>
                      <TextField
                        label="Rule name"
                        name="targetName"
                        value={targetForm.name}
                        onChange={(value) => setTargetForm((current) => ({ ...current, name: value }))}
                        placeholder="Lock clearance products"
                        autoComplete="off"
                        requiredIndicator
                      />
                      <Select
                        label="Match"
                        name="targetKind"
                        options={[
                          { label: "Product ID", value: "product" },
                          { label: "Collection handle", value: "collection" },
                          { label: "Product vendor", value: "vendor" },
                          { label: "Product tag", value: "tag" },
                        ]}
                        value={targetForm.kind}
                         onChange={(value) => {
                           setProductSearch("");
                           setTargetForm((current) => ({ ...current, kind: value, value: "" }));
                         }}
                      />
                      {targetForm.kind === "collection" ? (
                        <Select
                          label="Collection"
                          name="targetValue"
                          options={[
                            { label: "Choose a collection", value: "" },
                            ...data.collections.map((collection) => ({ label: `${collection.title} · ${collection.handle}`, value: collection.handle })),
                          ]}
                          value={targetForm.value}
                          onChange={(value) => setTargetForm((current) => ({ ...current, value }))}
                          helpText={data.collections.length > 0 ? "Choose a collection from your Shopify store." : "No collections found. Create one in Shopify, then refresh."}
                        />
                      ) : targetForm.kind === "product" ? (
                        <>
                          <Autocomplete
                            options={productOptions}
                            selected={targetForm.value ? [targetForm.value] : []}
                            onSelect={(selected) => {
                              const productId = selected[0] ?? "";
                              const product = data.products.find((item) => item.id === productId);
                              setTargetForm((current) => ({ ...current, value: productId }));
                              setProductSearch(product ? `${product.title} · ${product.handle}` : productId);
                            }}
                            emptyState={data.products.length > 0 ? "No matching products." : "No products found in this store."}
                            textField={
                              <Autocomplete.TextField
                                label="Product"
                                value={productSearch}
                                onChange={(value) => {
                                  setProductSearch(value);
                                  setTargetForm((current) => ({ ...current, value: "" }));
                                }}
                                placeholder="Search products"
                                autoComplete="off"
                                requiredIndicator
                                helpText={data.products.length > 0 ? "Suggested products are shown. Search by product name or handle." : "Create a product in Shopify, then refresh this page."}
                              />
                            }
                          />
                          <input type="hidden" name="targetValue" value={targetForm.value} />
                        </>
                      ) : (
                        <TextField
                          label={targetForm.kind === "product" ? "Product ID" : targetForm.kind === "vendor" ? "Vendor" : "Product tag"}
                          name="targetValue"
                          value={targetForm.value}
                          onChange={(value) => setTargetForm((current) => ({ ...current, value }))}
                          placeholder={targetForm.kind === "product" ? "1234567890" : targetForm.kind === "vendor" ? "Acme" : "clearance"}
                          autoComplete="off"
                          requiredIndicator
                          helpText={targetForm.kind === "product" ? "Numeric product ID from Shopify Admin." : targetForm.kind === "vendor" ? "Matched case-insensitively." : "Matched case-insensitively."}
                        />
                      )}
                    </FormLayout.Group>
                    <FormLayout.Group condensed>
                      <BlockStack gap="100">
                        <Select
                          label="Preparation preset"
                          options={ETA_DAY_PRESETS}
                          value={ETA_DAY_PRESETS.some((option) => option.value === targetForm.processingDays) ? targetForm.processingDays : "custom"}
                          onChange={(value) => { if (value !== "custom") setTargetForm((current) => ({ ...current, processingDays: value })); }}
                        />
                        <TextField
                          label="Processing days override"
                          name="targetProcessingDays"
                          type="number"
                          min={0}
                          max={60}
                          value={targetForm.processingDays}
                          onChange={(value) => setTargetForm((current) => ({ ...current, processingDays: value }))}
                          autoComplete="off"
                          helpText="0 ships immediately · 2 standard preparation · 7 custom manufacturing."
                        />
                      </BlockStack>
                      <TextField
                        label="Transit days override"
                        name="targetTransitDays"
                        type="number"
                        min={0}
                        max={60}
                        value={targetForm.transitDays}
                        onChange={(value) => setTargetForm((current) => ({ ...current, transitDays: value }))}
                        autoComplete="off"
                        helpText="Blank uses the matching postal rule."
                      />
                      <Checkbox
                        label="Exclude matching products from delivery"
                        name="targetExcluded"
                        checked={targetForm.excluded}
                        onChange={(checked) => setTargetForm((current) => ({ ...current, excluded: checked }))}
                      />
                    </FormLayout.Group>
                    <FormLayout.Group condensed>
                      <TextField
                        label="Priority"
                        name="targetPriority"
                        type="number"
                        min={0}
                        max={9999}
                        value={targetForm.priority}
                        onChange={(value) => setTargetForm((current) => ({ ...current, priority: value }))}
                        autoComplete="off"
                        helpText="Lower wins."
                      />
                      <Checkbox
                        label="Require valid PIN before Add to Cart"
                        name="targetRequireValidPin"
                        checked={targetForm.requireValidPin}
                        onChange={(checked) =>
                          setTargetForm((current) => ({ ...current, requireValidPin: checked }))
                        }
                        helpText="Shoppers must pass a serviceable delivery check before checkout buttons unlock."
                      />
                    </FormLayout.Group>
                    <FormLayout.Group condensed>
                      <Select
                        label="Country"
                        name="targetCountryCode"
                        options={[{ label: "All countries", value: "" }, ...COUNTRY_OPTIONS]}
                        value={targetForm.countryCode}
                        onChange={(value) => setTargetForm((current) => ({ ...current, countryCode: value, stateRegion: "" }))}
                        helpText="Uses the shopper's storefront country."
                      />
                      <Autocomplete
                        options={targetRegionOptions}
                        selected={targetRegionValues.includes(targetForm.stateRegion) ? [targetForm.stateRegion] : []}
                        onSelect={(selected) => setTargetForm((current) => ({ ...current, stateRegion: selected[0] ?? "" }))}
                        emptyState={targetForm.countryCode ? "No matching region. You can keep the custom value." : "Choose a country first."}
                        textField={
                          <Autocomplete.TextField
                            label="State or region"
                            value={targetForm.stateRegion}
                            onChange={(value) => setTargetForm((current) => ({ ...current, stateRegion: value }))}
                            placeholder={targetForm.countryCode ? "Start typing a state or region" : "Choose a country first"}
                            maxLength={100}
                            disabled={!targetForm.countryCode}
                            autoComplete="off"
                            helpText="Optional exact match. Suggestions update for the selected country."
                          />
                        }
                      />
                      <input type="hidden" name="targetStateRegion" value={targetForm.stateRegion} />
                      <Select
                        label="Inventory condition"
                        name="targetInventoryMode"
                        options={[
                          { label: "Any inventory status", value: "any" },
                          { label: "In stock", value: "in_stock" },
                          { label: "Available on backorder", value: "backorder" },
                          { label: "Out of stock", value: "out_of_stock" },
                        ]}
                        value={targetForm.inventoryMode}
                        onChange={(value) => setTargetForm((current) => ({ ...current, inventoryMode: value }))}
                        helpText="Verified from Shopify for the selected variant."
                      />
                    </FormLayout.Group>
                    <Select
                      label="Activation"
                      name="targetActivationMode"
                      options={[
                        { label: "Always active", value: "always" },
                        { label: "Date range", value: "date_range" },
                        { label: "Weekly schedule", value: "weekly" },
                      ]}
                      value={targetForm.activationMode}
                      onChange={(value) => setTargetForm((current) => ({ ...current, activationMode: value }))}
                      helpText={`Dates and times use the merchant timezone (${settings.timeZone}).`}
                    />
                    {targetForm.activationMode === "date_range" ? (
                      <FormLayout.Group condensed>
                        <TextField
                          label="Active from"
                          name="targetActiveFromLocal"
                          type="date"
                          value={targetForm.activeFromLocal}
                          onChange={(value) => setTargetForm((current) => ({ ...current, activeFromLocal: value }))}
                          autoComplete="off"
                        />
                        <TextField
                          label="Active until"
                          name="targetActiveUntilLocal"
                          type="date"
                          value={targetForm.activeUntilLocal}
                          onChange={(value) => setTargetForm((current) => ({ ...current, activeUntilLocal: value }))}
                          autoComplete="off"
                        />
                      </FormLayout.Group>
                    ) : null}
                    {targetForm.activationMode === "weekly" ? (
                      <BlockStack gap="200">
                        <Text as="p" variant="bodyMd">Active weekdays</Text>
                        <InlineStack gap="300" wrap>
                          {weekdayOptions.map(([value, label]) => {
                            const selected = new Set(targetForm.weekdaysCsv.split(",").filter(Boolean));
                            return (
                              <Checkbox
                                key={value}
                                label={label}
                                checked={selected.has(value)}
                                onChange={(checked) => setTargetForm((current) => {
                                  const days = new Set(current.weekdaysCsv.split(",").filter(Boolean));
                                  if (checked) days.add(value);
                                  else days.delete(value);
                                  return { ...current, weekdaysCsv: [...days].sort().join(",") };
                                })}
                              />
                            );
                          })}
                        </InlineStack>
                        <input type="hidden" name="targetWeekdaysCsv" value={targetForm.weekdaysCsv} />
                        <FormLayout.Group condensed>
                          <TextField
                            label="Start time"
                            name="targetStartTimeLocal"
                            type="time"
                            value={targetForm.startTimeLocal}
                            onChange={(value) => setTargetForm((current) => ({ ...current, startTimeLocal: value }))}
                            autoComplete="off"
                          />
                          <TextField
                            label="End time"
                            name="targetEndTimeLocal"
                            type="time"
                            value={targetForm.endTimeLocal}
                            onChange={(value) => setTargetForm((current) => ({ ...current, endTimeLocal: value }))}
                            autoComplete="off"
                          />
                        </FormLayout.Group>
                      </BlockStack>
                    ) : null}
                    <TextField
                      label="Custom success message"
                      name="targetCustomSuccessMessage"
                      value={targetForm.customSuccessMessage}
                      maxLength={500}
                      multiline={3}
                      onChange={(value) => setTargetForm((current) => ({ ...current, customSuccessMessage: value }))}
                      autoComplete="off"
                      helpText="Optional. Overrides the global success message only when this rule matches. Existing ETA shortcodes are supported."
                    />
                    <InlineStack gap="200">
                      <Button submit variant="primary" loading={isIntentSaving(editingTargetId === null ? "create_target" : "update_target")} disabled={!isAdvanced}>
                        {editingTargetId === null ? "Create targeting rule" : "Save targeting rule"}
                      </Button>
                      {editingTargetId !== null ? <Button onClick={resetTargetForm}>Cancel edit</Button> : null}
                    </InlineStack>
                  </FormLayout>
                </fetcher.Form>

                {targetRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text", "text"]}
                    headings={["Rule", "Match", "Geography", "Inventory", "Schedule", "Message", "Behavior", "Status", "Actions"]}
                    rows={targetRows}
                    increasedTableDensity
                  />
                ) : (
                  <Text as="p" tone="subdued">
                    No targeting rules yet. Add product, collection, vendor, or tag rules
                    for custom ETAs, exclusions, or add-to-cart policy.
                  </Text>
                )}
              </BlockStack>
            </Card>

            <div id="behavior" className="incode-section-anchor" />
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" gap="300" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Delivery behavior and storefront messages
                    </Text>
                    <Text as="p" tone="subdued">
                      Configure how estimates are calculated and what shoppers see.
                    </Text>
                  </BlockStack>
                  <Badge tone={settings.courierEnabled ? "success" : "attention"}>
                    {settings.courierEnabled ? "Courier API active" : "Coverage rules active"}
                  </Badge>
                </InlineStack>

                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="save_settings" />
                  <input type="hidden" name="dateFormat" value={selectedDateFormat} />
                  <Card>
                    <BlockStack gap="300">
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd">ETA options</Text>
                        <Text as="p" tone="subdued">Customize cutoff time, week off days, date format, countdown timer, and translations from one simple panel.</Text>
                      </BlockStack>
                      <InlineStack gap="200" wrap>
                        <Button size="slim" onClick={() => setEtaPanel("cutoff")}>Cut-off time</Button>
                        <Button size="slim" onClick={() => setEtaPanel("weekoff")}>Weekoff / holidays</Button>
                        <Button size="slim" onClick={() => setEtaPanel("dates")}>Date visibility</Button>
                        <Button size="slim" onClick={() => setEtaPanel("countdown")}>Countdown timer</Button>
                        <Button size="slim" onClick={() => setEtaPanel("translation")}>Translation</Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>

                  {etaPanel ? (
                    <div className="incode-modal-backdrop" role="presentation">
                      <div className="incode-modal" role="dialog" aria-modal="true" aria-labelledby="incode-eta-panel-title">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h3" variant="headingMd" id="incode-eta-panel-title">{etaPanelTitle}</Text>
                          <Button size="slim" onClick={() => setEtaPanel(null)} accessibilityLabel="Close ETA options">Close</Button>
                        </InlineStack>
                        <div className="incode-modal__body">
                          {etaPanel === "cutoff" ? (
                            <BlockStack gap="300">
                              <Text as="p" tone="subdued">Orders placed before this hour start from today. After cutoff, the delivery promise moves to the next business day.</Text>
                               <Select label="Cutoff hour" name="cutoffHour24" options={withCurrentOption(CUTOFF_OPTIONS, settings.cutoffHour24)} value={settings.cutoffHour24} onChange={(value) => setSettings((current) => ({ ...current, cutoffHour24: value }))} />
                              <Text as="p">Current shopper message uses cutoff at <strong>{settings.cutoffHour24}:00</strong> in <strong>{settings.timeZone}</strong>.</Text>
                            </BlockStack>
                          ) : null}

                          {etaPanel === "weekoff" ? (
                            <BlockStack gap="400">
                              <Text as="p" tone="subdued">Select days that should not count as business delivery days. Holidays below are also skipped.</Text>
                              <input type="hidden" name="weekendDaysCsv" value={settings.weekendDaysCsv} />
                              <BlockStack gap="200">
                                <Text as="p" fontWeight="semibold">Delivery week off days</Text>
                                <InlineStack gap="200" wrap>
                                  {weekdayOptions.map(([value, label]) => (
                                    <button key={value} type="button" className={`incode-choice-chip${selectedWeekends.has(value) ? " is-selected" : ""}`} onClick={() => toggleWeekend(value)}>{label}</button>
                                  ))}
                                </InlineStack>
                                {selectedWeekends.size === 7 ? (
                                  <Banner tone="critical">At least one delivery day is required. Clear one weekend day before saving.</Banner>
                                ) : null}
                              </BlockStack>
                              <BlockStack gap="200">
                                <Text as="p" fontWeight="semibold">Configured holidays</Text>
                                {holidays.length > 0 ? <InlineStack gap="100" wrap>{holidays.map((holiday) => <Badge key={holiday}>{holiday}</Badge>)}</InlineStack> : <Text as="p" tone="subdued">No holidays yet. Use the Holidays section below to add blackout dates.</Text>}
                                <Button url="#holidays" size="slim" onClick={() => setEtaPanel(null)}>Manage holidays</Button>
                              </BlockStack>
                            </BlockStack>
                          ) : null}

                          {etaPanel === "dates" ? (
                            <BlockStack gap="300">
                              <Text as="p" tone="subdued">Make delivery dates easy for shoppers. The storefront will show the earliest and latest dates.</Text>
                              <FormLayout.Group condensed>
                                 <Select label="Date locale" name="locale" options={withCurrentOption(LOCALE_OPTIONS, settings.locale)} value={settings.locale} onChange={(value) => setSettings((current) => ({ ...current, locale: value }))} />
                                 <Select label="Delivery date window" name="deliveryWindowDays" options={withCurrentOption(DELIVERY_WINDOW_OPTIONS, settings.deliveryWindowDays)} value={settings.deliveryWindowDays} onChange={(value) => setSettings((current) => ({ ...current, deliveryWindowDays: value }))} />
                              </FormLayout.Group>
                               <Select label="Date format" options={DATE_FORMAT_OPTIONS} value={settings.dateFormat} onChange={(value) => setSettings((current) => ({ ...current, dateFormat: value }))} />
                               {settings.dateFormat === "custom" ? (
                                 <TextField
                                   label="Custom date pattern"
                                   value={settings.customDateFormat}
                                   onChange={(value) => setSettings((current) => ({ ...current, customDateFormat: value }))}
                                   autoComplete="off"
                                   helpText="Use YYYY, YY, MMMM, MMM, MM, M, DD, D, dddd, or ddd. Example: ddd, DD MMM YYYY."
                                 />
                               ) : null}
                              <Card><Text as="p">Preview: <strong>{sampleMinDeliveryDate}</strong> to <strong>{sampleMaxDeliveryDate}</strong></Text></Card>
                            </BlockStack>
                          ) : null}

                          {etaPanel === "countdown" ? (
                            <BlockStack gap="300">
                              <Text as="p" tone="subdued">Countdown uses the cutoff hour. Add <code>{"{COUNTDOWN_TIMER}"}</code> in messages later if you want inline timer text; the storefront widget already supports the cutoff countdown block setting.</Text>
                              <div className="incode-countdown-preview" aria-label="Countdown preview">
                                <span><strong>01</strong><small>Hours</small></span>
                                <span><strong>35</strong><small>Minutes</small></span>
                                <span><strong>40</strong><small>Seconds</small></span>
                              </div>
                            </BlockStack>
                          ) : null}

                          {etaPanel === "translation" ? (
                            <BlockStack gap="300">
                              <Text as="p" tone="subdued">Choose simple shopper wording. Dates are dynamic and calculated from the postal rule.</Text>
                              <FormLayout.Group condensed>
                                <Select label="Ready template" options={ETA_MESSAGE_TEMPLATES} value={selectedEtaTemplate} disabled={!isAdvanced} onChange={(value) => { setSelectedEtaTemplate(value); if (value) setSettings((current) => ({ ...current, successMessage: value })); }} />
                                <Select label="Insert dynamic value" options={SHORTCODE_OPTIONS} value={selectedShortcode} disabled={!isAdvanced} onChange={(value) => { setSelectedShortcode(""); if (!value) return; setSettings((current) => ({ ...current, successMessage: `${current.successMessage.trim()} {${value}}`.trim() })); }} />
                              </FormLayout.Group>
                              <TextField label="ETA message" name="successMessage" value={settings.successMessage} multiline={3} disabled={!isAdvanced} onChange={(value) => setSettings((current) => ({ ...current, successMessage: value }))} autoComplete="off" />
                              <Card><Text as="p">{previewMessage || "Your delivery estimate will appear here."}</Text></Card>
                            </BlockStack>
                          ) : null}
                        </div>
                        <InlineStack align="end" gap="200">
                          <Button onClick={() => setEtaPanel(null)}>Close</Button>
                          <Button submit variant="primary" loading={isIntentSaving("save_settings")}>Apply and save</Button>
                        </InlineStack>
                      </div>
                    </div>
                  ) : null}

                  <FormLayout>
                    <FormLayout.Group condensed>
                      <Select
                        label="Processing days"
                        name="processingDays"
                        options={withCurrentOption(PROCESSING_DAY_OPTIONS, settings.processingDays)}
                        value={settings.processingDays}
                        onChange={(value) => setSettings((current) => ({ ...current, processingDays: value }))}
                        helpText="Preparation time before dispatch."
                      />
                      <Select
                        label="Default transit days"
                        name="fallbackDays"
                        options={FALLBACK_DAY_OPTIONS}
                        value={settings.fallbackDays}
                        onChange={(value) => setSettings((current) => ({ ...current, fallbackDays: value }))}
                        helpText="Used when no postal rule or method provides transit days."
                      />
                    </FormLayout.Group>
                    <FormLayout.Group condensed>
                      <Select
                        label="Delivery date window"
                        name="deliveryWindowDays"
                        options={withCurrentOption(DELIVERY_WINDOW_OPTIONS, settings.deliveryWindowDays)}
                        value={settings.deliveryWindowDays}
                        onChange={(value) => setSettings((current) => ({ ...current, deliveryWindowDays: value }))}
                        helpText="Extra days between the earliest and latest promised delivery dates."
                      />
                    </FormLayout.Group>
                    <FormLayout.Group condensed>
                      <Select
                        label="Merchant timezone"
                        name="timeZone"
                        options={withCurrentOption(TIMEZONE_OPTIONS, settings.timeZone)}
                        value={settings.timeZone}
                        onChange={(value) => setSettings((current) => ({ ...current, timeZone: value }))}
                        helpText="IANA timezone used for cutoff and calendar dates."
                      />
                      <Select
                        label="Date locale"
                        name="locale"
                        options={withCurrentOption(LOCALE_OPTIONS, settings.locale)}
                        value={settings.locale}
                        onChange={(value) => setSettings((current) => ({ ...current, locale: value }))}
                        helpText="Locale used to format delivery dates."
                      />
                    </FormLayout.Group>

                    <FormLayout.Group condensed>
                      <Select
                        label="Cutoff hour"
                        name="cutoffHour24"
                        options={withCurrentOption(CUTOFF_OPTIONS, settings.cutoffHour24)}
                        value={settings.cutoffHour24}
                        onChange={(value) => setSettings((current) => ({ ...current, cutoffHour24: value }))}
                        helpText="Orders after this time move to the next business day."
                      />
                      <Select
                        label="Weekend days"
                        name="weekendDaysCsv"
                        options={withCurrentOption(WEEKEND_OPTIONS, settings.weekendDaysCsv)}
                        value={settings.weekendDaysCsv}
                        onChange={(value) => setSettings((current) => ({ ...current, weekendDaysCsv: value }))}
                        helpText="Common schedules are ready to select."
                      />
                    </FormLayout.Group>

                    <FormLayout.Group condensed>
                      <Select
                        label="Courier timeout"
                        name="courierTimeoutMs"
                        options={withCurrentOption(COURIER_TIMEOUT_OPTIONS, settings.courierTimeoutMs)}
                        value={settings.courierTimeoutMs}
                        onChange={(value) => setSettings((current) => ({ ...current, courierTimeoutMs: value }))}
                      />
                      <Select
                        label="Retry count"
                        name="retryCount"
                        options={withCurrentOption(RETRY_OPTIONS, settings.retryCount)}
                        value={settings.retryCount}
                        onChange={(value) => setSettings((current) => ({ ...current, retryCount: value }))}
                      />
                    </FormLayout.Group>

                    <Checkbox
                      label="Enable courier API as primary source"
                      name="courierEnabled"
                      checked={settings.courierEnabled}
                      disabled={!data.courierIntegrationAvailable || !isAdvanced}
                      helpText={
                        data.courierIntegrationAvailable
                          ? "Use the configured courier provider before falling back to uploaded postal code records. India-only courier checks use Shiprocket."
                          : "Courier provider credentials are not configured. Uploaded postal code records will be used."
                      }
                      onChange={(checked) =>
                        setSettings((current) => ({ ...current, courierEnabled: checked }))
                      }
                    />
                    <Checkbox
                      label="Use uploaded coverage rules when the courier API has no result"
                      name="dbFallbackEnabled"
                      checked={settings.dbFallbackEnabled}
                      onChange={(checked) =>
                        setSettings((current) => ({ ...current, dbFallbackEnabled: checked }))
                      }
                    />
                    <Checkbox
                      label="Enable inventory-aware delivery estimates"
                      name="inventoryAwareEnabled"
                      checked={settings.inventoryAwareEnabled}
                      disabled={!isAdvanced}
                      helpText="The storefront estimate uses the selected variant only when it is in stock."
                      onChange={(checked) =>
                        setSettings((current) => ({
                          ...current,
                          inventoryAwareEnabled: checked,
                        }))
                      }
                    />
                    <Checkbox
                      label="Disable Add to Cart when delivery is unavailable"
                      name="disableAddToCart"
                      checked={settings.disableAddToCart}
                      disabled={!isAdvanced}
                      helpText="The storefront widget disables common product form buttons after an unavailable lookup."
                      onChange={(checked) =>
                        setSettings((current) => ({ ...current, disableAddToCart: checked }))
                      }
                    />
                    <Checkbox
                      label="Require valid PIN before Add to Cart (shop-wide)"
                      name="requireValidPin"
                      checked={settings.requireValidPin}
                      disabled={!isAdvanced}
                      helpText="Add to Cart stays locked until a serviceable postal code check succeeds. Targeting rules can override this per product, collection, or tag."
                      onChange={(checked) =>
                        setSettings((current) => ({ ...current, requireValidPin: checked }))
                      }
                    />

                    <Card>
                      <BlockStack gap="300">
                        <BlockStack gap="100">
                          <Text as="h3" variant="headingMd">General ETA message</Text>
                          <Text as="p" tone="subdued">
                            Dates are calculated from the real postal-code rule, cutoff, timezone, weekends, and holidays.
                          </Text>
                        </BlockStack>
                        <FormLayout.Group condensed>
                          <Select
                            label="Ready template"
                            options={ETA_MESSAGE_TEMPLATES}
                            value={selectedEtaTemplate}
                            disabled={!isAdvanced}
                            onChange={(value) => {
                              setSelectedEtaTemplate(value);
                              if (value) setSettings((current) => ({ ...current, successMessage: value }));
                            }}
                          />
                          <Select
                            label="Insert dynamic value"
                            options={SHORTCODE_OPTIONS}
                            value={selectedShortcode}
                            disabled={!isAdvanced}
                            onChange={(value) => {
                              setSelectedShortcode("");
                              if (!value) return;
                              setSettings((current) => ({
                                ...current,
                                successMessage: `${current.successMessage.trim()} {${value}}`.trim(),
                              }));
                            }}
                          />
                        </FormLayout.Group>
                        <TextField
                          label="ETA message"
                          name="successMessage"
                          value={settings.successMessage}
                          multiline={3}
                          disabled={!isAdvanced}
                          onChange={(value) =>
                            setSettings((current) => ({ ...current, successMessage: value }))
                          }
                          autoComplete="off"
                          helpText="Use the selectors above to insert safe date values. The final message is plain text on the storefront."
                        />
                        <InlineStack gap="200" wrap>
                          {[
                            "{min_delivery_date}",
                            "{max_delivery_date}",
                            "{delivery_date_range}",
                            "{order_date}",
                            "{dispatch_date_formatted}",
                            "{min_lead_days}",
                            "{max_lead_days}",
                          ].map((shortcode) => <Badge key={shortcode}>{shortcode}</Badge>)}
                        </InlineStack>
                      </BlockStack>
                    </Card>
                    <TextField
                      label="Unavailable message"
                      name="unavailableMessage"
                      value={settings.unavailableMessage}
                      disabled={!isAdvanced}
                      onChange={(value) =>
                        setSettings((current) => ({ ...current, unavailableMessage: value }))
                      }
                      autoComplete="off"
                    />
                    <FormLayout.Group condensed>
                      <TextField
                        label="COD available message"
                        name="codAvailableMessage"
                        value={settings.codAvailableMessage}
                        disabled={!isAdvanced}
                        onChange={(value) =>
                          setSettings((current) => ({ ...current, codAvailableMessage: value }))
                        }
                        autoComplete="off"
                      />
                      <TextField
                        label="COD unavailable message"
                        name="codUnavailableMessage"
                        value={settings.codUnavailableMessage}
                        disabled={!isAdvanced}
                        onChange={(value) =>
                          setSettings((current) => ({ ...current, codUnavailableMessage: value }))
                        }
                        autoComplete="off"
                      />
                    </FormLayout.Group>
                    <TextField
                      label="Delivery charge message"
                      name="deliveryChargeMessage"
                      value={settings.deliveryChargeMessage}
                      disabled={!isAdvanced}
                      onChange={(value) =>
                        setSettings((current) => ({ ...current, deliveryChargeMessage: value }))
                      }
                      autoComplete="off"
                      helpText="Shown only when a delivery charge exists. Variables: {currency}, {delivery_charge}."
                    />

                    <Card>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">Live message preview</Text>
                        <Text as="p">{previewMessage || "Your delivery estimate will appear here."}</Text>
                        <div className="incode-store-preview__journey">
                          {[
                            ["1", "Order now", sampleOrderDate],
                            ["2", "Ready to ship", sampleDispatchDate],
                            ["3", "At your doorstep", `${sampleMinDeliveryDate} - ${sampleMaxDeliveryDate}`],
                          ].map(([step, label, date], index) => (
                            <div key={label} className={`incode-store-preview__step${index === 0 ? " incode-store-preview__step--active" : ""}`}>
                              <span>{step}</span>
                              <strong>{label}</strong>
                              <small>{date}</small>
                            </div>
                          ))}
                        </div>
                        <Text as="p" tone="subdued">
                          Preview data uses a sample US postal code. The storefront uses the shopper&apos;s real rule, locale, and dates.
                        </Text>
                      </BlockStack>
                    </Card>

                    <Button submit variant="primary" loading={isIntentSaving("save_settings")}>
                      Save settings
                    </Button>
                  </FormLayout>
                </fetcher.Form>
              </BlockStack>
            </Card>

            <div id="imports" className="incode-section-anchor" />
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                  <Text as="h2" variant="headingMd">
                    Bulk postal code upload
                  </Text>
                  <Button onClick={downloadCsvTemplate}>Download CSV template</Button>
                </InlineStack>
                <Text as="p" tone="subdued">
                  CSV columns: country, postal_code, delivery_days,
                  serviceable, cod_available, delivery_charge, currency, city,
                  state, zone, same_day, next_day, express.
                  {" "}
                  Up to <strong>100,000 rows per import.</strong>{" "}
                  <code>postal_code</code> accepts exact codes, ranges
                  (<code>10000-10999</code>), and wildcards (<code>123*</code>).
                   The optional <code>zone</code> column auto-creates zones.
                   Download the official blank template, add one delivery rule per row, and keep the column names unchanged.
                 </Text>
                <DropZone
                  accept=".csv,text/csv"
                  allowMultiple={false}
                  error={csvRejected}
                  onDropAccepted={(files) => {
                    setCsvRejected(false);
                    setCsvFile(files[0] ?? null);
                  }}
                  onDropRejected={() => {
                    setCsvRejected(true);
                    setCsvFile(null);
                  }}
                >
                  <DropZone.FileUpload actionHint="Accepts one CSV file up to 8MB and 100,000 rows" />
                </DropZone>
                {csvFile ? (
                  <Text as="p" tone="subdued">
                    Selected file: {csvFile.name}
                  </Text>
                ) : null}
                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    disabled={!csvFile || isSaving}
                    loading={isIntentSaving("bulk_import_csv")}
                    onClick={submitCsvImport}
                  >
                    Import CSV
                  </Button>
                  <Button url={isAdvanced ? "/app/delivery-export" : "/app/plans"}>{isAdvanced ? "Export CSV" : "Upgrade to export"}</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Google Sheet sync
                </Text>
                <Text as="p" tone="subdued">
                  Paste a published Google Sheets CSV URL, then sync rows using the same import validation as CSV upload.
                </Text>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="save_google_sheet" />
                  <FormLayout>
                    <TextField
                      label="Google Sheet CSV URL"
                      name="googleSheetCsvUrl"
                      value={googleSheetCsvUrl}
                      onChange={setGoogleSheetCsvUrl}
                      autoComplete="off"
                      placeholder="https://docs.google.com/spreadsheets/d/.../pub?output=csv"
                    />
                    <InlineStack gap="300">
                      <Button submit loading={isIntentSaving("save_google_sheet")} disabled={!isAdvanced}>Save URL</Button>
                    </InlineStack>
                  </FormLayout>
                </fetcher.Form>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="sync_google_sheet" />
                  <Button submit variant="primary" loading={isIntentSaving("sync_google_sheet")} disabled={!isAdvanced}>Sync now</Button>
                </fetcher.Form>
                <Text as="p" tone="subdued">
                  Last sync: {data.setting.lastGoogleSheetSyncAt ? new Date(data.setting.lastGoogleSheetSyncAt).toLocaleString() : "Never"}
                  {data.setting.lastGoogleSheetSyncStatus ? ` (${data.setting.lastGoogleSheetSyncStatus})` : ""}
                </Text>
              </BlockStack>
            </Card>

            <div id="coverage" className="incode-section-anchor" />
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Import history
                </Text>
                {importRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "numeric", "text"]}
                    headings={["Date", "Source", "Status", "Rows", "Success", "Failed rows"]}
                    rows={importRows}
                    increasedTableDensity
                  />
                ) : (
                  <Text as="p" tone="subdued">No imports yet.</Text>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <div id="postal-rule-form" className="incode-section-anchor" />
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      {editingPostalRule ? `Edit postal rule ${editingPostalRule.postalCode}` : "Add one postal rule"}
                    </Text>
                    {editingPostalRule ? <Text as="p" tone="subdued">Update any field, then save to overwrite this rule.</Text> : null}
                  </BlockStack>
                  {editingPostalRule ? (
                    <Button
                      size="slim"
                      onClick={() => {
                        setEditingPostalRule(null);
                        setPostalCodeForm((current) => ({
                          ...current,
                          postalCode: "",
                          deliveryDays: "",
                          zoneId: "",
                          zone: "",
                          city: "",
                          state: "",
                          deliveryCharge: "",
                          currency: "",
                          serviceable: true,
                          codAvailable: false,
                          sameDayAvailable: false,
                          nextDayAvailable: false,
                          expressAvailable: false,
                        }));
                      }}
                    >
                      Cancel edit
                    </Button>
                  ) : null}
                </InlineStack>
                <Text as="p" tone="subdued">
                  Accepts exact postal codes, comma-separated postal codes, a range like
                  10000-10999, or a wildcard prefix like 123* (or SW1A*). Unlimited rules.
                </Text>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="upsert_single_postal_code" />
                  {editingPostalRule ? <input type="hidden" name="postalRuleId" value={editingPostalRule.id} /> : null}
                  <FormLayout>
                    <FormLayout.Group condensed>
                      <Select
                        label="Country"
                        name="country"
                        options={COUNTRY_OPTIONS}
                        value={postalCodeForm.country}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({
                            ...current,
                            country: value,
                            city: "",
                            state: "",
                          }))
                        }
                      />
                      <TextField
                        label="Postal code, range, or wildcard"
                        name="postalCode"
                        value={postalCodeForm.postalCode}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, postalCode: value }))
                        }
                        placeholder="10001 · 10000-10999 · 123*"
                        autoComplete="postal-code"
                        requiredIndicator
                        helpText={
                          postalCodeForm.postalCode.includes("*")
                            ? "Wildcard pattern detected."
                            : postalCodeForm.postalCode.includes("-") &&
                                !/^\d{5}-\d{4}$/.test(postalCodeForm.postalCode.trim())
                              ? "Hyphen detected — will be saved as a range if both ends are valid."
                            : "Exact code, comma-separated codes, range, or wildcard ending in *."
                        }
                      />
                      <TextField
                        label="Delivery days"
                        name="deliveryDays"
                        type="number"
                        min={0}
                        max={60}
                        value={postalCodeForm.deliveryDays}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, deliveryDays: value }))
                        }
                        placeholder="2"
                        autoComplete="off"
                        requiredIndicator
                      />
                    </FormLayout.Group>

                    <FormLayout.Group condensed>
                      <Select
                        label="Zone"
                        name="zoneId"
                        options={zoneOptions}
                        value={postalCodeForm.zoneId}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, zoneId: value, zone: "" }))
                        }
                        helpText="Pick a zone, or type a new zone name below."
                      />
                      <TextField
                        label="Zone name (or new zone)"
                        name="zone"
                        value={postalCodeForm.zone}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, zone: value }))
                        }
                        placeholder="metro"
                        autoComplete="off"
                      />
                    </FormLayout.Group>

                    <FormLayout.Group condensed>
                      <Autocomplete
                        options={cityOptions}
                        selected={postalCodeForm.city ? [postalCodeForm.city] : []}
                        onSelect={(selected) => {
                          const city = selected[0] ?? "";
                          setPostalCodeForm((current) => ({
                            ...current,
                            city,
                            state: stateForCity(current.country, city) || current.state,
                          }));
                        }}
                        emptyState="No city suggestions for this country."
                        textField={
                          <Autocomplete.TextField
                            label="City"
                            value={postalCodeForm.city}
                            onChange={(value) =>
                              setPostalCodeForm((current) => ({ ...current, city: value }))
                            }
                            placeholder="Select a city"
                            autoComplete="address-level2"
                            helpText="Choose a suggested city; selecting Pune fills Maharashtra automatically."
                          />
                        }
                      />
                      <Autocomplete
                        options={stateOptions}
                        selected={postalCodeForm.state ? [postalCodeForm.state] : []}
                        onSelect={(selected) =>
                          setPostalCodeForm((current) => ({
                            ...current,
                            state: selected[0] ?? "",
                            city: "",
                          }))
                        }
                        emptyState="No state suggestions for this country."
                        textField={
                          <Autocomplete.TextField
                            label="State"
                            value={postalCodeForm.state}
                            onChange={(value) =>
                              setPostalCodeForm((current) => ({ ...current, state: value }))
                            }
                            placeholder="Select a state"
                            autoComplete="address-level1"
                            helpText="Choose a suggested state before selecting a city."
                          />
                        }
                      />
                      <input type="hidden" name="city" value={postalCodeForm.city} />
                      <input type="hidden" name="state" value={postalCodeForm.state} />
                    </FormLayout.Group>

                    <FormLayout.Group condensed>
                      <TextField
                        label="Delivery charge"
                        name="deliveryCharge"
                        type="number"
                        min={0}
                        value={postalCodeForm.deliveryCharge}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, deliveryCharge: value }))
                        }
                        placeholder="50"
                        autoComplete="off"
                      />
                      <TextField
                        label="Currency"
                        name="currency"
                        value={postalCodeForm.currency}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, currency: value.toUpperCase() }))
                        }
                        placeholder="INR"
                        maxLength={3}
                        autoComplete="off"
                      />
                    </FormLayout.Group>

                    <Checkbox
                      label="Serviceable"
                      checked={postalCodeForm.serviceable}
                      onChange={(checked) =>
                        setPostalCodeForm((current) => ({ ...current, serviceable: checked }))
                      }
                    />
                    <input type="hidden" name="serviceable" value={String(postalCodeForm.serviceable)} />
                    <Checkbox
                      label="COD available"
                      checked={postalCodeForm.codAvailable}
                      onChange={(checked) =>
                        setPostalCodeForm((current) => ({ ...current, codAvailable: checked }))
                      }
                    />
                    <input type="hidden" name="codAvailable" value={String(postalCodeForm.codAvailable)} />
                    <Checkbox
                      label="Same-day delivery available"
                      checked={postalCodeForm.sameDayAvailable}
                      onChange={(checked) =>
                        setPostalCodeForm((current) => ({ ...current, sameDayAvailable: checked }))
                      }
                    />
                    <input type="hidden" name="sameDayAvailable" value={String(postalCodeForm.sameDayAvailable)} />
                    <Checkbox
                      label="Next-day delivery available"
                      checked={postalCodeForm.nextDayAvailable}
                      onChange={(checked) =>
                        setPostalCodeForm((current) => ({ ...current, nextDayAvailable: checked }))
                      }
                    />
                    <input type="hidden" name="nextDayAvailable" value={String(postalCodeForm.nextDayAvailable)} />
                    <Checkbox
                      label="Express delivery available"
                      checked={postalCodeForm.expressAvailable}
                      onChange={(checked) =>
                        setPostalCodeForm((current) => ({ ...current, expressAvailable: checked }))
                      }
                    />
                    <input type="hidden" name="expressAvailable" value={String(postalCodeForm.expressAvailable)} />

                    <Button submit variant="primary" loading={isIntentSaving("upsert_single_postal_code")}>
                      {editingPostalRule ? "Update postal rule" : "Save postal code"}
                    </Button>
                    {fetcher.state === "idle" && fetcher.data?.intent === "upsert_single_postal_code" ? (
                      <Banner tone={fetcher.data.ok ? "success" : "critical"} title={fetcher.data.ok ? "Postal rule saved" : "Postal rule not saved"}>
                        <BlockStack gap="100">
                          <Text as="p">{fetcher.data.message}</Text>
                          {fetcher.data.ok && fetcher.data.savedRules?.length ? (
                            <Text as="p" tone="subdued">
                              Saved under the coverage rules table below: {fetcher.data.savedRules.join(", ")}.
                            </Text>
                          ) : null}
                        </BlockStack>
                      </Banner>
                    ) : null}
                  </FormLayout>
                </fetcher.Form>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Add multiple postal codes manually
                </Text>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="bulk_manual_rows" />
                  <FormLayout>
                    <TextField
                      label="Manual rows"
                      name="manualRows"
                      value={manualRows}
                      onChange={setManualRows}
                      multiline={7}
                      monospaced
                      autoComplete="off"
                      placeholder={
                        "US,10001,2,true,true,New York,New York,metro,8,USD,false,true,true\nUS,10000-10999,3,true,false,,,metro,10,USD,false,false,false\nIN,4*,2,true,true,Rural MH,,rural,40,INR,false,true,false"
                      }
                      helpText="One row per line: country, postal_code, delivery_days, serviceable, cod_available, city, state, zone, delivery_charge, currency, same_day, next_day, express. postal_code may be exact, a range (10000-10999), or a wildcard (4*). Max 1,000 rows."
                      requiredIndicator
                    />
                    <Button submit variant="primary" loading={isIntentSaving("bulk_manual_rows")}>
                      Save manual rows
                    </Button>
                  </FormLayout>
                </fetcher.Form>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Recent rules</Text>
                    <Text as="p" tone="subdued">Browse postal rules by delivery zone. Edit or remove any rule directly.</Text>
                  </BlockStack>
                  <Badge tone="info">{`${visibleRules.length} shown`}</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">
                  Showing {visibleRules.length} of {data.totalPatterns} rules
                  ({data.patternCount} range/wildcard).
                </Text>
                <div className="incode-rule-tabs" role="tablist" aria-label="Filter rules by zone">
                  {ruleGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      role="tab"
                      aria-selected={activeRuleGroup === group.id}
                      className={`incode-rule-tab${activeRuleGroup === group.id ? " is-active" : ""}`}
                      onClick={() => setActiveRuleGroup(group.id)}
                    >
                      {group.label}
                      <span>{group.count}</span>
                    </button>
                  ))}
                </div>
                {tableRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "numeric", "text", "text", "text", "text", "text", "text"]}
                    headings={["Country", "Pattern", "Type", "Zone", "Days", "Serviceable", "COD", "Charge", "City", "State", "Actions"]}
                    rows={tableRows}
                    increasedTableDensity
                  />
                ) : (
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="h3" variant="headingMd">No coverage rules yet</Text>
                    <Text as="p" tone="subdued">Add one rule above or import a CSV to start answering delivery checks.</Text>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Storefront preview</Text>
                  <Badge tone="success">Live</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">
                  This is how the delivery journey appears inside your product page block.
                </Text>
                <div className="incode-store-preview">
                  <div className="incode-store-preview__product">
                    <div className="incode-store-preview__image" aria-hidden="true">ETA</div>
                    <Badge tone="info">Delivery checker</Badge>
                  </div>
                  <Text as="p" variant="bodyMd">
                    Receive your order by <strong>{previewDeliveryDate}</strong>
                  </Text>
                  <div className="incode-store-preview__journey">
                    <div className="incode-store-preview__step incode-store-preview__step--active">
                      <span>1</span>
                      <strong>Order now</strong>
                      <small>Today</small>
                    </div>
                    <div className="incode-store-preview__step">
                      <span>2</span>
                      <strong>Ready to ship</strong>
                      <small>{settings.processingDays || "0"} days</small>
                    </div>
                    <div className="incode-store-preview__step">
                      <span>3</span>
                      <strong>At your door</strong>
                      <small>{settings.processingDays || "0"} + 5 days</small>
                    </div>
                  </div>
                </div>
                <Button url={themeEditorUrl} external fullWidth>
                  Customize in Theme Editor
                </Button>
              </BlockStack>
            </Card>
            <div id="holidays" className="incode-section-anchor" />
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Holiday dates
                </Text>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="add_holiday" />
                  <FormLayout>
                    <TextField
                      label="Holiday date"
                      name="holidayDate"
                      type="date"
                      value={holidayDate}
                      onChange={setHolidayDate}
                      autoComplete="off"
                      requiredIndicator
                    />
                    <Button submit variant="primary" loading={isIntentSaving("add_holiday")}>
                      Add holiday
                    </Button>
                  </FormLayout>
                </fetcher.Form>

                {holidays.length === 0 ? (
                  <Text as="p" tone="subdued">
                    No holidays added yet.
                  </Text>
                ) : (
                  <InlineStack gap="200">
                    {holidays.map((holiday) => (
                      <fetcher.Form key={holiday} method="post">
                        <input type="hidden" name="intent" value="remove_holiday" />
                        <input type="hidden" name="holidayDate" value={holiday} />
                        <Button submit size="slim" tone="critical" accessibilityLabel={`Remove holiday ${holiday}`}>
                          Remove {holiday}
                        </Button>
                      </fetcher.Form>
                    ))}
                  </InlineStack>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Review checklist
                </Text>
                <Text as="p" tone="subdued">
                  Keep delivery messages accurate, avoid test data in production,
                  and verify the storefront extension before Shopify App Store
                  submission.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
