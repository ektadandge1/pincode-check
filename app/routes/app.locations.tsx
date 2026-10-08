import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useBeforeUnload, useBlocker, useFetcher, useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  InlineStack,
  Page,
  Select,
  Tag,
  Text,
  TextField,
} from "@shopify/polaris";
import prisma from "../db.server";
import { resolvePlanAccess } from "../services/plan-access.server";
import { NO_PLAN_ACCESS } from "../services/plans.server";
import { requireActiveBilling } from "../services/billing.server";
import { clearDeliveryCheckCaches } from "../services/delivery-checker.server";
import { matchesPostalPatternsCsv, normalizeCountryCode, normalizePostalCode, validatePostalCode, validatePostalPattern } from "../utils/delivery.server";
import { COUNTRY_CODES, COUNTRY_OPTIONS } from "../utils/countries";

type ShopifyLocation = {
  id: string;
  name: string;
  isActive: boolean;
  fulfillsOnlineOrders: boolean;
  address: {
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    provinceCode?: string | null;
    zip?: string | null;
    country?: string | null;
    countryCode?: string | null;
    phone?: string | null;
  } | null;
};

type ActionData = { ok: boolean; message: string; previewKey?: string; postalCode?: string; localDelivery?: boolean };

type PickupOrder = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  pickupLocationId: string;
  pickupLocationName: string;
  pickupLocationAddress: string;
  pickupDate: string;
};

type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  email?: string | null;
  phone?: string | null;
  customer?: { displayName?: string | null } | null;
  shippingAddress?: {
    name?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
    country?: string | null;
    phone?: string | null;
  } | null;
  customAttributes?: Array<{ key: string; value?: string | null }>;
};

const ICON_OPTIONS = [
  { label: "Standard checkmarks", value: "number" },
  { label: "Premium delivery icons", value: "delivery" },
  { label: "Advanced duotone icons", value: "duotone" },
  { label: "Circular badges", value: "circle" },
  { label: "Simple minimal dots", value: "minimal" },
  { label: "Friendly emoji icons", value: "emoji" },
];

const EFFECT_OPTIONS = [
  { label: "Soft reveal", value: "soft" },
  { label: "Route pulse", value: "route" },
  { label: "Icon heartbeat", value: "pulse" },
  { label: "Floating icons", value: "float" },
  { label: "Elegant shimmer", value: "shimmer" },
  { label: "No effect", value: "none" },
];

type LocationRow = ShopifyLocation & {
  rule: Awaited<ReturnType<typeof prisma.fulfillmentLocationRule.findMany>>[number] | null;
};

type LocationForm = {
  enabled: boolean;
  priority: string;
  processingDays: string;
  transitDays: string;
  localDeliveryEnabled: boolean;
  localDeliveryCountry: string;
  localDeliveryPostalCodesCsv: string;
  localDeliveryCoverageMode: string;
  localDeliveryZoneIdsCsv: string;
  pickupEnabled: boolean;
  pickupInstructions: string;
  pickupPhone: string;
  pickupPreparationDays: string;
  pickupWeekdaysCsv: string;
  pickupBlockedDatesCsv: string;
  pickupAdvanceDays: string;
  serviceTargetMode: string;
  serviceTargetValuesCsv: string;
};

function locationForm(location: LocationRow): LocationForm {
  return {
    enabled: location.rule?.enabled ?? location.isActive,
    priority: String(location.rule?.priority ?? 100),
    processingDays: location.rule?.processingDays === null || location.rule?.processingDays === undefined ? "" : String(location.rule.processingDays),
    transitDays: location.rule?.transitDays === null || location.rule?.transitDays === undefined ? "" : String(location.rule.transitDays),
    localDeliveryEnabled: location.rule?.localDeliveryEnabled ?? false,
    localDeliveryCountry: location.rule?.localDeliveryCountry || location.address?.countryCode || "",
    localDeliveryPostalCodesCsv: location.rule?.localDeliveryPostalCodesCsv ?? "",
    localDeliveryCoverageMode: location.rule?.localDeliveryCoverageMode === "zone" ? "zone" : "postal",
    localDeliveryZoneIdsCsv: location.rule?.localDeliveryZoneIdsCsv ?? "",
    pickupEnabled: location.rule?.pickupEnabled ?? false,
    pickupInstructions: location.rule?.pickupInstructions ?? "",
    pickupPhone: location.rule?.pickupPhone ?? "",
    pickupPreparationDays: String(location.rule?.pickupPreparationDays ?? 0),
    pickupWeekdaysCsv: location.rule?.pickupWeekdaysCsv ?? "0,1,2,3,4,5,6",
    pickupBlockedDatesCsv: location.rule?.pickupBlockedDatesCsv ?? "",
    pickupAdvanceDays: String(location.rule?.pickupAdvanceDays ?? 30),
    serviceTargetMode: location.rule?.serviceTargetMode ?? "all",
    serviceTargetValuesCsv: location.rule?.serviceTargetValuesCsv ?? "",
  };
}

type TargetSuggestions = Record<"product" | "collection" | "tag" | "zone", Array<{ label: string; value: string }>>;

const SERVICE_TARGET_OPTIONS = [
  { label: "All products and customers", value: "all" },
  { label: "Only selected products", value: "product" },
  { label: "Only products in selected collections", value: "collection" },
  { label: "Only products with selected tags", value: "tag" },
  { label: "Only selected delivery zones", value: "zone" },
];

const PICKUP_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ServiceTargetPicker({ options, label, value, disabled, onChange, name = "serviceTargetValuesCsv" }: {
  options: Array<{ label: string; value: string }>;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  name?: string;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [showAllSelected, setShowAllSelected] = useState(false);
  const selected = value.split(",").map((item) => item.trim()).filter(Boolean);
  const matching = options.filter((option) => (!selectedOnly || selected.includes(option.value)) && option.label.toLowerCase().includes(search.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(matching.length / 6));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = matching.slice(currentPage * 6, currentPage * 6 + 6);
  const selectedLabels = new Map(options.map((option) => [option.value, option.label]));
  const remove = (item: string) => onChange(selected.filter((entry) => entry !== item).join(","));

  return (
    <section className="incode-service-picker" aria-label={`Choose ${label.toLowerCase()}`}>
      <input type="hidden" name={name} value={value} />
      <div className="incode-service-picker__header">
        <div>
          <Text as="h4" variant="headingSm">Choose {label.toLowerCase()}</Text>
          <Text as="p" tone="subdued" variant="bodySm">Search by name, then select your choices.</Text>
        </div>
        <Badge tone={selected.length ? "success" : "info"}>{`${selected.length} selected`}</Badge>
      </div>
      <TextField
        label={`Search ${label.toLowerCase()}`}
        labelHidden
        value={search}
        onChange={(text) => { setSearch(text); setPage(0); }}
        placeholder={`Search ${options.length} ${label.toLowerCase()} by name`}
        autoComplete="off"
        disabled={disabled}
        clearButton
        onClearButtonClick={() => { setSearch(""); setPage(0); }}
        prefix={<svg className="incode-service-picker__search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>}
      />
      <div className="incode-service-picker__toolbar">
        <div className="incode-service-picker__tabs" role="group" aria-label="Filter choices">
          <button type="button" aria-pressed={!selectedOnly} onClick={() => { setSelectedOnly(false); setPage(0); }}>Browse all</button>
          <button type="button" aria-pressed={selectedOnly} onClick={() => { setSelectedOnly(true); setPage(0); }}>Selected ({selected.length})</button>
        </div>
        <Button variant="plain" disabled={disabled || !selected.length} onClick={() => onChange("")}>Clear selection</Button>
      </div>
      <div className="incode-service-picker__choices">
        {visible.map((option) => (
          <div key={option.value} className={`incode-service-picker__choice${selected.includes(option.value) ? " is-selected" : ""}`}>
            <Checkbox
              label={option.label}
              checked={selected.includes(option.value)}
              disabled={disabled}
              onChange={(checked) => onChange((checked ? [...new Set([...selected, option.value])] : selected.filter((item) => item !== option.value)).join(","))}
            />
          </div>
        ))}
        {!visible.length ? <div className="incode-service-picker__empty"><Text as="p" tone="subdued">{selectedOnly && !selected.length ? "No selections yet. Choose Browse all to get started." : options.length ? "No matches. Try a different search." : "No choices found. Add them to your store, then refresh."}</Text></div> : null}
      </div>
      <div className="incode-service-picker__footer">
        <Text as="span" tone="subdued" variant="bodySm">{matching.length ? `${currentPage * 6 + 1}-${Math.min((currentPage + 1) * 6, matching.length)} of ${matching.length} choices` : "0 choices"}</Text>
        <InlineStack gap="200" blockAlign="center">
          <Button accessibilityLabel="Previous choices" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} size="slim">Previous</Button>
          <Text as="span" variant="bodySm">{`${currentPage + 1} / ${pageCount}`}</Text>
          <Button accessibilityLabel="Next choices" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} size="slim">Next</Button>
        </InlineStack>
      </div>
      {selected.length ? <div className="incode-service-picker__selected">
        <Text as="p" variant="bodySm" fontWeight="semibold">Your selection</Text>
        <InlineStack gap="200" wrap>
          {(showAllSelected ? selected : selected.slice(0, 4)).map((item) => <Tag key={item} onRemove={disabled ? undefined : () => remove(item)}>{selectedLabels.get(item) ?? item}</Tag>)}
          {selected.length > 4 ? <Button variant="plain" onClick={() => setShowAllSelected(!showAllSelected)}>{showAllSelected ? "Show less" : `+${selected.length - 4} more`}</Button> : null}
        </InlineStack>
      </div> : null}
    </section>
  );
}

function BlockedDatesPicker({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState("");
  const dates = [...new Set(value.split(/[\n,]/).map((date) => date.trim()).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
  const add = () => {
    if (!draft || dates.includes(draft) || dates.length >= 365) return;
    onChange([...dates, draft].sort().join(","));
    setDraft("");
  };
  return (
    <BlockStack gap="200">
      <TextField
        label="Block a pickup date"
        type="date"
        value={draft}
        disabled={disabled || dates.length >= 365}
        onChange={setDraft}
        autoComplete="off"
        connectedRight={<Button onClick={add} disabled={disabled || !draft || dates.includes(draft) || dates.length >= 365}>Add date</Button>}
        helpText="Choose dates when pickup is unavailable."
      />
      <input type="hidden" name="pickupBlockedDatesCsv" value={dates.join(",")} />
      {dates.length ? (
        <InlineStack gap="200" wrap>
          {dates.map((date) => <Tag key={date} onRemove={disabled ? undefined : () => onChange(dates.filter((item) => item !== date).join(","))}>{date}</Tag>)}
        </InlineStack>
      ) : <Text as="p" tone="subdued" variant="bodySm">No blocked dates added.</Text>}
    </BlockStack>
  );
}

function LocationSettingsSection({ title, description, status, children }: { title: string; description: string; status: string; children: React.ReactNode }) {
  return (
    <details className="incode-location-section">
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <span className="incode-location-section__status">{status}</span>
      </summary>
      <div className="incode-location-section__content">{children}</div>
    </details>
  );
}

function parseBool(value: FormDataEntryValue | null): boolean {
  return ["1", "true", "on"].includes(String(value ?? "").toLowerCase());
}

function optionalDays(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  return raw ? Number(raw) : null;
}

function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const view = new URL(request.url).searchParams.get("view") === "pickups" ? "pickups" : "setup";
  const [rules, setting, zones] = await Promise.all([
    prisma.fulfillmentLocationRule.findMany({
      where: { shop: session.shop },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    }),
    prisma.deliverySetting.findUnique({ where: { shop: session.shop } }),
    prisma.zone.findMany({ where: { shop: session.shop, enabled: true }, orderBy: [{ priority: "asc" }, { name: "asc" }] }),
  ]);
  const ruleByLocation = new Map(rules.map((rule) => [rule.shopifyLocationId, rule]));
  let locations: LocationRow[] = [];
  let locationError = "";
  let targetSuggestions: TargetSuggestions = {
    product: [],
    collection: [],
    tag: [],
    zone: zones.map((zone) => ({ label: `${zone.name} (Zone ${zone.id})`, value: String(zone.id) })),
  };
  try {
    const response = await admin.graphql(`#graphql
      query DeliveryLocations {
      locations(first: 100, includeInactive: true) {
          nodes {
            id
            name
            isActive
            fulfillsOnlineOrders
            address {
              address1
              address2
              city
              province
              provinceCode
              zip
              country
              countryCode
              phone
            }
           }
         }
          ${view === "setup" ? `
            products(first: 250) { nodes { id title tags } pageInfo { hasNextPage endCursor } }
            collections(first: 250) { nodes { handle title } pageInfo { hasNextPage endCursor } }
          ` : ""}
      }
    `);
    const payload = (await response.json()) as {
      data?: {
        locations?: { nodes?: ShopifyLocation[] };
        products?: { nodes?: Array<{ id: string; title: string; tags: string[] }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
        collections?: { nodes?: Array<{ handle: string; title: string }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
      };
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok || payload.errors?.length) {
      throw new Error(payload.errors?.[0]?.message ?? "Unable to load Shopify locations.");
    }
    locations = (payload.data?.locations?.nodes ?? []).map((location) => ({
      ...location,
      rule: ruleByLocation.get(location.id) ?? null,
    }));
    const products = payload.data?.products?.nodes ?? [];
    const collections = payload.data?.collections?.nodes ?? [];
    for (const kind of ["products", "collections"] as const) {
      let pageInfo = payload.data?.[kind]?.pageInfo;
      while (pageInfo?.hasNextPage) {
        if (!pageInfo.endCursor) throw new Error("Shopify catalog pagination could not be completed.");
        const nextResponse = await admin.graphql(`query LocationServiceCatalog($after: String!) {
          ${kind}(first: 250, after: $after) {
            nodes { ${kind === "products" ? "id title tags" : "handle title"} }
            pageInfo { hasNextPage endCursor }
          }
        }`, { variables: { after: pageInfo.endCursor } });
        const next = await nextResponse.json() as typeof payload;
        if (!nextResponse.ok || next.errors?.length) throw new Error(next.errors?.[0]?.message ?? "Unable to load service targeting choices.");
        if (kind === "products") products.push(...(next.data?.products?.nodes ?? []));
        else collections.push(...(next.data?.collections?.nodes ?? []));
        const nextPageInfo = next.data?.[kind]?.pageInfo;
        if (!nextPageInfo || (nextPageInfo.hasNextPage && nextPageInfo.endCursor === pageInfo.endCursor)) {
          throw new Error("Shopify catalog pagination could not be completed.");
        }
        pageInfo = nextPageInfo;
      }
    }
    targetSuggestions = {
      product: products.map((product) => ({ label: product.title, value: product.id.replace(/\D/g, "") })),
      collection: collections.map((collection) => ({ label: collection.title, value: collection.handle })),
      tag: [...new Set(products.flatMap((product) => product.tags))].sort().map((tag) => ({ label: tag, value: tag })),
      zone: zones.map((zone) => ({ label: `${zone.name} (Zone ${zone.id})`, value: String(zone.id) })),
    };
  } catch (error) {
    locationError = error instanceof Error ? error.message : "Unable to load Shopify locations.";
    locations = rules.map((rule) => ({
      id: rule.shopifyLocationId,
      name: rule.name,
      isActive: false,
      fulfillsOnlineOrders: false,
      address: null,
      rule,
    }));
  }
  let access = NO_PLAN_ACCESS;
  try {
    access = await resolvePlanAccess({ shop: session.shop, admin });
  } catch {
    locationError = locationError || "Unable to verify the current plan. Please refresh and try again.";
  }
  const orderAccessGranted = new Set((session.scope ?? "").split(",").map((scope) => scope.trim())).has("read_orders");
  const pickupOrders: PickupOrder[] = [];
  let pickupOrdersError = "";
  if (view === "pickups") {
    if (!orderAccessGranted) {
      pickupOrdersError = "Shopify order access has not been granted yet. Reauthorize the app after adding read_orders to view pickup customer details.";
    } else {
      try {
        const response = await admin.graphql(`#graphql
          query RecentPickupOrders {
            orders(first: 100, reverse: true, sortKey: CREATED_AT) {
              nodes {
                id
                name
                createdAt
                displayFinancialStatus
                displayFulfillmentStatus
                email
                phone
                customer { displayName }
                shippingAddress { name address1 address2 city province zip country phone }
                customAttributes { key value }
              }
            }
          }
        `);
        const payload = await response.json() as {
          data?: { orders?: { nodes?: ShopifyOrder[] } };
          errors?: Array<{ message?: string }>;
        };
        if (!response.ok || !payload.data?.orders) {
          throw new Error(payload.errors?.[0]?.message ?? "Shopify could not load recent orders.");
        }
        const locationById = new Map(locations.map((location) => [location.id, location]));
        for (const order of payload.data.orders.nodes ?? []) {
          const attributes = new Map((order.customAttributes ?? []).map((attribute) => [attribute.key, attribute.value ?? ""]));
          const pickupLocationId = attributes.get("_incode_pickup_location_id") ?? "";
          const pickupLocationName = attributes.get("_incode_pickup_location_name") ?? "";
          const pickupDate = attributes.get("_incode_pickup_date") ?? "";
          if (!pickupLocationId && !pickupLocationName && !pickupDate) continue;
          const customerName = [attributes.get("_incode_pickup_first_name"), attributes.get("_incode_pickup_last_name")].filter(Boolean).join(" ")
            || order.customer?.displayName || order.shippingAddress?.name || "Customer details unavailable";
          const pickupLocation = locationById.get(pickupLocationId);
          pickupOrders.push({
            id: order.id,
            name: order.name,
            createdAt: order.createdAt,
            displayFinancialStatus: order.displayFinancialStatus,
            displayFulfillmentStatus: order.displayFulfillmentStatus,
            customerName,
            email: attributes.get("_incode_pickup_email") || order.email || "",
            phone: attributes.get("_incode_pickup_phone") || order.phone || order.shippingAddress?.phone || "",
            address: [order.shippingAddress?.address1, order.shippingAddress?.address2, order.shippingAddress?.city, order.shippingAddress?.province, order.shippingAddress?.zip, order.shippingAddress?.country].filter(Boolean).join(", "),
            pickupLocationId,
            pickupLocationName: pickupLocationName || pickupLocation?.name || "Pickup location unavailable",
            pickupLocationAddress: pickupLocation ? [pickupLocation.address?.address1, pickupLocation.address?.address2, pickupLocation.address?.city, pickupLocation.address?.province, pickupLocation.address?.zip, pickupLocation.address?.country].filter(Boolean).join(", ") : "",
            pickupDate,
          });
        }
        if (payload.errors?.length) {
          pickupOrdersError = "Some protected customer fields are unavailable. Request protected customer data access in Shopify Partners to show complete addresses.";
        }
      } catch (error) {
        pickupOrdersError = error instanceof Error ? error.message : "Shopify could not load pickup orders.";
      }
    }
  }
  return {
    view,
    access,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    inventoryAwareEnabled: setting?.inventoryAwareEnabled ?? false,
    priorityMode: setting?.locationPriorityMode === "highest_stock" ? "highest_stock" : "manual",
    iconStyle: ICON_OPTIONS.some((option) => option.value === setting?.storefrontIconStyle)
      ? setting?.storefrontIconStyle ?? "number"
      : "number",
    serviceIconColor: setting?.storefrontAccentColor ?? "#2b2640",
    serviceBackground: setting?.storefrontJourneyBackground ?? "#e6edff",
    serviceEffect: EFFECT_OPTIONS.some((option) => option.value === setting?.storefrontAnimation)
      ? setting?.storefrontAnimation ?? "soft"
      : "soft",
    locations,
    targetSuggestions,
    locationError,
    orderAccessGranted,
    pickupOrders,
    pickupOrdersError,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const access = await resolvePlanAccess({ shop: session.shop, admin });
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  if (intent === "simulate_postal") {
    const previewKey = String(formData.get("previewKey") ?? "");
    const countryRaw = String(formData.get("country") ?? "").trim().toUpperCase();
    if (!COUNTRY_CODES.has(countryRaw)) return { ok: false, message: "Choose a valid country.", previewKey } satisfies ActionData;
    const country = normalizeCountryCode(countryRaw);
    const postalCode = normalizePostalCode(country, String(formData.get("postalCode") ?? ""));
    if (!/^[A-Z]{2}$/.test(countryRaw) || !validatePostalCode(country, postalCode)) {
      return { ok: false, message: "Enter a valid postal code for the selected country.", previewKey } satisfies ActionData;
    }
    return { ok: true, message: "Postal pattern simulation only; inventory and delivery coverage are not verified.", previewKey, postalCode,
      localDelivery: matchesPostalPatternsCsv(country, postalCode, String(formData.get("patterns") ?? "").replace(/\r?\n/g, ",")) } satisfies ActionData;
  }
  if (intent !== "save_location" && intent !== "save_priority_mode" && intent !== "save_icon_style" && intent !== "enable_pickup") {
    return { ok: false, message: "Unsupported action." } satisfies ActionData;
  }
  if (!access.features.inventory) {
    return { ok: false, message: "Fulfillment location rules require an active Standard subscription." } satisfies ActionData;
  }
  if (intent === "enable_pickup") {
    const shopifyLocationId = String(formData.get("shopifyLocationId") ?? "").trim();
    if (!/^gid:\/\/shopify\/Location\/\d+$/.test(shopifyLocationId)) return { ok: false, message: "Invalid Shopify location." } satisfies ActionData;
    try {
      const response = await admin.graphql(`#graphql
        query EnablePickupLocation($id: ID!) {
          location(id: $id) { id name isActive fulfillsOnlineOrders }
        }
      `, { variables: { id: shopifyLocationId } });
      const payload = await response.json() as { data?: { location?: Pick<ShopifyLocation, "id" | "name" | "isActive" | "fulfillsOnlineOrders"> | null }; errors?: unknown[] };
      const location = payload.data?.location;
      if (!response.ok || payload.errors?.length || !location || location.id !== shopifyLocationId) throw new Error("Location unavailable");
      if (!location.isActive || !location.fulfillsOnlineOrders) {
        return { ok: false, message: "Activate this location and enable online fulfillment in Shopify first." } satisfies ActionData;
      }
      const existing = await prisma.fulfillmentLocationRule.findUnique({ where: { shop_shopifyLocationId: { shop: session.shop, shopifyLocationId } } });
      const deliveryConfigured = existing?.localDeliveryCoverageMode === "zone"
        ? Boolean(existing.localDeliveryZoneIdsCsv.trim())
        : Boolean(existing?.localDeliveryCountry.trim() && existing.localDeliveryPostalCodesCsv.trim());
      await prisma.fulfillmentLocationRule.upsert({
        where: { shop_shopifyLocationId: { shop: session.shop, shopifyLocationId } },
        create: { shop: session.shop, shopifyLocationId, name: location.name, enabled: true, pickupEnabled: true },
        update: { name: location.name, enabled: true, pickupEnabled: true, ...(deliveryConfigured ? { localDeliveryEnabled: true } : {}) },
      });
      clearDeliveryCheckCaches(session.shop);
      return { ok: true, message: `${location.name} is enabled for pickup${deliveryConfigured ? " and local delivery" : ""}. Assign inventory to this location for every eligible product.` } satisfies ActionData;
    } catch {
      return { ok: false, message: "Unable to enable this Shopify location. Refresh and try again." } satisfies ActionData;
    }
  }
  if (intent === "save_priority_mode") {
    const mode = String(formData.get("priorityMode") ?? "manual");
    if (mode !== "manual" && mode !== "highest_stock") {
      return { ok: false, message: "Choose a supported location priority mode." } satisfies ActionData;
    }
    await prisma.deliverySetting.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, locationPriorityMode: mode },
      update: { locationPriorityMode: mode },
    });
    clearDeliveryCheckCaches(session.shop);
    return { ok: true, message: "Inventory location priority saved." } satisfies ActionData;
  }

  if (intent === "save_icon_style") {
    const iconStyle = String(formData.get("iconStyle") ?? "number");
    const serviceIconColor = String(formData.get("serviceIconColor") ?? "").trim();
    const serviceBackground = String(formData.get("serviceBackground") ?? "").trim();
    const serviceEffect = String(formData.get("serviceEffect") ?? "soft");
    if (!ICON_OPTIONS.some((option) => option.value === iconStyle)) {
      return { ok: false, message: "Choose a supported storefront icon style." } satisfies ActionData;
    }
    if (!isHex(serviceIconColor) || !isHex(serviceBackground)) {
      return { ok: false, message: "Use six-digit hex colors for the storefront service options." } satisfies ActionData;
    }
    if (!EFFECT_OPTIONS.some((option) => option.value === serviceEffect)) {
      return { ok: false, message: "Choose a supported storefront service effect." } satisfies ActionData;
    }
    await prisma.deliverySetting.upsert({
      where: { shop: session.shop },
      create: {
        shop: session.shop,
        storefrontIconStyle: iconStyle,
        storefrontAccentColor: serviceIconColor,
        storefrontJourneyBackground: serviceBackground,
        storefrontAnimation: serviceEffect,
      },
      update: {
        storefrontIconStyle: iconStyle,
        storefrontAccentColor: serviceIconColor,
        storefrontJourneyBackground: serviceBackground,
        storefrontAnimation: serviceEffect,
      },
    });
    clearDeliveryCheckCaches(session.shop);
    return { ok: true, message: "Storefront service icon style saved." } satisfies ActionData;
  }

  const shopifyLocationId = String(formData.get("shopifyLocationId") ?? "").trim();
  const priority = Number(formData.get("priority") ?? 100);
  const processingDays = optionalDays(formData.get("processingDays"));
  const transitDays = optionalDays(formData.get("transitDays"));
  const pickupInstructions = String(formData.get("pickupInstructions") ?? "").trim();
  const pickupEnabled = parseBool(formData.get("pickupEnabled"));
  const localDeliveryEnabled = parseBool(formData.get("localDeliveryEnabled"));
  const enabled = parseBool(formData.get("enabled")) || pickupEnabled || localDeliveryEnabled;
  const pickupPhone = String(formData.get("pickupPhone") ?? "").trim();
  const pickupPreparationRaw = String(formData.get("pickupPreparationDays") ?? "").trim();
  const pickupAdvanceRaw = String(formData.get("pickupAdvanceDays") ?? "").trim();
  const pickupPreparationDays = Number(pickupPreparationRaw);
  const pickupAdvanceDays = Number(pickupAdvanceRaw);
  const pickupWeekdaysRaw = String(formData.get("pickupWeekdaysCsv") ?? "").trim();
  const pickupWeekdays = pickupWeekdaysRaw ? pickupWeekdaysRaw.split(",").map((day) => day.trim()) : [];
  const pickupBlockedDatesRaw = String(formData.get("pickupBlockedDatesCsv") ?? "").trim();
  const pickupBlockedDates = pickupBlockedDatesRaw ? pickupBlockedDatesRaw.split(/[,\n]/).map((date) => date.trim()).filter(Boolean) : [];
  const localDeliveryCountry = String(formData.get("localDeliveryCountry") ?? "").trim().toUpperCase();
  const localDeliveryCoverageMode = String(formData.get("localDeliveryCoverageMode") ?? "postal");
  const localDeliveryZoneIds = [...new Set(String(formData.get("localDeliveryZoneIdsCsv") ?? "").split(",").map((value) => value.trim()).filter(Boolean))];
  const serviceTargetMode = String(formData.get("serviceTargetMode") ?? "all");
  const serviceTargetValues = String(formData.get("serviceTargetValuesCsv") ?? "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const patterns = String(formData.get("localDeliveryPostalCodesCsv") ?? "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!/^gid:\/\/shopify\/Location\/\d+$/.test(shopifyLocationId)) {
    return { ok: false, message: "Invalid Shopify location." } satisfies ActionData;
  }
  if (!Number.isInteger(priority) || priority < 0 || priority > 9999) {
    return { ok: false, message: "Priority must be an integer from 0 to 9999." } satisfies ActionData;
  }
  if ([processingDays, transitDays].some((days) => days !== null && (!Number.isInteger(days) || days < 0 || days > 60))) {
    return { ok: false, message: "Processing and transit overrides must be integers from 0 to 60." } satisfies ActionData;
  }
  if (patterns.length > 500 || patterns.some((pattern) => pattern.length > 30)) {
    return { ok: false, message: "Local delivery supports up to 500 postal patterns of 30 characters each." } satisfies ActionData;
  }
  if (localDeliveryCountry && !COUNTRY_CODES.has(localDeliveryCountry)) {
    return { ok: false, message: "Choose a valid local delivery country." } satisfies ActionData;
  }
  if (localDeliveryCoverageMode !== "postal" && localDeliveryCoverageMode !== "zone") {
    return { ok: false, message: "Choose postal patterns or delivery zones for local delivery coverage." } satisfies ActionData;
  }
  if (localDeliveryEnabled && localDeliveryCoverageMode === "postal" && (!localDeliveryCountry || !patterns.length)) {
    return { ok: false, message: "Choose a local delivery country and add at least one postal code or pattern." } satisfies ActionData;
  }
  if (localDeliveryCoverageMode === "postal" && localDeliveryCountry && patterns.some((pattern) => !validatePostalPattern(localDeliveryCountry, pattern))) {
    return { ok: false, message: `A postal pattern is invalid for ${localDeliveryCountry}. Check the codes, ranges or wildcards.` } satisfies ActionData;
  }
  if (localDeliveryZoneIds.length > 100 || localDeliveryZoneIds.some((id) => !/^\d+$/.test(id))) {
    return { ok: false, message: "Choose valid delivery zones." } satisfies ActionData;
  }
  if (localDeliveryEnabled && localDeliveryCoverageMode === "zone") {
    if (!localDeliveryZoneIds.length) return { ok: false, message: "Choose at least one delivery zone." } satisfies ActionData;
    const ownedZones = await prisma.zone.count({ where: { shop: session.shop, enabled: true, id: { in: localDeliveryZoneIds.map(Number) } } });
    if (ownedZones !== localDeliveryZoneIds.length) return { ok: false, message: "One or more delivery zones are unavailable. Refresh and choose again." } satisfies ActionData;
  }
  if (pickupInstructions.length > 500) {
    return { ok: false, message: "Pickup instructions must be 500 characters or fewer." } satisfies ActionData;
  }
  if (pickupPhone.length > 50) {
    return { ok: false, message: "Pickup phone must be 50 characters or fewer." } satisfies ActionData;
  }
  if (!/^\d+$/.test(pickupPreparationRaw) || !Number.isInteger(pickupPreparationDays) || pickupPreparationDays < 0 || pickupPreparationDays > 60) {
    return { ok: false, message: "Pickup preparation days must be an integer from 0 to 60." } satisfies ActionData;
  }
  if (!/^\d+$/.test(pickupAdvanceRaw) || !Number.isInteger(pickupAdvanceDays) || pickupAdvanceDays < 1 || pickupAdvanceDays > 90 || pickupAdvanceDays < pickupPreparationDays) {
    return { ok: false, message: "Pickup advance horizon must be an integer from 1 to 90 and at least the preparation days." } satisfies ActionData;
  }
  if (pickupWeekdaysRaw.length > 13 || pickupWeekdays.some((day) => !/^[0-6]$/.test(day)) || (pickupEnabled && !pickupWeekdays.length)) {
    return { ok: false, message: "Choose valid pickup weekdays, with at least one day when pickup is enabled." } satisfies ActionData;
  }
  if (pickupBlockedDatesRaw.length > 4000 || pickupBlockedDates.length > 365 || pickupBlockedDates.some((date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return true;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date;
  })) {
    return { ok: false, message: "Blocked pickup dates must be real YYYY-MM-DD dates (up to 365 dates and 4000 characters)." } satisfies ActionData;
  }
  if (!SERVICE_TARGET_OPTIONS.some((option) => option.value === serviceTargetMode)) {
    return { ok: false, message: "Choose a supported service targeting option." } satisfies ActionData;
  }
  if (serviceTargetValues.length > 500 || serviceTargetValues.some((value) => value.length > 100)) {
    return { ok: false, message: "Service targeting supports up to 500 values of 100 characters each." } satisfies ActionData;
  }
  if (serviceTargetMode !== "all" && serviceTargetValues.length === 0) {
    return { ok: false, message: "Add at least one value for the selected service targeting option." } satisfies ActionData;
  }

  let location: ShopifyLocation | null = null;
  try {
    // This authenticated shop lookup rejects foreign or deleted location IDs.
    const response = await admin.graphql(`#graphql
      query VerifyDeliveryLocation($id: ID!) {
        location(id: $id) {
          id name isActive fulfillsOnlineOrders
          address { address1 address2 city province provinceCode zip country countryCode phone }
        }
      }
    `, { variables: { id: shopifyLocationId } });
    const payload = await response.json() as { data?: { location?: ShopifyLocation | null }; errors?: Array<{ message?: string }> };
    if (!response.ok || payload.errors?.length) throw new Error("Location lookup failed.");
    location = payload.data?.location ?? null;
  } catch {
    return { ok: false, message: "Unable to verify this Shopify location. Refresh and try again." } satisfies ActionData;
  }
  if (!location || location.id !== shopifyLocationId || !location.name || location.name.length > 255) {
    return { ok: false, message: "This location does not belong to your Shopify shop or no longer exists." } satisfies ActionData;
  }
  const name = location.name;

  await prisma.fulfillmentLocationRule.upsert({
    where: { shop_shopifyLocationId: { shop: session.shop, shopifyLocationId } },
    create: {
      shop: session.shop,
      shopifyLocationId,
      name,
      enabled,
      priority,
      processingDays,
      transitDays,
      localDeliveryEnabled,
      localDeliveryCountry,
      localDeliveryPostalCodesCsv: [...new Set(patterns)].join(","),
      localDeliveryCoverageMode,
      localDeliveryZoneIdsCsv: localDeliveryZoneIds.join(","),
      pickupEnabled,
      pickupInstructions,
      pickupPhone,
      pickupPreparationDays,
      pickupWeekdaysCsv: [...new Set(pickupWeekdays)].sort().join(","),
      pickupBlockedDatesCsv: [...new Set(pickupBlockedDates)].sort().join(","),
      pickupAdvanceDays,
      serviceTargetMode,
      serviceTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
    },
    update: {
      name,
      enabled,
      priority,
      processingDays,
      transitDays,
      localDeliveryEnabled,
      localDeliveryCountry,
      localDeliveryPostalCodesCsv: [...new Set(patterns)].join(","),
      localDeliveryCoverageMode,
      localDeliveryZoneIdsCsv: localDeliveryZoneIds.join(","),
      pickupEnabled,
      pickupInstructions,
      pickupPhone,
      pickupPreparationDays,
      pickupWeekdaysCsv: [...new Set(pickupWeekdays)].sort().join(","),
      pickupBlockedDatesCsv: [...new Set(pickupBlockedDates)].sort().join(","),
      pickupAdvanceDays,
      serviceTargetMode,
      serviceTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
    },
  });
  clearDeliveryCheckCaches(session.shop);
  return { ok: true, message: `${name} saved.` } satisfies ActionData;
}

function PickupOrdersPanel({ orders, error, orderAccessGranted, shop, shopHandle }: {
  orders: PickupOrder[];
  error: string;
  orderAccessGranted: boolean;
  shop: string;
  shopHandle: string;
}) {
  const formatTimestamp = (value: string) => new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
  const formatPickupDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "Not selected";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  };

  return (
    <BlockStack gap="400">
      {!orderAccessGranted ? (
        <Banner tone="warning" title="Order access required" action={{ content: "Reauthorize app", url: `/auth?shop=${encodeURIComponent(shop)}` }}>
          {error}
        </Banner>
      ) : error ? <Banner tone="warning" title="Some order details are unavailable">{error}</Banner> : null}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">Pickup customer details</Text>
              <Text as="p" tone="subdued">Recent Shopify orders that contain an Incode Track pickup selection. Customer data is read live and is not copied into the app database.</Text>
            </BlockStack>
            <Button url="/app/locations?view=pickups">Refresh orders</Button>
          </InlineStack>
          {orderAccessGranted ? <Text as="p" tone="subdued" variant="bodySm">Showing pickup selections found in the latest 100 Shopify orders.</Text> : null}
        </BlockStack>
      </Card>
      {orders.length ? <div className="incode-pickup-orders">
        {orders.map((order) => {
          const orderNumber = order.id.replace(/\D/g, "");
          return <Card key={order.id}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
                <BlockStack gap="050">
                  <Text as="h3" variant="headingMd">{order.name}</Text>
                  <Text as="p" tone="subdued" variant="bodySm">Ordered {formatTimestamp(order.createdAt)}</Text>
                </BlockStack>
                <InlineStack gap="200" wrap>
                  {order.displayFinancialStatus ? <Badge>{order.displayFinancialStatus.replaceAll("_", " ")}</Badge> : null}
                  {order.displayFulfillmentStatus ? <Badge tone="info">{order.displayFulfillmentStatus.replaceAll("_", " ")}</Badge> : null}
                  <Button size="slim" url={`https://admin.shopify.com/store/${shopHandle}/orders/${orderNumber}`} external target="_blank">Open order</Button>
                </InlineStack>
              </InlineStack>
              <div className="incode-pickup-order__grid">
                <div><small>Customer</small><strong>{order.customerName}</strong><span>{order.email || "Email unavailable"}</span><span>{order.phone || "Phone unavailable"}</span></div>
                <div><small>Pickup</small><strong>{order.pickupLocationName}</strong><span>{order.pickupLocationAddress || "Location address unavailable"}</span><span>{formatPickupDate(order.pickupDate)}</span></div>
                <div><small>Customer address</small><strong>{order.address || "Protected address unavailable"}</strong><span>Available only when Shopify grants protected customer data access.</span></div>
              </div>
            </BlockStack>
          </Card>;
        })}
      </div> : orderAccessGranted && !error ? (
        <Card><BlockStack gap="200"><Text as="h2" variant="headingMd">No pickup orders yet</Text><Text as="p" tone="subdued">Orders appear here after a customer selects Store Pickup in the cart and completes checkout.</Text></BlockStack></Card>
      ) : null}
    </BlockStack>
  );
}

export default function LocationsPage() {
  const { view, access, apiKey, shop, locations, targetSuggestions, priorityMode, locationError, orderAccessGranted, pickupOrders, pickupOrdersError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isAdvanced = access.active;
  const shopHandle = shop.replace(/\.myshopify\.com$/i, "");
  const shopifyLocationsUrl = `https://admin.shopify.com/store/${shopHandle}/settings/locations`;
  const [forms, setForms] = useState<Record<string, LocationForm>>(() => Object.fromEntries(locations.map((location) => [location.id, locationForm(location)])));
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedPriorityMode, setSelectedPriorityMode] = useState(priorityMode);
  useEffect(() => {
    if (!fetcher.data?.ok) return;
    setForms(Object.fromEntries(locations.map((location) => [location.id, locationForm(location)])));
    setSelectedPriorityMode(priorityMode);
  }, [fetcher.data, locations, priorityMode]);
  const updateForm = (locationId: string, field: string, value: string | boolean) => {
    setForms((current) => ({
      ...current,
      [locationId]: {
        ...current[locationId],
        [field]: value,
        ...((field === "pickupEnabled" || field === "localDeliveryEnabled") && value === true ? { enabled: true } : {}),
      },
      }));
  };
  const dirty = selectedPriorityMode !== priorityMode || locations.some((location) => {
    const form = forms[location.id];
    const rule = location.rule;
    return form.enabled !== (rule?.enabled ?? location.isActive) || form.priority !== String(rule?.priority ?? 100)
      || form.processingDays !== String(rule?.processingDays ?? "") || form.transitDays !== String(rule?.transitDays ?? "")
        || form.localDeliveryEnabled !== (rule?.localDeliveryEnabled ?? false) || form.localDeliveryPostalCodesCsv !== (rule?.localDeliveryPostalCodesCsv ?? "")
        || form.localDeliveryCountry !== (rule?.localDeliveryCountry || location.address?.countryCode || "")
        || form.localDeliveryCoverageMode !== (rule?.localDeliveryCoverageMode === "zone" ? "zone" : "postal") || form.localDeliveryZoneIdsCsv !== (rule?.localDeliveryZoneIdsCsv ?? "")
       || form.pickupEnabled !== (rule?.pickupEnabled ?? false) || form.pickupInstructions !== (rule?.pickupInstructions ?? "")
       || form.pickupPhone !== (rule?.pickupPhone ?? "") || form.pickupPreparationDays !== String(rule?.pickupPreparationDays ?? 0)
       || form.pickupWeekdaysCsv !== (rule?.pickupWeekdaysCsv ?? "0,1,2,3,4,5,6") || form.pickupBlockedDatesCsv !== (rule?.pickupBlockedDatesCsv ?? "")
       || form.pickupAdvanceDays !== String(rule?.pickupAdvanceDays ?? 30)
       || form.serviceTargetMode !== (rule?.serviceTargetMode ?? "all") || form.serviceTargetValuesCsv !== (rule?.serviceTargetValuesCsv ?? "");
  });
  useBeforeUnload((event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  useBlocker(() => dirty && !window.confirm("Leave with unsaved location changes?"));
  const localDeliveryCount = locations.filter((location) => forms[location.id]?.localDeliveryEnabled).length;
  const pickupCount = locations.filter((location) => forms[location.id]?.pickupEnabled).length;
  const blockEditorUrl = (template: "cart" | "product") => `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=${template}&addAppBlockId=${apiKey}/delivery-service-options&target=mainSection`;
  const visibleLocations = locations.filter((location) => {
    const query = locationSearch.trim().toLowerCase();
    if (!query) return true;
    return [location.name, location.address?.address1, location.address?.address2, location.address?.city, location.address?.province, location.address?.zip, location.address?.country]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  return (
      <Page
      title="Delivery & pickup"
      subtitle="Set up where you deliver, then configure local delivery and pickup options."
      titleMetadata={<Badge tone={isAdvanced ? "success" : "info"}>{isAdvanced ? "Standard" : "Subscription required"}</Badge>}
      primaryAction={{ content: "Add pickup location", url: shopifyLocationsUrl, external: true }}
    >
      <BlockStack gap="400">
        <div className="incode-location-tabs" role="navigation" aria-label="Delivery and pickup views">
          <Button url="/app/locations" variant={view === "setup" ? "primary" : "tertiary"}>Service setup</Button>
          <Button url="/app/locations?view=pickups" variant={view === "pickups" ? "primary" : "tertiary"}>Pickup orders</Button>
        </div>
        {view === "pickups" ? (
          <PickupOrdersPanel orders={pickupOrders} error={pickupOrdersError} orderAccessGranted={orderAccessGranted} shop={shop} shopHandle={shopHandle} />
        ) : <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
              <BlockStack gap="100">
                <Text as="h2" variant="headingLg">Storefront block</Text>
                <Text as="p" tone="subdued">Enable the Local delivery & pickup block on your cart page so customers choose Shipping, Store Pickup, or Delivery above checkout. Product page is optional.</Text>
              </BlockStack>
              <InlineStack gap="200" wrap>
                <Button url={blockEditorUrl("cart")} external target="_blank" variant="primary">Enable on cart page</Button>
                <Button url={blockEditorUrl("product")} external target="_blank">Enable on product page</Button>
              </InlineStack>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">Opens Theme Editor with the block preselected. Use the Theme Editor eye icon to show or hide it anytime without losing settings.</Text>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
              <BlockStack gap="100">
                <Text as="h2" variant="headingLg">Pickup locations</Text>
                <Text as="p" tone="subdued">Locations are securely synced from Shopify, including address, phone, inventory and fulfillment status.</Text>
              </BlockStack>
              <InlineStack gap="200" wrap>
                <Button url="/app/locations">Refresh</Button>
                <Button url={shopifyLocationsUrl} external target="_blank" variant="primary">Add new location</Button>
              </InlineStack>
            </InlineStack>
            {locations.length > 1 ? <TextField label="Search pickup locations" labelHidden value={locationSearch} onChange={setLocationSearch} clearButton onClearButtonClick={() => setLocationSearch("")} autoComplete="off" placeholder={`Search ${locations.length} locations by name, city or postcode`} /> : null}
            {visibleLocations.length ? <div className="incode-pickup-directory">
              {visibleLocations.map((location) => {
                const form = forms[location.id];
                const ready = location.isActive && location.fulfillsOnlineOrders && form.enabled;
                const shortAddress = [location.address?.city, location.address?.provinceCode, location.address?.countryCode].filter(Boolean).join(", ");
                return <div key={location.id} className="incode-pickup-directory__item">
                  <span className="incode-pickup-directory__pin" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 22s7-6.1 7-13a7 7 0 1 0-14 0c0 6.9 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/></svg></span>
                  <span><strong>{location.name}</strong><small>{shortAddress || "Address needed in Shopify"}</small></span>
                  <span className={`incode-pickup-directory__state ${form.pickupEnabled && ready ? "is-ready" : ""}`}>{form.pickupEnabled && ready ? "Pickup ready" : !ready ? "Needs setup" : "Pickup off"}</span>
                  <span className="incode-pickup-directory__actions">
                    {!form.pickupEnabled || !form.enabled || !form.localDeliveryEnabled ? <fetcher.Form method="post"><input type="hidden" name="intent" value="enable_pickup"/><input type="hidden" name="shopifyLocationId" value={location.id}/><Button submit size="slim" variant="primary" loading={fetcher.state !== "idle"}>Enable configured services</Button></fetcher.Form> : null}
                    <Button size="slim" url={`#pickup-location-${location.id.replace(/\D/g, "")}`}>Configure</Button>
                  </span>
                </div>;
              })}
            </div> : locations.length ? <Text as="p" tone="subdued">No locations match your search.</Text> : <Banner tone="warning" title="No Shopify locations found">Add your first location in Shopify, assign inventory, then return here and refresh.</Banner>}
            <Text as="p" tone="subdued" variant="bodySm">After adding a location in Shopify, return here, refresh, enable it, and turn on Store pickup.</Text>
          </BlockStack>
        </Card>
        {locationError ? (
          <Banner tone="warning" title="Shopify locations could not be refreshed">
            {locationError} Existing saved location rules are still shown. Reauthorize the app with the read_locations permission, then refresh this page.
          </Banner>
        ) : null}
        {fetcher.data ? (
          <Banner tone={fetcher.data.ok ? "success" : "critical"} title={fetcher.data.ok ? "Location saved" : "Could not save location"}>
            {fetcher.data.message}
          </Banner>
        ) : null}
        {!isAdvanced ? (
          <Banner tone="info" title="Standard subscription required" action={{ content: "View plan", url: "/app/plans" }}>
            Activate Standard to configure fulfillment routing, location-specific transit times, pickup, and local delivery.
          </Banner>
        ) : null}
        <div className="incode-location-metrics">
          <div><strong>{locations.length}</strong><span>Shopify locations</span></div>
          <div><strong>{localDeliveryCount}</strong><span>Local delivery</span></div>
          <div><strong>{pickupCount}</strong><span>Store pickup</span></div>
        </div>
        <Card>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="save_priority_mode" />
            <div className="incode-location-strategy">
              <div><Text as="h2" variant="headingMd">Location selection</Text><Text as="p" tone="subdued" variant="bodySm">Choose how orders are matched to stocked locations.</Text></div>
              <Select label="Selection strategy" labelHidden name="priorityMode" value={selectedPriorityMode} disabled={!isAdvanced} onChange={setSelectedPriorityMode} options={[{ label: "Manual priority", value: "manual" }, { label: "Highest available stock", value: "highest_stock" }]} />
              <Button submit disabled={!isAdvanced || selectedPriorityMode === priorityMode} loading={fetcher.state !== "idle"}>Save</Button>
            </div>
          </fetcher.Form>
        </Card>
        {locations.map((location) => {
          const form = forms[location.id];
          const address = [location.address?.address1, location.address?.address2, location.address?.city, location.address?.province || location.address?.provinceCode, location.address?.zip, location.address?.country || location.address?.countryCode]
            .filter(Boolean)
            .join(", ");
          return (
            <div key={location.id} id={`pickup-location-${location.id.replace(/\D/g, "")}`} className="incode-location-anchor"><Card>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="save_location" />
                <input type="hidden" name="shopifyLocationId" value={location.id} />
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start" gap="200" wrap>
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">{location.name}</Text>
                      <Text as="p" tone="subdued">{address || "No address configured in Shopify"}</Text>
                    </BlockStack>
                    <InlineStack gap="200" wrap>
                      <Badge tone={location.isActive ? "success" : undefined}>{location.isActive ? "Active" : "Inactive"}</Badge>
                      <Badge tone={location.fulfillsOnlineOrders ? "info" : undefined}>{location.fulfillsOnlineOrders ? "Online fulfillment" : "Not online"}</Badge>
                      <Badge tone={form.localDeliveryEnabled ? "success" : undefined}>{form.localDeliveryEnabled ? "Delivery on" : "Delivery off"}</Badge>
                      <Badge tone={form.pickupEnabled ? "success" : undefined}>{form.pickupEnabled ? "Pickup on" : "Pickup off"}</Badge>
                    </InlineStack>
                  </InlineStack>
                  <div className="incode-location-enable">
                    <Checkbox label="Location enabled for services" name="enabled" checked={form.enabled} disabled={!isAdvanced || form.localDeliveryEnabled || form.pickupEnabled} onChange={(checked) => updateForm(location.id, "enabled", checked)} helpText={form.localDeliveryEnabled || form.pickupEnabled ? "Automatically enabled while delivery or pickup is on." : "Enable this location for routing."} />
                    <Button submit disabled={!isAdvanced} loading={fetcher.state !== "idle"}>Save status</Button>
                  </div>
                  <div className="incode-location-sections">
                    <LocationSettingsSection title="Routing & delivery timing" description="Priority and optional delivery-time overrides" status={selectedPriorityMode === "manual" ? `Priority ${form.priority}` : "Stock based"}>
                      <FormLayout>
                      <FormLayout.Group condensed>
                       <TextField label="Priority" name="priority" type="number" min={0} max={9999} value={form.priority} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "priority", value)} autoComplete="off" helpText="Lower priority is selected first." />
                       <TextField label="Processing days override" name="processingDays" type="number" min={0} max={60} value={form.processingDays} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "processingDays", value)} autoComplete="off" />
                       <TextField label="Transit days override" name="transitDays" type="number" min={0} max={60} value={form.transitDays} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "transitDays", value)} autoComplete="off" />
                      </FormLayout.Group>
                      <div className="incode-section-save"><Button submit variant="primary" disabled={!isAdvanced} loading={fetcher.state !== "idle"}>Save routing</Button></div>
                      </FormLayout>
                    </LocationSettingsSection>
                    <LocationSettingsSection title="Local delivery" description="Use existing delivery zones or manual postal coverage" status={form.localDeliveryEnabled ? form.localDeliveryCoverageMode === "zone" ? `${form.localDeliveryZoneIdsCsv.split(",").filter(Boolean).length} zones` : "Postal coverage" : "Off"}>
                      <FormLayout>
                     <Checkbox label="Offer local delivery from this location" name="localDeliveryEnabled" checked={form.localDeliveryEnabled} disabled={!isAdvanced} onChange={(checked) => updateForm(location.id, "localDeliveryEnabled", checked)} />
                    <div hidden={!form.localDeliveryEnabled} className="incode-service-settings">
                    <Select label="Coverage source" name="localDeliveryCoverageMode" value={form.localDeliveryCoverageMode} disabled={!isAdvanced} options={[{ label: "Use existing delivery zones (recommended)", value: "zone" }, { label: "Enter postal codes and patterns manually", value: "postal" }]} onChange={(value) => updateForm(location.id, "localDeliveryCoverageMode", value)} helpText="Zones stay synced with the coverage already configured in Delivery control." />
                    {form.localDeliveryCoverageMode === "zone" ? (
                      <ServiceTargetPicker name="localDeliveryZoneIdsCsv" options={targetSuggestions.zone} label="Delivery zones" value={form.localDeliveryZoneIdsCsv} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "localDeliveryZoneIdsCsv", value)} />
                    ) : <>
                     <Select
                      label="Local delivery country"
                      name="localDeliveryCountry"
                      options={[{ label: "Choose a country", value: "" }, ...COUNTRY_OPTIONS]}
                      value={form.localDeliveryCountry}
                      onChange={(value) => updateForm(location.id, "localDeliveryCountry", value)}
                      disabled={!isAdvanced}
                      helpText="Postal patterns apply only in this country. Each location can serve a different country."
                    />
                    {form.localDeliveryEnabled && !location.rule?.localDeliveryCountry ? <Text as="p" tone="caution" variant="bodySm">Save this location to confirm its delivery country.</Text> : null}
                    <TextField
                      label="Local delivery postal patterns"
                      name="localDeliveryPostalCodesCsv"
                      value={form.localDeliveryPostalCodesCsv}
                      disabled={!isAdvanced}
                      onChange={(value) => updateForm(location.id, "localDeliveryPostalCodesCsv", value)}
                      multiline={3}
                      autoComplete="off"
                      helpText="Comma or line separated exact codes, ranges, or wildcards. Example: 10001, 10010-10020, 100*."
                    />
                    </>}
                    </div>
                    <div className="incode-section-save"><Button submit variant="primary" disabled={!isAdvanced} loading={fetcher.state !== "idle"}>Save local delivery</Button></div>
                      </FormLayout>
                    </LocationSettingsSection>
                    <LocationSettingsSection title="Store pickup" description="Availability, schedule, contact and instructions" status={form.pickupEnabled ? "Enabled" : "Off"}>
                      <FormLayout>
                     <Checkbox label="Offer in-store pickup from this location" name="pickupEnabled" checked={form.pickupEnabled} disabled={!isAdvanced} onChange={(checked) => updateForm(location.id, "pickupEnabled", checked)} />
                    <div className="incode-pickup-readiness">
                      <strong>Pickup readiness</strong>
                      <span data-ready={location.isActive}>{location.isActive ? "Ready" : "Required"} · Shopify location active</span>
                      <span data-ready={location.fulfillsOnlineOrders}>{location.fulfillsOnlineOrders ? "Ready" : "Required"} · Online fulfillment enabled</span>
                      <span data-ready={form.pickupEnabled}>{form.pickupEnabled ? "Ready" : "Required"} · Store pickup enabled here</span>
                      <small>Products also need enough inventory assigned to this exact Shopify location.</small>
                    </div>
                    <div hidden={!form.pickupEnabled} className="incode-service-settings">
                    <FormLayout.Group>
                      <TextField label="Pickup instructions" name="pickupInstructions" value={form.pickupInstructions} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "pickupInstructions", value)} maxLength={500} autoComplete="off" />
                      <TextField label="Pickup phone override" name="pickupPhone" type="tel" value={form.pickupPhone} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "pickupPhone", value)} maxLength={50} autoComplete="tel" helpText={`Blank uses Shopify phone${location.address?.phone ? ` (${location.address.phone})` : ""}.`} />
                    </FormLayout.Group>
                    <FormLayout.Group>
                      <TextField label="Pickup preparation days" name="pickupPreparationDays" type="number" min={0} max={60} step={1} value={form.pickupPreparationDays} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "pickupPreparationDays", value)} autoComplete="off" helpText="Days needed before an order can be ready for pickup (0-60)." />
                      <TextField label="Pickup advance horizon (days)" name="pickupAdvanceDays" type="number" min={1} max={90} step={1} value={form.pickupAdvanceDays} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "pickupAdvanceDays", value)} autoComplete="off" helpText="How far ahead pickup dates are offered (1-90 days). Must be at least the preparation days." />
                    </FormLayout.Group>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Pickup weekdays</Text>
                      <input type="hidden" name="pickupWeekdaysCsv" value={form.pickupWeekdaysCsv} />
                      <InlineStack gap="300" wrap>
                        {PICKUP_WEEKDAYS.map((label, day) => <Checkbox key={day} label={label} checked={form.pickupWeekdaysCsv.split(",").includes(String(day))} disabled={!isAdvanced} onChange={(checked) => {
                          const selected = form.pickupWeekdaysCsv.split(",").filter(Boolean);
                          updateForm(location.id, "pickupWeekdaysCsv", (checked ? [...new Set([...selected, String(day)])] : selected.filter((value) => value !== String(day))).sort().join(","));
                        }} />)}
                      </InlineStack>
                      <Text as="p" tone="subdued" variant="bodySm">Choose at least one weekday when pickup is enabled. Blocked dates below are excluded even on selected weekdays.</Text>
                    </BlockStack>
                    <BlockedDatesPicker value={form.pickupBlockedDatesCsv} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "pickupBlockedDatesCsv", value)} />
                    </div>
                    <div className="incode-section-save"><Button submit variant="primary" disabled={!isAdvanced} loading={fetcher.state !== "idle"}>Save store pickup</Button></div>
                      </FormLayout>
                    </LocationSettingsSection>
                    <LocationSettingsSection title="Customer targeting" description="Limit services by product, collection, tag or zone" status={form.serviceTargetMode === "all" ? "Everyone" : SERVICE_TARGET_OPTIONS.find((option) => option.value === form.serviceTargetMode)?.label || "Filtered"}>
                      <BlockStack gap="300">
                      <Select
                        label="Show services for"
                        name="serviceTargetMode"
                        value={form.serviceTargetMode}
                        disabled={!isAdvanced}
                        options={SERVICE_TARGET_OPTIONS}
                        onChange={(value) => {
                          updateForm(location.id, "serviceTargetMode", value);
                          updateForm(location.id, "serviceTargetValuesCsv", "");
                        }}
                      />
                      {form.serviceTargetMode !== "all" ? (() => {
                        const options = targetSuggestions[form.serviceTargetMode as keyof TargetSuggestions] ?? [];
                        const targetLabel = form.serviceTargetMode === "product" ? "Products" : form.serviceTargetMode === "collection" ? "Collections" : form.serviceTargetMode === "tag" ? "Product tags" : "Delivery zones";
                        return (
                          <ServiceTargetPicker
                            key={form.serviceTargetMode}
                            options={options}
                            label={targetLabel}
                            value={form.serviceTargetValuesCsv}
                            disabled={!isAdvanced}
                            onChange={(value) => updateForm(location.id, "serviceTargetValuesCsv", value)}
                          />
                          );
                        })() : null}
                        <div className="incode-section-save"><Button submit variant="primary" disabled={!isAdvanced} loading={fetcher.state !== "idle"}>Save targeting</Button></div>
                      </BlockStack>
                    </LocationSettingsSection>
                  </div>
                </BlockStack>
              </fetcher.Form>
            </Card></div>
          );
        })}
        {locations.length === 0 ? <Text as="p">No Shopify locations are available.</Text> : null}
        </BlockStack>}
      </BlockStack>
    </Page>
  );
}
