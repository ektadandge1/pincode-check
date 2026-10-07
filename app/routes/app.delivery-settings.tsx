import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useBeforeUnload, useBlocker, useFetcher, useLoaderData, useSearchParams } from "react-router";
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
  Modal,
  Page,
  Select,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import prisma from "../db.server";
import { requireActiveBilling } from "../services/billing.server";
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
import { resolvePlanAccess } from "../services/plan-access.server";
import { requireFeature } from "../services/plans.server";
import { clearDeliveryCheckCaches } from "../services/delivery-checker.server";
import {
  DELIVERY_MESSAGE_SHORTCODES,
  renderDeliveryMessage,
  unsupportedDeliveryShortcodes,
} from "../utils/delivery-message";
import { regionsForCountry, suggestedRegions } from "../utils/regions";
import { compactCollectionName } from "../utils/target-display";
import { buildPostalCsvTemplate } from "../utils/postal-csv-template";
import { BULK_RULE_FIELDS, parseZoneRulePatch, validatePatchedRule } from "../utils/zone-rule-edit";
import type { loader as zoneRulesLoader } from "./app.zone-rules";

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

const WEEKEND_OPTIONS = [
  { label: "No closed weekdays", value: "" },
  { label: "Sunday only", value: "0" },
  { label: "Saturday and Sunday", value: "0,6" },
  { label: "Saturday only", value: "6" },
];

const SETTINGS_TABS = [
  { id: "coverage", label: "Coverage", description: "Start here: create zones, add postal rules, and review where you deliver." },
  { id: "timing", label: "Delivery Timing", description: "Set preparation and transit defaults, then configure your business calendar and date display." },
  { id: "products", label: "Product Rules", description: "Add exceptions for products, collections, vendors, or tags after setting your coverage and timing defaults." },
  { id: "cart", label: "Cart Protection", description: "Choose how the storefront widget controls Add to Cart. These controls are not server-side checkout validation." },
  { id: "messages", label: "Messages", description: "Choose shopper-facing wording and review a sample before saving. Product rules can override the success message." },
  { id: "imports", label: "Imports & Sync", description: "Add coverage in bulk with a CSV, a published Google Sheet, or pasted rows. Review import results here." },
] as const;

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
  const { admin, session } = await requireActiveBilling(request);
  const shop = session.shop;
  const access = await resolvePlanAccess({ shop, admin });
  const params = new URL(request.url).searchParams;
  const coverageSearch = (params.get("coverageSearch") ?? "").trim().slice(0, 100);
  const coverageGroup = params.get("coverageGroup") ?? "all";
  const pageSize = 25;
  const requestedPage = (key: string) => Math.max(1, Math.min(1000000, Math.floor(Number(params.get(key)) || 1)));
  const coverageWhere = {
    shop,
    ...(coverageGroup === "unassigned" ? { zoneId: null, zone: null } : /^\d+$/.test(coverageGroup) ? { zoneId: Number(coverageGroup) } : {}),
    ...(coverageSearch ? { OR: [
      { postalCode: { contains: coverageSearch } }, { country: { contains: coverageSearch.toUpperCase() } },
      { city: { contains: coverageSearch } }, { state: { contains: coverageSearch } }, { zone: { contains: coverageSearch } },
    ] } : {}),
  };
  const coverageCount = await prisma.postalCode.count({ where: coverageWhere });
  const coveragePage = Math.min(requestedPage("coveragePage"), Math.max(1, Math.ceil(coverageCount / pageSize)));

  const setting =
    (await prisma.deliverySetting.findUnique({ where: { shop } })) ??
    (await prisma.deliverySetting.findUnique({ where: { shop: "default" } }));

  const rows = await prisma.postalCode.findMany({
    where: coverageWhere,
    orderBy: [{ country: "asc" }, { patternType: "asc" }, { postalCode: "asc" }, { id: "asc" }],
    skip: (coveragePage - 1) * pageSize,
    take: pageSize,
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
  const targetCount = await prisma.deliveryTarget.count({ where: { shop } });
  const targetPage = Math.min(requestedPage("targetPage"), Math.max(1, Math.ceil(targetCount / pageSize)));
  const targets = await prisma.deliveryTarget.findMany({
    where: { shop },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    skip: (targetPage - 1) * pageSize,
    take: pageSize,
  });
  const unassignedCount = await prisma.postalCode.count({ where: { shop, zoneId: null, zone: null } });

  const recentImports = await prisma.importJob.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  let collections: Array<{ id: string; title: string; handle: string }> = [];
  let products: Array<{ id: string; title: string; handle: string }> = [];
  try {
    let collectionCursor: string | null = null;
    let productCursor: string | null = null;
    let loadCollections = true;
    let loadProducts = true;
    for (let page = 0; page < 20 && (loadCollections || loadProducts); page += 1) {
      const variableDefinitions = [
        loadCollections ? "$collectionCursor: String" : "",
        loadProducts ? "$productCursor: String" : "",
      ].filter(Boolean).join(", ");
      const response = await admin.graphql(`#graphql
        query DeliverySettingsCatalog${variableDefinitions ? `(${variableDefinitions})` : ""} {
          ${loadCollections ? "collections(first: 250, after: $collectionCursor, sortKey: TITLE) { nodes { id title handle } pageInfo { hasNextPage endCursor } }" : ""}
          ${loadProducts ? "products(first: 250, after: $productCursor, sortKey: TITLE) { nodes { id title handle } pageInfo { hasNextPage endCursor } }" : ""}
        }
      `, { variables: {
        ...(loadCollections ? { collectionCursor } : {}),
        ...(loadProducts ? { productCursor } : {}),
      } });
      if (!response.ok) break;
      const json = await response.json() as { data?: {
        collections?: { nodes?: Array<{ id: string; title: string; handle: string }>; pageInfo?: { hasNextPage?: boolean; endCursor?: string } };
        products?: { nodes?: Array<{ id: string; title: string; handle: string }>; pageInfo?: { hasNextPage?: boolean; endCursor?: string } };
      } };
      const collectionPage = json.data?.collections;
      const productPage = json.data?.products;
       if (loadCollections) collections.push(...(collectionPage?.nodes ?? []));
       if (loadProducts) products.push(...(productPage?.nodes ?? []));
      const nextCollectionCursor = collectionPage?.pageInfo?.hasNextPage ? collectionPage.pageInfo.endCursor ?? null : null;
      const nextProductCursor = productPage?.pageInfo?.hasNextPage ? productPage.pageInfo.endCursor ?? null : null;
      loadCollections = loadCollections && Boolean(nextCollectionCursor && nextCollectionCursor !== collectionCursor);
      loadProducts = loadProducts && Boolean(nextProductCursor && nextProductCursor !== productCursor);
      collectionCursor = nextCollectionCursor;
      productCursor = nextProductCursor;
      if (!loadCollections && !loadProducts) break;
    }
    collections = [...new Map(collections.map((collection) => [collection.id, collection])).values()];
    products = [...new Map(products.map((product) => [product.id, product])).values()];
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
      countdownEnabled: true,
      countdownTargetMode: "all",
      countdownProductIdsCsv: "",
      countdownCollectionHandlesCsv: "",
      countdownZoneIdsCsv: "",
      countdownDisplaySurfacesCsv: "product",
      googleSheetCsvUrl: "",
      lastGoogleSheetSyncAt: null,
      lastGoogleSheetSyncStatus: null,
    },
    samplePostalCodes: rows,
    coverageSearch, coverageGroup, coveragePage, coverageCount, pageSize, targetPage, unassignedCount,
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
  const context = await requireActiveBilling(request);
  const result = await deliverySettingsAction(request, context);
  if (result.ok) clearDeliveryCheckCaches(context.session.shop);
  return result;
}

async function deliverySettingsAction(request: Request, { admin, session }: Awaited<ReturnType<typeof requireActiveBilling>>) {
  const shop = session.shop;
  const access = await resolvePlanAccess({ shop, admin });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save_countdown") {
    const countdownEnabled = parseBool(formData.get("countdownEnabled"));
    const countdownTargetMode = String(formData.get("countdownTargetMode") ?? "all");
    const countdownProductIdsCsv = String(formData.get("countdownProductIdsCsv") ?? "")
      .split(",").map((value) => value.trim().replace(/\D/g, "")).filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index).join(",");
    const countdownCollectionHandlesCsv = String(formData.get("countdownCollectionHandlesCsv") ?? "")
      .toLowerCase().split(",").map((value) => value.trim().replace(/[^a-z0-9-]/g, "")).filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index).join(",");
    const countdownZoneIdsCsv = String(formData.get("countdownZoneIdsCsv") ?? "")
      .split(",").map((value) => value.trim().replace(/\D/g, "")).filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index).join(",");
    const countdownDisplaySurfacesCsv = String(formData.get("countdownDisplaySurfacesCsv") ?? "product")
      .split(",").filter((value, index, values) => ["product", "collection", "cart", "index", "search", "page"].includes(value) && values.indexOf(value) === index).join(",") || "product";

    if (!["all", "products", "collections", "zones"].includes(countdownTargetMode)) {
      return { ok: false, message: "Choose a valid countdown audience." } satisfies ActionData;
    }
    if (countdownTargetMode === "products" && !countdownProductIdsCsv) {
      return { ok: false, message: "Add at least one product for this countdown audience." } satisfies ActionData;
    }
    if (countdownTargetMode === "collections" && !countdownCollectionHandlesCsv) {
      return { ok: false, message: "Add at least one collection for this countdown audience." } satisfies ActionData;
    }
    if (countdownTargetMode === "zones" && !countdownZoneIdsCsv) {
      return { ok: false, message: "Choose at least one delivery zone for this countdown audience." } satisfies ActionData;
    }
    await prisma.deliverySetting.upsert({
      where: { shop },
      create: { shop, countdownEnabled, countdownTargetMode, countdownProductIdsCsv, countdownCollectionHandlesCsv, countdownZoneIdsCsv, countdownDisplaySurfacesCsv },
      update: { countdownEnabled, countdownTargetMode, countdownProductIdsCsv, countdownCollectionHandlesCsv, countdownZoneIdsCsv, countdownDisplaySurfacesCsv },
    });
    return { ok: true, intent, message: "Countdown settings saved." } satisfies ActionData;
  }

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
    const weekendDaysCsv = [...new Set(weekendDays)].sort().join(",");
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

    return { ok: true, intent, message: "Settings saved." } satisfies ActionData;
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

  if (intent === "create_zone" || intent === "update_zone") {
    requireFeature(access, "zones");
    const name = String(formData.get("zoneName") ?? "").trim();
    const countryRaw = String(formData.get("zoneCountry") ?? "").trim();
    const priority = Number(formData.get("zonePriority") ?? 100);
    const zoneId = Number(formData.get("zoneId"));
    if (intent === "update_zone" && (!Number.isSafeInteger(zoneId) || zoneId <= 0)) {
      return { ok: false, message: "Invalid zone." } satisfies ActionData;
    }

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
    if (existing && (intent === "create_zone" || existing.id !== zoneId)) {
      return { ok: false, message: "A zone with this name already exists for this shop." } satisfies ActionData;
    }

    if (intent === "update_zone") {
      try {
        return await prisma.$transaction(async (tx) => {
          const zone = await tx.zone.findFirst({ where: { id: zoneId, shop } });
          if (!zone) return { ok: false, message: "Zone not found." } satisfies ActionData;
          await tx.zone.updateMany({
            where: { id: zoneId, shop },
            data: { name, country: countryRaw.toUpperCase() || null, priority },
          });
          await tx.postalCode.updateMany({ where: { shop, zoneId }, data: { zone: name } });
          return { ok: true, message: "Zone updated. Rule countries were not changed.", intent, zoneId } satisfies ActionData;
        });
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
          return { ok: false, message: "A zone with this name already exists for this shop." } satisfies ActionData;
        }
        throw error;
      }
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
    return prisma.$transaction(async (tx) => {
      const zone = await tx.zone.findFirst({ where: { id: zoneId, shop }, include: { _count: { select: { postalCodes: true } } } });
      if (!zone) return { ok: false, message: "Zone not found." } satisfies ActionData;
      if (!zone.enabled && zone._count.postalCodes > 0) {
        return { ok: false, message: `Cannot delete disabled zone "${zone.name}" while it contains postal rules: detaching them could make them active again. Edit the zone and reassign or delete its rules first, then delete the empty zone.` } satisfies ActionData;
      }
      await tx.postalCode.updateMany({ where: { zoneId, shop }, data: { zoneId: null } });
      await tx.zone.delete({ where: { id: zoneId } });
      return { ok: true, message: `Zone "${zone.name}" deleted. Its postal rules were kept without this zone's enabled status or priority.`, intent: "delete_zone", zoneId } satisfies ActionData;
    }, { isolationLevel: "Serializable" });
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

  if (intent === "bulk_update_zone_rules") {
    requireFeature(access, "zones");
    const zoneId = Number(formData.get("zoneId"));
    const ids = [...new Set(formData.getAll("postalRuleIds").map(Number))];
    if (!Number.isSafeInteger(zoneId) || zoneId <= 0 || ids.length === 0 || ids.length > 25
      || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      return { ok: false, message: "Select 1 to 25 postal rules in this zone." } satisfies ActionData;
    }
    let patch;
    try {
      patch = parseZoneRulePatch(formData);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Invalid changes." } satisfies ActionData;
    }
    if (patch.deliveryCharge !== undefined || patch.currency !== undefined
      || patch.sameDayAvailable !== undefined || patch.nextDayAvailable !== undefined || patch.expressAvailable !== undefined) {
      requireFeature(access, "deliveryOptions");
    }
    return prisma.$transaction(async (tx) => {
      const zone = await tx.zone.findFirst({ where: { id: zoneId, shop } });
      if (!zone) return { ok: false, message: "Zone not found." } satisfies ActionData;
      const where = { shop, zoneId, id: { in: ids } };
      const rules = await tx.postalCode.findMany({ where });
      if (rules.length !== ids.length) {
        return { ok: false, message: "Some selected rules no longer belong to this zone. Reload the list and select again." } satisfies ActionData;
      }
      try {
        for (const rule of rules) validatePatchedRule(rule, patch);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Invalid changes." } satisfies ActionData;
      }
      await tx.postalCode.updateMany({ where, data: patch });
      return { ok: true, message: `${rules.length} postal rules updated.`, intent, zoneId } satisfies ActionData;
    });
  }

  if (intent === "upsert_single_postal_code") {
    const postalRuleIdRaw = String(formData.get("postalRuleId") ?? "").trim();
    const postalRuleId = postalRuleIdRaw ? Number(postalRuleIdRaw) : null;
    const editingZoneIdRaw = formData.get("editingZoneId");
    const editingZoneId = editingZoneIdRaw === null ? null : Number(editingZoneIdRaw);
    if (editingZoneId !== null && (!Number.isSafeInteger(editingZoneId) || editingZoneId <= 0 || postalRuleId === null)) {
      return { ok: false, message: "Invalid zone edit." } satisfies ActionData;
    }
    if (editingZoneId !== null) requireFeature(access, "zones");
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
          if (editingZoneId !== null) {
            const zone = await tx.zone.findFirst({ where: { id: editingZoneId, shop } });
            const member = await tx.postalCode.findFirst({ where: { id: postalRuleId, shop, zoneId: editingZoneId } });
            if (!zone || !member) throw new Error("The selected rule no longer belongs to this zone.");
          }
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
            where: { id: selectedRule.id, shop, ...(editingZoneId !== null ? { zoneId: editingZoneId } : {}) },
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
        if (error instanceof Error && (error.message === "Selected zone was not found." || error.message === "The selected rule no longer belongs to this zone.")) {
          return { ok: false, message: error.message } satisfies ActionData;
        }
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
          return { ok: false, message: `A postal rule for ${country} ${parsed.pattern} already exists.` } satisfies ActionData;
        }
        if (editingZoneId !== null && typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
          return { ok: false, message: "The selected rule no longer belongs to this zone." } satisfies ActionData;
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

const RULE_FIELD_LABELS = {
  country: "Country", postalCode: "Postal code, range, or wildcard",
  deliveryDays: "Transit / delivery days", serviceable: "Delivery available", codAvailable: "COD available",
  deliveryCharge: "Delivery charge (blank to clear)", currency: "Currency (blank to clear)",
  sameDayAvailable: "Same-day available", nextDayAvailable: "Next-day available", expressAvailable: "Express available",
  city: "City (blank to clear)", state: "State / region (blank to clear)",
};
const RULE_BOOLEAN_FIELDS = new Set<string>(["serviceable", "codAvailable", "sameDayAvailable", "nextDayAvailable", "expressAvailable"]);
const RULE_EDIT_FIELDS = ["country", "postalCode", ...BULK_RULE_FIELDS] as const;
type RuleDraft = Record<(typeof RULE_EDIT_FIELDS)[number] | "zoneId" | "zone", string>;
type ZoneSummary = { id: number; name: string; country: string | null; priority: number; enabled: boolean };

function ZoneEditor({ zone, zones, deliveryOptions, onClose, onDirtyChange }: {
  zone: ZoneSummary; zones: ZoneSummary[]; deliveryOptions: boolean; onClose: () => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const list = useFetcher<typeof zoneRulesLoader>();
  const save = useFetcher<ActionData>();
  const { load } = list;
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [metadata, setMetadata] = useState({ name: zone.name, country: zone.country ?? "", priority: String(zone.priority) });
  const [savedMetadata, setSavedMetadata] = useState(metadata);
  const [rule, setRule] = useState<{ id: number; values: RuleDraft; original: RuleDraft } | null>(null);
  const [bulkValues, setBulkValues] = useState<Record<(typeof BULK_RULE_FIELDS)[number], string>>({
    deliveryDays: "", serviceable: "true", codAvailable: "false", deliveryCharge: "", currency: "",
    sameDayAvailable: "false", nextDayAvailable: "false", expressAvailable: "false", city: "", state: "",
  });
  const [applied, setApplied] = useState<string[]>([]);
  const [notice, setNotice] = useState<ActionData | null>(null);
  const pending = useRef<{ intent: string; metadata: typeof metadata } | null>(null);
  const ruleEditor = useRef<HTMLFormElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const saving = save.state !== "idle";
  const response = list.data;
  const current = response?.ok && response.zoneId === zone.id && response.search === search ? response : null;
  const loading = list.state !== "idle" || !response;
  const ruleDirty = rule !== null && JSON.stringify(rule.values) !== JSON.stringify(rule.original);
  const metadataDirty = JSON.stringify(metadata) !== JSON.stringify(savedMetadata);
  useBeforeUnload((event) => {
    if (metadataDirty || ruleDirty || applied.length > 0 || saving) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  useEffect(() => {
    onDirtyChange(metadataDirty || ruleDirty || applied.length > 0 || saving);
    return () => onDirtyChange(false);
  }, [metadataDirty, ruleDirty, applied.length, saving, onDirtyChange]);

  useEffect(() => {
    ruleEditor.current?.scrollIntoView({ block: "nearest" });
  }, [rule?.id]);

  useEffect(() => {
    if (notice) feedback.current?.scrollIntoView({ block: "nearest" });
  }, [notice]);

  useEffect(() => {
    const params = new URLSearchParams({ zoneId: String(zone.id), page: String(page), search });
    load(`/app/zone-rules?${params}`);
  }, [load, zone.id, page, search, revision]);

  useEffect(() => {
    if (save.state !== "idle" || !save.data || !pending.current) return;
    const submitted = pending.current;
    pending.current = null;
    setNotice(save.data);
    if (!save.data.ok) return;
    if (submitted.intent === "update_zone") setSavedMetadata(submitted.metadata);
    if (submitted.intent === "upsert_single_postal_code") setRule(null);
    if (submitted.intent === "bulk_update_zone_rules") setApplied([]);
    setSelected([]);
    setRevision((value) => value + 1);
  }, [save.data, save.state]);

  const close = () => {
    if (saving) return;
    if ((metadataDirty || ruleDirty || applied.length > 0) && !window.confirm("Discard unsaved zone and postal rule changes?")) return;
    onClose();
  };
  const discardRule = () => !ruleDirty || window.confirm("Discard unsaved postal rule changes?");
  const startSave = (intent: string) => {
    pending.current = { intent, metadata: { ...metadata } };
    setNotice(null);
  };
  const changeList = (nextPage: number, nextSearch: string) => {
    if (!discardRule()) return;
    setRule(null);
    setSelected([]);
    setPage(nextPage);
    setSearch(nextSearch);
    setRevision((value) => value + 1);
  };
  const field = (key: (typeof RULE_EDIT_FIELDS)[number], value: string, onChange: (value: string) => void, disabled = false) => (
    RULE_BOOLEAN_FIELDS.has(key)
      ? <Select label={RULE_FIELD_LABELS[key]} name={key} options={[{ label: "Yes", value: "true" }, { label: "No", value: "false" }]} value={value} onChange={onChange} disabled={disabled} />
      : <TextField label={RULE_FIELD_LABELS[key]} name={key} value={value} onChange={onChange} disabled={disabled} autoComplete="off"
          type={key === "deliveryDays" ? "number" : "text"}
          inputMode={key === "deliveryCharge" ? "decimal" : undefined}
          min={key === "deliveryDays" ? 0 : undefined}
          max={key === "deliveryDays" ? 60 : undefined} />
  );
  const optionField = (key: string) => ["deliveryCharge", "currency", "sameDayAvailable", "nextDayAvailable", "expressAvailable"].includes(key);

  return <Modal open onClose={close} title={`Edit zone: ${savedMetadata.name}`} size="large"
    secondaryActions={[{ content: "Close", onAction: close, disabled: saving }]}>
    <Modal.Section>
      <BlockStack gap="400">
        <div ref={feedback} aria-live="polite">
          {notice ? <Banner tone={notice.ok ? "success" : "critical"}>{notice.message}</Banner> : null}
        </div>
        {saving ? <InlineStack gap="200"><Spinner size="small" accessibilityLabel="Saving zone changes" /><Text as="p">Saving changes...</Text></InlineStack> : null}
        <save.Form method="post" onSubmit={() => startSave("update_zone")}>
          <input type="hidden" name="intent" value="update_zone" />
          <input type="hidden" name="zoneId" value={zone.id} />
          <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
            <FormLayout>
              <Text as="h2" variant="headingMd">Zone details</Text>
              <FormLayout.Group condensed>
                <TextField label="Zone name" name="zoneName" value={metadata.name} maxLength={60} autoComplete="off" onChange={(name) => setMetadata((value) => ({ ...value, name }))} />
                <TextField label="Country (optional)" name="zoneCountry" value={metadata.country} maxLength={2} autoComplete="off" onChange={(country) => setMetadata((value) => ({ ...value, country: country.toUpperCase() }))} helpText="2-letter ISO code, or blank for any. Does not change postal rule countries." />
                <TextField label="Priority" name="zonePriority" type="number" min={0} max={9999} value={metadata.priority} autoComplete="off" onChange={(priority) => setMetadata((value) => ({ ...value, priority }))} helpText="Lower wins." />
              </FormLayout.Group>
              <Button submit variant="primary" disabled={saving || !metadataDirty} loading={saving && pending.current?.intent === "update_zone"}>Save zone details</Button>
            </FormLayout>
          </fieldset>
        </save.Form>
      </BlockStack>
    </Modal.Section>
    <Modal.Section>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">Postal rules in this zone</Text>
        <form onSubmit={(event) => { event.preventDefault(); changeList(1, searchInput.trim().slice(0, 100)); }}>
          <InlineStack gap="200" blockAlign="end">
            <TextField label="Search postal code, country, city, or state" value={searchInput} onChange={setSearchInput} autoComplete="off" maxLength={100} disabled={saving || loading} />
            <Button submit disabled={saving || loading}>Search</Button>
            <Button onClick={() => { if (discardRule()) { setSearchInput(""); setRule(null); setSelected([]); setPage(1); setSearch(""); setRevision((value) => value + 1); } }} disabled={saving || loading}>Clear</Button>
          </InlineStack>
        </form>
        {loading ? <InlineStack gap="200"><Spinner size="small" accessibilityLabel="Loading zone postal rules" /><Text as="p">Loading postal rules...</Text></InlineStack> : null}
        {!loading && response && !response.ok ? <Banner tone="critical">{response.message}</Banner> : null}
        {!loading && current && !rule ? <>
          <Text as="p">{`${current.total} matching rules. Page ${current.page} of ${Math.max(1, Math.ceil(current.total / current.pageSize))}. ${selected.length} selected.`}</Text>
          <Checkbox label="Select all rules on this page" checked={current.rules.length > 0 && selected.length === current.rules.length} disabled={saving || !!rule || current.rules.length === 0}
            onChange={(checked) => setSelected(checked ? current.rules.map((row) => row.id) : [])} />
          <DataTable columnContentTypes={["text", "text", "text", "numeric", "text", "text", "text", "text", "text", "text"]}
            headings={["Select", "Country", "Postal rule", "Transit days", "Available", "COD", "Charge", "Location", "Options", "Actions"]}
            rows={current.rules.map((row) => [
              <Checkbox key={`${row.id}-select`} label={`Select ${row.country} ${row.postalCode}`} labelHidden checked={selected.includes(row.id)} disabled={saving || !!rule}
                onChange={(checked) => setSelected((ids) => checked ? [...ids, row.id] : ids.filter((id) => id !== row.id))} />,
              row.country, row.postalCode, row.deliveryDays, row.serviceable ? "Yes" : "No", row.codAvailable ? "Yes" : "No",
              row.deliveryCharge === null ? "-" : `${row.currency ?? ""} ${row.deliveryCharge}`,
              [row.city, row.state].filter(Boolean).join(", ") || "-",
              [row.sameDayAvailable && "Same-day", row.nextDayAvailable && "Next-day", row.expressAvailable && "Express"].filter(Boolean).join(", ") || "-",
              <Button key={`${row.id}-edit`} size="slim" disabled={saving} onClick={() => {
                if (!discardRule()) return;
                const values = Object.fromEntries(RULE_EDIT_FIELDS.map((key) => [key, row[key] === null ? "" : String(row[key])])) as RuleDraft;
                values.zoneId = String(zone.id);
                values.zone = current.zone.name;
                setRule({ id: row.id, values, original: { ...values } });
                setSelected([]);
                setNotice(null);
              }}>Edit</Button>,
            ])} increasedTableDensity />
          {current.total === 0 ? <Text as="p" tone="subdued">No postal rules match this search in this zone.</Text> : null}
          <InlineStack gap="200">
            <Button disabled={saving || current.page <= 1} onClick={() => changeList(current.page - 1, search)}>Previous</Button>
            <Button disabled={saving || current.page * current.pageSize >= current.total} onClick={() => changeList(current.page + 1, search)}>Next</Button>
          </InlineStack>
        </> : null}
        {rule ? <Banner tone="info">Editing postal rule <strong>{rule.values.postalCode}</strong>. Save it or cancel to return to the rules list.</Banner> : null}
        {rule ? <save.Form ref={ruleEditor} method="post" onSubmit={() => startSave("upsert_single_postal_code")}>
          <input type="hidden" name="intent" value="upsert_single_postal_code" />
          <input type="hidden" name="postalRuleId" value={rule.id} />
          <input type="hidden" name="editingZoneId" value={zone.id} />
          <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
              <FormLayout>
               <Text as="h3" variant="headingMd">Edit postal rule</Text>
              <FormLayout.Group condensed>
                {(["country", "postalCode", "deliveryDays", "serviceable", "codAvailable"] as const).map((key) => <div key={key}>
                  {field(key, rule.values[key], (value) => setRule((currentRule) => currentRule ? { ...currentRule, values: { ...currentRule.values, [key]: value } } : null), !deliveryOptions && optionField(key))}
                  {!deliveryOptions && optionField(key) ? <input type="hidden" name={key} value={rule.values[key]} /> : null}
                </div>)}
              </FormLayout.Group>
              <details className="incode-zone-editor__details">
                <summary>More delivery details</summary>
                <FormLayout.Group condensed>
                  {RULE_EDIT_FIELDS.filter((key) => !["country", "postalCode", "deliveryDays", "serviceable", "codAvailable"].includes(key)).map((key) => <div key={key}>
                    {field(key, rule.values[key], (value) => setRule((currentRule) => currentRule ? { ...currentRule, values: { ...currentRule.values, [key]: value } } : null), !deliveryOptions && optionField(key))}
                    {!deliveryOptions && optionField(key) ? <input type="hidden" name={key} value={rule.values[key]} /> : null}
                  </div>)}
                </FormLayout.Group>
                <FormLayout.Group condensed>
                  <Select label="Zone assignment" name="zoneId" value={rule.values.zoneId} options={[{ label: "No zone / use zone name below", value: "" }, ...zones.map((item) => ({ label: item.name, value: String(item.id) }))]}
                    onChange={(zoneId) => setRule((value) => value ? { ...value, values: { ...value.values, zoneId, zone: "" } } : null)} />
                  {!rule.values.zoneId ? <TextField label="Zone name (optional)" name="zone" value={rule.values.zone} autoComplete="off" onChange={(name) => setRule((value) => value ? { ...value, values: { ...value.values, zone: name } } : null)} /> : null}
                </FormLayout.Group>
              </details>
              <InlineStack gap="200">
                <Button submit variant="primary" loading={saving && pending.current?.intent === "upsert_single_postal_code"} disabled={saving || !ruleDirty}>Save postal rule</Button>
                <Button disabled={saving} onClick={() => { if (discardRule()) setRule(null); }}>Cancel rule edit</Button>
              </InlineStack>
            </FormLayout>
          </fieldset>
        </save.Form> : null}
      </BlockStack>
    </Modal.Section>
    <Modal.Section>
      <BlockStack gap="300">
        <details className="incode-zone-editor__details">
          <summary>Bulk update selected rules</summary>
          <Text as="p" tone="subdued">Select rules above, then choose only the fields you want to change. Blank charge, currency, city, or state clears that field.</Text>
          {BULK_RULE_FIELDS.map((key) => <BlockStack key={key} gap="200">
            <Checkbox label={`Apply ${RULE_FIELD_LABELS[key]}`} checked={applied.includes(key)} disabled={saving || !!rule || (!deliveryOptions && optionField(key))}
              onChange={(checked) => setApplied((keys) => checked ? [...keys, key] : keys.filter((item) => item !== key))} />
            {applied.includes(key) ? field(key, bulkValues[key], (value) => setBulkValues((values) => ({ ...values, [key]: value })), saving || !!rule) : null}
          </BlockStack>)}
        </details>
        <Button variant="primary" disabled={saving || loading || !current || !!rule || selected.length === 0 || applied.length === 0}
          loading={saving && pending.current?.intent === "bulk_update_zone_rules"} onClick={() => {
            const form = new FormData();
            form.set("intent", "bulk_update_zone_rules");
            form.set("zoneId", String(zone.id));
            for (const id of selected) form.append("postalRuleIds", String(id));
            for (const key of BULK_RULE_FIELDS) if (applied.includes(key)) {
              form.set(`apply_${key}`, "true");
              form.set(key, bulkValues[key]);
            }
            startSave("bulk_update_zone_rules");
            save.submit(form, { method: "post", action: "/app/delivery-settings" });
          }}>{`Update ${selected.length} selected rules`}</Button>
      </BlockStack>
    </Modal.Section>
  </Modal>;
}

export default function DeliverySettingsPage() {
  const data = useLoaderData<typeof loader>();
  const [editingZone, setEditingZone] = useState<(typeof data.zones)[number] | null>(null);
  const [zoneDirty, setZoneDirty] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [coverageSearchInput, setCoverageSearchInput] = useState(data.coverageSearch);
  const updateQuery = (values: Record<string, string>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(values).forEach(([key, value]) => params.set(key, value));
    setSearchParams(params);
  };
  const activeTab = SETTINGS_TABS.find((tab) => tab.id === searchParams.get("tab")) ?? SETTINGS_TABS[0];
  const tabUrl = (tab: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", tab);
    return `?${params.toString()}`;
  };
  const fetcher = useFetcher<ActionData>();
  const countdownFetcher = useFetcher<ActionData>();
  const isSaving = fetcher.state !== "idle";
  const isAdvanced = data.access.active;
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
  const [savedSettings, setSavedSettings] = useState(settings);
  const submittedSettings = useRef(settings);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.intent === "save_settings") setSavedSettings(submittedSettings.current);
  }, [fetcher.state, fetcher.data]);
  const settingsDirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const [holidayDate, setHolidayDate] = useState("");
  const [countdownSurfaces, setCountdownSurfaces] = useState(
    data.setting.countdownDisplaySurfacesCsv.split(",").filter(Boolean),
  );
  const [countdownEnabled, setCountdownEnabled] = useState(data.setting.countdownEnabled);
  const [countdownTargetMode, setCountdownTargetMode] = useState(data.setting.countdownTargetMode);
  const [countdownProductIds, setCountdownProductIds] = useState(data.setting.countdownProductIdsCsv);
  const [countdownCollectionHandles, setCountdownCollectionHandles] = useState(data.setting.countdownCollectionHandlesCsv);
  const [countdownZoneIds, setCountdownZoneIds] = useState(data.setting.countdownZoneIdsCsv);
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
  const targetBaseline = useRef(targetForm);
  const emptyTargetForm = useRef(targetForm);
  const [productSearch, setProductSearch] = useState("");
  const resetTargetForm = () => {
    targetBaseline.current = emptyTargetForm.current;
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
  const postalBaseline = useRef(postalCodeForm);
  const activeRuleGroup = data.coverageGroup;
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.intent === "upsert_single_postal_code") {
      setPostalCodeForm((current) => {
        const cleared = {
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
        };
        postalBaseline.current = cleared;
        return cleared;
      });
      setEditingPostalRule(null);
    }
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.intent === "delete_postal_rule") {
      setEditingPostalRule(null);
    }
  }, [fetcher.data, fetcher.state]);
  const [manualRows, setManualRows] = useState("");
  const draftsDirty = settingsDirty || JSON.stringify(targetForm) !== JSON.stringify(targetBaseline.current)
    || JSON.stringify(postalCodeForm) !== JSON.stringify(postalBaseline.current)
    || zoneForm.name !== "" || zoneForm.country !== "" || zoneForm.priority !== "100"
    || googleSheetCsvUrl !== (data.setting.googleSheetCsvUrl ?? "") || Boolean(manualRows.trim() || csvFile || holidayDate)
    || countdownEnabled !== data.setting.countdownEnabled || countdownTargetMode !== data.setting.countdownTargetMode
    || countdownProductIds !== data.setting.countdownProductIdsCsv || countdownCollectionHandles !== data.setting.countdownCollectionHandlesCsv
    || countdownZoneIds !== data.setting.countdownZoneIdsCsv || countdownSurfaces.join(",") !== data.setting.countdownDisplaySurfacesCsv;
  useBeforeUnload((event) => { if (draftsDirty) { event.preventDefault(); event.returnValue = ""; } });
  useBlocker(({ currentLocation, nextLocation }) => (zoneDirty || (draftsDirty && currentLocation.pathname !== nextLocation.pathname)) && !window.confirm("Leave with unsaved delivery changes?"));
  const [selectedEtaTemplate, setSelectedEtaTemplate] = useState("");
  const [selectedShortcode, setSelectedShortcode] = useState("");
  const holidays = data.setting.holidaysCsv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  const sampleProcessingDays = Math.max(0, Number(settings.processingDays) || 0);
  const sampleMinLeadDays = sampleProcessingDays + 3;
  const sampleMaxLeadDays = sampleMinLeadDays + Math.max(0, Number(settings.deliveryWindowDays) || 0);
  const selectedDateFormat = settings.dateFormat === "custom" ? `custom:${settings.customDateFormat}` : settings.dateFormat;
  const visibleSettingFields: string[] = activeTab.id === "timing"
    ? ["processingDays", "fallbackDays", "deliveryWindowDays", "timeZone", "locale", "cutoffHour24", "weekendDaysCsv"]
    : activeTab.id === "coverage"
      ? ["courierTimeoutMs", "retryCount", "courierEnabled", "dbFallbackEnabled"]
      : activeTab.id === "products"
        ? ["inventoryAwareEnabled"]
        : activeTab.id === "cart"
          ? ["disableAddToCart", "requireValidPin"]
          : activeTab.id === "messages"
            ? ["successMessage", "unavailableMessage", "codAvailableMessage", "codUnavailableMessage", "deliveryChargeMessage"]
            : [];
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
    .filter((product) => !normalizedProductSearch || `${product.title} · ${product.handle} ${product.id}`.toLowerCase().includes(normalizedProductSearch))
    .slice(0, 20)
    .map((product) => ({
      label: `${product.title} · ${product.handle}`,
      value: product.id.replace(/\D/g, ""),
    }));
  const selectedCountdownProductIds = countdownProductIds.split(",").filter(Boolean);
  const selectedCountdownCollections = countdownCollectionHandles.split(",").filter(Boolean);
  const selectedCountdownZones = countdownZoneIds.split(",").filter(Boolean);
  const countdownZoneOptions = data.zones.map((zone) => ({
    label: `${zone.name}${zone.country ? ` · ${zone.country}` : ""}`,
    value: String(zone.id),
  }));
  const countdownCollectionOptions = data.collections.map((collection) => ({
    label: `${collection.title} · ${collection.handle}`,
    value: collection.handle,
  }));
  const countdownProductOptions = data.products.map((product) => ({
    label: `${product.title} · ${product.handle}`,
    value: product.id.replace(/\D/g, ""),
  }));
  const targetRegionOptions = suggestedRegions(targetForm.countryCode, targetForm.stateRegion);
  const targetRegionValues = regionsForCountry(targetForm.countryCode);
  const shopHandle = data.shop.replace(/\.myshopify\.com$/i, "");
  const themeEditorUrl = `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=product&addAppBlockId=${data.apiKey}/delivery-checker&target=mainSection`;
  const previewDeliveryDate = sampleMaxDeliveryDate;
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
      return { ...current, weekendDaysCsv: [...set].sort().join(",") };
    });
  };
  const editPostalRule = (row: (typeof data.samplePostalCodes)[number]) => {
    if (JSON.stringify(postalCodeForm) !== JSON.stringify(postalBaseline.current) && !window.confirm("Discard unsaved postal rule changes?")) return;
    setEditingPostalRule({ id: row.id, postalCode: row.postalCode });
    const draft = {
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
    };
    postalBaseline.current = draft;
    setPostalCodeForm(draft);
    document.getElementById("postal-rule-form")?.scrollIntoView({ behavior: "smooth" });
  };
  const editTarget = (target: (typeof data.targets)[number]) => {
    if (JSON.stringify(targetForm) !== JSON.stringify(targetBaseline.current) && !window.confirm("Discard unsaved targeting changes?")) return;
    const product = target.targetKind === "product"
      ? data.products.find((item) => item.id.replace(/\D/g, "") === target.targetValue.replace(/\D/g, ""))
      : undefined;
    setEditingTargetId(target.id);
    setProductSearch(product ? `${product.title} · ${product.handle}` : target.targetKind === "product" ? target.targetValue : "");
    const draft = {
      name: target.name,
      kind: target.targetKind,
      value: target.targetKind === "product" ? (product?.id ?? target.targetValue).replace(/\D/g, "") : target.targetValue,
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
    };
    targetBaseline.current = draft;
    setTargetForm(draft);
    document.getElementById("targeting")?.scrollIntoView({ behavior: "smooth" });
  };
  const ruleGroups = [
    { id: "all", label: "All rules", count: data.totalPatterns },
    ...data.zones.map((zone) => ({
      id: String(zone.id),
      label: zone.name,
      count: zone._count.postalCodes,
    })),
    {
      id: "unassigned",
      label: "Unassigned",
      count: data.unassignedCount,
    },
  ].filter((group) => group.id === "all" || group.count > 0);
  const visibleRules = data.samplePostalCodes;
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
      <Button size="slim" onClick={() => setEditingZone(zone)} disabled={!data.access.features.zones || isSaving}>Edit</Button>
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
          if ((!zone.enabled && zone._count.postalCodes > 0) || !window.confirm(`Delete zone "${zone.name}"? Its ${zone._count.postalCodes} postal rules will be kept but detached from this zone. They will no longer inherit its enabled status or priority. Reassign or delete the rules first if you do not want them retained.`)) event.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="delete_zone" />
        <input type="hidden" name="zoneId" value={zone.id} />
        <Button submit size="slim" tone="critical" loading={isZoneActionSaving("delete_zone", zone.id)} disabled={!isAdvanced || (!zone.enabled && zone._count.postalCodes > 0)}>
          Delete
        </Button>
      </fetcher.Form>
      {!zone.enabled && zone._count.postalCodes > 0 ? <Text as="span" tone="subdued">Deletion blocked to prevent reactivating rules. Edit this zone to reassign or delete its rules first.</Text> : null}
    </InlineStack>,
  ]);
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const targetCards = data.targets.map((target) => {
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
    return (
      <article key={target.id} className="incode-target-card">
        <div className="incode-target-card__header">
          <div>
            <Text as="h3" variant="headingSm">{target.name}</Text>
            <Text as="p" tone="subdued">Priority {target.priority} · {target.targetKind}</Text>
          </div>
          {target.enabled ? <Badge tone="success">Enabled</Badge> : <Badge>Disabled</Badge>}
        </div>
        <div className="incode-target-card__grid">
          <div><span>Matches</span><strong title={`${target.targetKind}: ${target.targetValue}`}>{matchLabel}</strong></div>
          <div><span>Geography</span><strong>{geography}</strong></div>
          <div><span>Inventory</span><strong>{target.inventoryMode.replaceAll("_", " ")}</strong></div>
          <div><span>Schedule</span><strong>{schedule}</strong></div>
          <div><span>Behavior</span><strong>{behavior}</strong></div>
          <div><span>Message</span><strong>{target.customSuccessMessage || "Global message"}</strong></div>
        </div>
        <div className="incode-target-card__actions">
          <Button size="slim" onClick={() => editTarget(target)} disabled={!isAdvanced}>Edit</Button>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="toggle_target" />
            <input type="hidden" name="targetId" value={target.id} />
            <Button submit size="slim" loading={isIntentSaving("toggle_target")} disabled={!isAdvanced}>
              {target.enabled ? "Disable" : "Enable"}
            </Button>
          </fetcher.Form>
          <fetcher.Form method="post" onSubmit={(event) => { if (!window.confirm(`Delete targeting rule "${target.name}"?`)) event.preventDefault(); }}>
            <input type="hidden" name="intent" value="delete_target" />
            <input type="hidden" name="targetId" value={target.id} />
            <Button submit size="slim" tone="critical" loading={isIntentSaving("delete_target")} disabled={!isAdvanced}>Delete</Button>
          </fetcher.Form>
        </div>
      </article>
    );
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
      subtitle="Set coverage first, then refine delivery promises and the shopper experience."
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
      {editingZone ? <ZoneEditor key={editingZone.id} zone={editingZone} zones={data.zones} deliveryOptions={data.access.features.deliveryOptions} onClose={() => setEditingZone(null)} onDirtyChange={setZoneDirty} /> : null}
      <div className="incode-delivery-settings">
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">Make ZIP checks live on your store</Text>
                <Text as="p" tone="subdued">Complete these three steps to let shoppers enter a postal code and receive delivery availability.</Text>
              </BlockStack>
              <Badge tone={data.totalPatterns > 0 ? "success" : "attention"}>
                {data.totalPatterns > 0 ? "Coverage added" : "Coverage needed"}
              </Badge>
            </InlineStack>
            <div className="incode-launch-checklist">
              <div className={`incode-launch-checklist__step${data.totalPatterns > 0 ? " is-complete" : ""}`}>
                <span>1</span>
                <div>
                  <strong>Add ZIP coverage</strong>
                  <small>{data.totalPatterns > 0 ? `${data.totalPatterns} rule${data.totalPatterns === 1 ? "" : "s"} ready` : "Create a rule or import a CSV"}</small>
                </div>
                {data.totalPatterns > 0 ? <Badge tone="success">Ready</Badge> : <Button url={tabUrl("coverage")} size="slim">Add coverage</Button>}
              </div>
              <div className="incode-launch-checklist__step">
                <span>2</span>
                <div>
                  <strong>Add the storefront checker</strong>
                  <small>Shopify Admin → Online Store → Themes → Customize → Add app block</small>
                </div>
                <Button url={themeEditorUrl} external target="_blank" size="slim">Add ZIP checker block</Button>
              </div>
              <div className="incode-launch-checklist__step">
                <span>3</span>
                <div>
                  <strong>Test before publishing</strong>
                  <small>Try one available and one unavailable postal code on a product page</small>
                </div>
                <Button url="/app/additional" size="slim">View guide</Button>
              </div>
            </div>
          </BlockStack>
        </Card>
        <nav className="incode-delivery-settings__tabs" aria-label="Delivery settings sections">
          {SETTINGS_TABS.map((tab) => (
            <Link key={tab.id} to={tabUrl(tab.id)} preventScrollReset aria-current={activeTab.id === tab.id ? "page" : undefined}>
              {tab.label}
            </Link>
          ))}
        </nav>
        <div className="incode-delivery-settings__intro">
          <Text as="h2" variant="headingLg">{activeTab.label}</Text>
          <Text as="p" tone="subdued">{activeTab.description}</Text>
        </div>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {fetcher.data ? (
              <Banner title={fetcher.data.ok ? "Update complete" : "Could not complete update"} tone={fetcher.data.ok ? "success" : "critical"}>
                {fetcher.data.message}
              </Banner>
            ) : null}
            {!isAdvanced ? (
              <Banner title="Standard subscription required" tone="info" action={{ content: "View plan", url: "/app/plans" }}>
                Activate Standard to use delivery controls and storefront features.
              </Banner>
            ) : null}

            {activeTab.id === "coverage" ? <>
            <div id="zones" className="incode-section-anchor" />
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

            </> : null}
            {activeTab.id === "products" ? <>
            <div id="targeting" className="incode-section-anchor" />
            {data.targetCount === 0 ? (
              <Banner title="Start with one simple rule" tone="info">
                Choose what the rule matches, set an ETA override only if needed, then save. Leave the advanced conditions closed until you need them.
              </Banner>
            ) : null}
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
                              const product = data.products.find((item) => item.id.replace(/\D/g, "") === productId);
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
                    <details className="incode-targeting__advanced">
                      <summary>Advanced conditions and schedule</summary>
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
                        helpText="Shoppers must pass a serviceable delivery check before supported storefront purchase buttons unlock."
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
                    </details>
                    <InlineStack gap="200">
                      <Button submit variant="primary" loading={isIntentSaving(editingTargetId === null ? "create_target" : "update_target")} disabled={!isAdvanced}>
                        {editingTargetId === null ? "Create targeting rule" : "Save targeting rule"}
                      </Button>
                       {editingTargetId !== null ? <Button onClick={() => { if (JSON.stringify(targetForm) === JSON.stringify(targetBaseline.current) || window.confirm("Discard unsaved targeting changes?")) resetTargetForm(); }}>Cancel edit</Button> : null}
                    </InlineStack>
                  </FormLayout>
                </fetcher.Form>

                {targetCards.length > 0 ? (
                  <div className="incode-targeting__cards">{targetCards}</div>
                ) : (
                  <Text as="p" tone="subdued">
                    No targeting rules yet. Add product, collection, vendor, or tag rules
                    for custom ETAs, exclusions, or add-to-cart policy.
                  </Text>
                )}
                <InlineStack gap="200" blockAlign="center">
                  <Button disabled={data.targetPage <= 1} onClick={() => updateQuery({ targetPage: String(data.targetPage - 1) })}>Previous targets</Button>
                  <Text as="span">Page {data.targetPage} of {Math.max(1, Math.ceil(data.targetCount / data.pageSize))}</Text>
                  <Button disabled={data.targetPage * data.pageSize >= data.targetCount} onClick={() => updateQuery({ targetPage: String(data.targetPage + 1) })}>Next targets</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            </> : null}
            {activeTab.id !== "imports" ? <>
            <div id="behavior" className="incode-section-anchor" />
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" gap="300" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      {activeTab.id === "coverage" ? "Optional courier and coverage fallback" : activeTab.id === "products" ? "Inventory behavior" : activeTab.id === "cart" ? "Shop-wide cart controls" : activeTab.id === "messages" ? "Storefront wording" : "Timing defaults"}
                    </Text>
                    <Text as="p" tone="subdued">
                      Save applies all settings drafts, including changes made in other tabs. Coverage and product rules are saved separately.
                    </Text>
                  </BlockStack>
                  <Badge tone={settings.courierEnabled ? "success" : "attention"}>
                    {settings.courierEnabled ? "Courier enabled in draft" : settings.dbFallbackEnabled ? "Coverage fallback enabled in draft" : "Coverage fallback disabled in draft"}
                  </Badge>
                </InlineStack>

                <fetcher.Form method="post" onSubmit={() => { submittedSettings.current = { ...settings }; }}>
                  <input type="hidden" name="intent" value="save_settings" />
                  <input type="hidden" name="dateFormat" value={selectedDateFormat} />
                  {/* The action reads every setting, even when its editor is in another tab. */}
                  {Object.entries(settings).filter(([key, value]) => key !== "dateFormat" && key !== "customDateFormat" && (typeof value === "boolean" || !visibleSettingFields.includes(key) || (!isAdvanced && activeTab.id === "messages"))).map(([key, value]) => (
                    <input key={key} type="hidden" name={key} value={String(value)} />
                  ))}
                  <FormLayout>
                    {activeTab.id === "coverage" ? <>
                      <Text as="p" tone="subdued">Courier lookup is optional and requires server-configured Shiprocket credentials. Saved coverage rules can be used when courier lookup is disabled or fails. These controls do not enable server-side checkout validation.</Text>
                      <Checkbox label="Enable courier lookup" checked={settings.courierEnabled} disabled={!isAdvanced || !data.courierIntegrationAvailable} onChange={(value) => setSettings((current) => ({ ...current, courierEnabled: value }))} helpText={data.courierIntegrationAvailable ? "Credentials are configured; service availability is not verified here." : "Unavailable: server credentials have not been configured."} />
                      <Checkbox label="Use saved coverage rules as fallback" checked={settings.dbFallbackEnabled} onChange={(value) => setSettings((current) => ({ ...current, dbFallbackEnabled: value }))} helpText="Turn this on to use your postal coverage rules. Default transit days alone do not establish serviceability." />
                      <TextField label="Courier timeout (milliseconds)" name="courierTimeoutMs" type="number" min={500} max={15000} value={settings.courierTimeoutMs} onChange={(value) => setSettings((current) => ({ ...current, courierTimeoutMs: value }))} autoComplete="off" />
                      <TextField label="Courier retries" name="retryCount" type="number" min={0} max={3} value={settings.retryCount} onChange={(value) => setSettings((current) => ({ ...current, retryCount: value }))} autoComplete="off" />
                    </> : null}
                    {activeTab.id === "timing" ? <>
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

                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Custom week off days</Text>
                      <Text as="p" tone="subdued">Selected days and configured holidays are skipped when calculating business delivery days.</Text>
                      <InlineStack gap="200" wrap>
                        {weekdayOptions.map(([value, label]) => (
                          <button key={value} type="button" aria-pressed={selectedWeekends.has(value)} className={`incode-choice-chip${selectedWeekends.has(value) ? " is-selected" : ""}`} onClick={() => toggleWeekend(value)}>{label}</button>
                        ))}
                      </InlineStack>
                      {selectedWeekends.size === 7 ? <Banner tone="critical">At least one delivery day is required. Clear one weekend day before saving.</Banner> : null}
                      <Button url="#holidays">Manage holiday dates</Button>
                    </BlockStack>

                    </> : null}
                    {activeTab.id === "products" ?
                    <Checkbox
                      label="Enable inventory-aware delivery estimates"
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
                    : null}
                    {activeTab.id === "cart" ? <>
                    <Checkbox
                      label="Disable Add to Cart when delivery is unavailable"
                      checked={settings.disableAddToCart}
                      disabled={!isAdvanced}
                      helpText="The storefront widget disables common product form buttons after an unavailable lookup."
                      onChange={(checked) =>
                        setSettings((current) => ({ ...current, disableAddToCart: checked }))
                      }
                    />
                    <Checkbox
                      label="Require valid PIN before Add to Cart (shop-wide)"
                      checked={settings.requireValidPin}
                      disabled={!isAdvanced}
                      helpText="Add to Cart stays locked until a serviceable postal code check succeeds. Targeting rules can override this per product, collection, or tag."
                      onChange={(checked) =>
                        setSettings((current) => ({ ...current, requireValidPin: checked }))
                      }
                    />

                    <Button url={tabUrl("products")}>Review product-specific cart rules</Button>
                    </> : null}
                    {activeTab.id === "messages" ? <>
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
                        <Text as="h3" variant="headingSm">Sample message preview</Text>
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
                          Sample US 10001 uses 3 transit days and does not apply cutoff, timezone, weekends, or holidays. The storefront calculates dates from the shopper&apos;s actual delivery rule and business calendar.
                        </Text>
                      </BlockStack>
                    </Card>

                    </> : null}
                    <Button submit variant="primary" loading={isIntentSaving("save_settings")}>
                      Save settings
                    </Button>
                  </FormLayout>
                </fetcher.Form>
              </BlockStack>
            </Card>

            </> : null}
            {activeTab.id === "imports" ? <>
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

            </> : null}
            {activeTab.id === "coverage" ? <>
            <div id="coverage" className="incode-section-anchor" />
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
                         if (JSON.stringify(postalCodeForm) !== JSON.stringify(postalBaseline.current) && !window.confirm("Discard unsaved postal rule changes?")) return;
                         setEditingPostalRule(null);
                         setPostalCodeForm((current) => {
                           const cleared = {
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
                           };
                           postalBaseline.current = cleared;
                           return cleared;
                         });
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
                  <div className="incode-postal-rule-form">
                  <FormLayout>
                    <div className="incode-postal-rule-form__section-heading">
                      <Text as="h3" variant="headingSm">Coverage basics</Text>
                      <Text as="p" tone="subdued">Define where you deliver and the standard delivery promise.</Text>
                    </div>
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

                    <Checkbox label="Serviceable" checked={postalCodeForm.serviceable} onChange={(checked) => setPostalCodeForm((current) => ({ ...current, serviceable: checked }))} />
                    <input type="hidden" name="serviceable" value={String(postalCodeForm.serviceable)} />

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

                    <details className="incode-postal-rule-form__details">
                      <summary>Optional delivery details</summary>
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

                    <div className="incode-postal-rule-form__section-heading">
                      <Text as="h3" variant="headingSm">Delivery options</Text>
                      <Text as="p" tone="subdued">Choose the services shoppers can see for this coverage rule.</Text>
                    </div>
                    <InlineStack gap="400" wrap>
                      <Checkbox label="COD" checked={postalCodeForm.codAvailable} onChange={(checked) => setPostalCodeForm((current) => ({ ...current, codAvailable: checked }))} />
                      <Checkbox label="Same-day" checked={postalCodeForm.sameDayAvailable} onChange={(checked) => setPostalCodeForm((current) => ({ ...current, sameDayAvailable: checked }))} />
                      <Checkbox label="Next-day" checked={postalCodeForm.nextDayAvailable} onChange={(checked) => setPostalCodeForm((current) => ({ ...current, nextDayAvailable: checked }))} />
                      <Checkbox label="Express" checked={postalCodeForm.expressAvailable} onChange={(checked) => setPostalCodeForm((current) => ({ ...current, expressAvailable: checked }))} />
                    </InlineStack>
                    <input type="hidden" name="codAvailable" value={String(postalCodeForm.codAvailable)} />
                    <input type="hidden" name="sameDayAvailable" value={String(postalCodeForm.sameDayAvailable)} />
                    <input type="hidden" name="nextDayAvailable" value={String(postalCodeForm.nextDayAvailable)} />
                    <input type="hidden" name="expressAvailable" value={String(postalCodeForm.expressAvailable)} />
                    </details>

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
                  </div>
                </fetcher.Form>
              </BlockStack>
            </Card>

            </> : null}
            {activeTab.id === "imports" ?
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
            : null}

            {activeTab.id === "coverage" ?
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Coverage rules</Text>
                    <Text as="p" tone="subdued">Browse postal rules by delivery zone. Edit or remove any rule directly.</Text>
                  </BlockStack>
                  <Badge tone="info">{`${visibleRules.length} shown`}</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">
                  Showing {visibleRules.length} of {data.coverageCount} matching rules ({data.totalPatterns} total)
                  ({data.patternCount} range/wildcard).
                </Text>
                <InlineStack gap="200" blockAlign="end">
                  <TextField label="Search all coverage rules" value={coverageSearchInput} onChange={setCoverageSearchInput} autoComplete="off" helpText="Search postal pattern, country, city, state, or zone across all records." />
                  <Button onClick={() => updateQuery({ coverageSearch: coverageSearchInput, coveragePage: "1" })}>Search</Button>
                </InlineStack>
                <div className="incode-rule-tabs" role="tablist" aria-label="Filter rules by zone">
                  {ruleGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      role="tab"
                      aria-selected={activeRuleGroup === group.id}
                      className={`incode-rule-tab${activeRuleGroup === group.id ? " is-active" : ""}`}
                      onClick={() => updateQuery({ coverageGroup: group.id, coveragePage: "1" })}
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
                    <Text as="h3" variant="headingMd">No matching coverage rules</Text>
                    <Text as="p" tone="subdued">Change the search or zone filter, or add coverage above.</Text>
                  </BlockStack>
                )}
                <InlineStack gap="200" blockAlign="center">
                  <Button disabled={data.coveragePage <= 1} onClick={() => updateQuery({ coveragePage: String(data.coveragePage - 1) })}>Previous rules</Button>
                  <Text as="span">Page {data.coveragePage} of {Math.max(1, Math.ceil(data.coverageCount / data.pageSize))}</Text>
                  <Button disabled={data.coveragePage * data.pageSize >= data.coverageCount} onClick={() => updateQuery({ coveragePage: String(data.coveragePage + 1) })}>Next rules</Button>
                </InlineStack>
              </BlockStack>
            </Card>
            : null}
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {activeTab.id === "products" ? (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Live rule preview</Text>
                    <Badge tone="info">Unsaved draft</Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued">This is how the current rule will be interpreted before you save it.</Text>
                  <div className="incode-rule-preview" aria-live="polite">
                    <div className="incode-rule-preview__title">{targetForm.name || "Unnamed rule"}</div>
                    <div className="incode-rule-preview__match">
                      <span>When</span>
                      <strong>{targetForm.kind === "product" ? "Product" : targetForm.kind === "collection" ? "Collection" : targetForm.kind === "vendor" ? "Vendor" : "Product tag"}</strong>
                      <em>{targetForm.kind === "product" ? productSearch || "Not selected yet" : targetForm.value || "Not selected yet"}</em>
                    </div>
                    <div className="incode-rule-preview__facts">
                      <span>{targetForm.excluded ? "Delivery excluded" : `${targetForm.processingDays || "Default"} prep days`}</span>
                      <span>{targetForm.transitDays || "Postal transit"}</span>
                      <span>{targetForm.requireValidPin ? "PIN required" : "PIN optional"}</span>
                    </div>
                  </div>
                  <Text as="p" tone="subdued" variant="bodySm">Product rules override the matching postal rule only when this target matches.</Text>
                </BlockStack>
              </Card>
            ) : null}
            {activeTab.id === "timing" || activeTab.id === "messages" ?
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Live delivery preview</Text>
                  <Badge tone="success">Updates as you edit</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">
                  Illustrative dates use US 10001 and 3 transit days. This is not a live delivery check.
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
                      <small>{sampleMinDeliveryDate} - {sampleMaxDeliveryDate}</small>
                    </div>
                  </div>
                </div>
                <Button url={themeEditorUrl} external fullWidth>
                  Customize in Theme Editor
                </Button>
              </BlockStack>
            </Card>
            : null}
            {activeTab.id === "timing" ? <>
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
                <Text as="h2" variant="headingMd">Cutoff countdown display</Text>
                <Text as="p" tone="subdued">Choose who sees the countdown here. Shopify still requires the app block to be added and published on each storefront surface you select.</Text>
                <countdownFetcher.Form method="post">
                  <input type="hidden" name="intent" value="save_countdown" />
                  <input type="hidden" name="countdownEnabled" value={String(countdownEnabled)} />
                  <input type="hidden" name="countdownDisplaySurfacesCsv" value={countdownSurfaces.join(",")} />
                  <BlockStack gap="300">
                    <Checkbox
                      label="Enable cutoff countdown"
                      checked={countdownEnabled}
                      onChange={setCountdownEnabled}
                    />
                    <Select
                      label="Show countdown to"
                      name="countdownTargetMode"
                      options={[
                        { label: "All products", value: "all" },
                        { label: "Selected products", value: "products" },
                        { label: "Products in selected collections", value: "collections" },
                        { label: "Selected delivery zones", value: "zones" },
                      ]}
                      value={countdownTargetMode}
                      onChange={setCountdownTargetMode}
                    />
                    {countdownTargetMode === "products" ? (
                      <Autocomplete
                        allowMultiple
                        options={countdownProductOptions}
                        selected={selectedCountdownProductIds}
                        onSelect={(selected) => setCountdownProductIds(selected.join(","))}
                        emptyState={data.products.length > 0 ? "No matching products." : "No products found in this store."}
                        textField={
                          <Autocomplete.TextField
                            label="Choose products"
                            placeholder="Search products by name"
                            autoComplete="off"
                            helpText="Select one or more products that should show this countdown."
                          />
                        }
                      />
                    ) : null}
                    {countdownTargetMode === "collections" ? (
                      <Autocomplete
                        allowMultiple
                        options={countdownCollectionOptions}
                        selected={selectedCountdownCollections}
                        onSelect={(selected) => setCountdownCollectionHandles(selected.join(","))}
                        emptyState={data.collections.length > 0 ? "No matching collections." : "No collections found in this store."}
                        textField={
                          <Autocomplete.TextField
                            label="Choose collections"
                            placeholder="Search collections by name"
                            autoComplete="off"
                            helpText="Products inside these collections will show this countdown."
                          />
                        }
                      />
                    ) : null}
                    {countdownTargetMode === "zones" ? (
                      <Autocomplete
                        allowMultiple
                        options={countdownZoneOptions}
                        selected={selectedCountdownZones}
                        onSelect={(selected) => setCountdownZoneIds(selected.join(","))}
                        emptyState={data.zones.length > 0 ? "No matching zones." : "Create a delivery zone first."}
                        textField={
                          <Autocomplete.TextField
                            label="Choose delivery zones"
                            placeholder="Search zones by name"
                            autoComplete="off"
                            helpText="The countdown appears after a shopper matches one of these delivery zones."
                          />
                        }
                      />
                    ) : null}
                    <input type="hidden" name="countdownProductIdsCsv" value={countdownProductIds} readOnly />
                    <input type="hidden" name="countdownCollectionHandlesCsv" value={countdownCollectionHandles} readOnly />
                    <input type="hidden" name="countdownZoneIdsCsv" value={countdownZoneIds} readOnly />
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Storefront surfaces</Text>
                      <InlineStack gap="300" wrap>
                        {[
                          ["product", "Product page"],
                          ["collection", "Collection page"],
                          ["cart", "Cart page"],
                          ["index", "Home page"],
                          ["search", "Search page"],
                        ].map(([value, label]) => (
                          <Checkbox
                            key={value}
                            label={label}
                            checked={countdownSurfaces.includes(value)}
                            onChange={(checked) => setCountdownSurfaces((current) => checked ? [...new Set([...current, value])] : current.filter((item) => item !== value))}
                          />
                        ))}
                      </InlineStack>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button submit variant="primary" loading={countdownFetcher.state !== "idle"}>Save countdown settings</Button>
                      <Button url={themeEditorUrl} external target="_blank">Open Theme Editor setup</Button>
                    </InlineStack>
                    {countdownFetcher.data ? <Banner tone={countdownFetcher.data.ok ? "success" : "critical"}>{countdownFetcher.data.message}</Banner> : null}
                  </BlockStack>
                </countdownFetcher.Form>
                <div className="incode-countdown-preview" aria-label="Static countdown sample">
                  <span><strong>01</strong><small>Hours</small></span>
                  <span><strong>35</strong><small>Minutes</small></span>
                  <span><strong>40</strong><small>Seconds</small></span>
                </div>
                <Text as="p" tone="subdued" variant="bodySm">Setup: save these settings, open the Theme Editor, add the Delivery Checker block to the selected templates, then publish the theme.</Text>
              </BlockStack>
            </Card>
            </> : null}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Next steps
                </Text>
                <Text as="p" tone="subdued">
                  {activeTab.id === "coverage" ? "Create zones if needed, then add a rule below. For larger lists, use Imports & Sync." : "Save your settings drafts, then test a real postal code on your storefront. Sample previews do not confirm serviceability."}
                </Text>
                <Button url={tabUrl(activeTab.id === "coverage" ? "imports" : "coverage")}>{activeTab.id === "coverage" ? "Import coverage in bulk" : "Review coverage"}</Button>
                <Button url="/app/storefront-customization">Customize storefront appearance</Button>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
      </BlockStack>
      </div>
    </Page>
  );
}
