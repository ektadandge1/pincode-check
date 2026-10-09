import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useBeforeUnload, useBlocker, useFetcher, useLoaderData } from "react-router";
import {
  Autocomplete,
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
import { loadShopifyTargetSuggestionsForKind } from "../services/shopify-target-suggestions.server";
import { validatePostalPattern } from "../utils/delivery.server";
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

type ActionData = {
  ok: boolean;
  message: string;
  savedPriorityMode?: string;
  saved?: {
    locationId: string;
    section: string;
    values: Partial<LocationForm>;
  };
};

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

type DeliveryOrder = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  deliveryDate: string;
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
  localDeliveryTargetMode: string;
  localDeliveryTargetValuesCsv: string;
  pickupTargetMode: string;
  pickupTargetValuesCsv: string;
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
    localDeliveryTargetMode: location.rule?.localDeliveryTargetMode ?? location.rule?.serviceTargetMode ?? "all",
    localDeliveryTargetValuesCsv: location.rule?.localDeliveryTargetValuesCsv ?? location.rule?.serviceTargetValuesCsv ?? "",
    pickupTargetMode: location.rule?.pickupTargetMode ?? location.rule?.serviceTargetMode ?? "all",
    pickupTargetValuesCsv: location.rule?.pickupTargetValuesCsv ?? location.rule?.serviceTargetValuesCsv ?? "",
  };
}

type TargetSuggestions = Record<"product" | "collection" | "tag" | "zone", Array<{ label: string; value: string }>>;

const SERVICE_TARGET_OPTIONS = [
  { label: "All products and customers", value: "all" },
  { label: "Only selected products", value: "product" },
  { label: "Only products in selected collections", value: "collection" },
  { label: "Only products with selected tags", value: "tag" },
];
const LEGACY_SERVICE_TARGET_OPTION = { label: "Existing delivery-zone restriction", value: "zone", disabled: true };

const TARGET_MODE_VALUES = new Set(["all", "product", "collection", "tag", "zone"]);

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
  const selected = value.split(",").map((item) => item.trim()).filter(Boolean);
  const query = search.trim().toLowerCase();
  const visible = options
    .filter((option) => !query || `${option.label} ${option.value}`.toLowerCase().includes(query))
    .slice(0, 100);
  for (const selectedValue of selected) {
    if (!visible.some((option) => option.value === selectedValue)) {
      visible.unshift(options.find((option) => option.value === selectedValue) ?? { label: selectedValue, value: selectedValue });
    }
  }

  return (
    <section className="incode-service-picker" aria-label={`Choose ${label.toLowerCase()}`}>
      <input type="hidden" name={name} value={value} />
      <div className="incode-service-picker__header">
        <Text as="h4" variant="headingSm">Choose {label.toLowerCase()}</Text>
        <Badge tone={selected.length ? "success" : "info"}>{`${selected.length} selected`}</Badge>
      </div>
      <Autocomplete
        allowMultiple
        options={visible}
        selected={selected}
        onSelect={(next) => onChange([...new Set(next)].slice(0, 100).join(","))}
        emptyState={options.length ? "No matching choices." : "No choices available. Refresh after adding them in Shopify."}
        textField={<Autocomplete.TextField
          label={`Search ${label.toLowerCase()}`}
          value={search}
          onChange={setSearch}
          placeholder={`Search ${options.length} ${label.toLowerCase()}`}
          autoComplete="off"
          disabled={disabled}
          clearButton
          onClearButtonClick={() => setSearch("")}
          prefix={<svg className="incode-service-picker__search-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>}
        />}
      />
      {selected.length ? <div className="incode-service-picker__selected">
        {selected.map((selectedValue) => <Tag key={selectedValue} onRemove={disabled ? undefined : () => onChange(selected.filter((item) => item !== selectedValue).join(","))}>
          {options.find((option) => option.value === selectedValue)?.label ?? selectedValue}
        </Tag>)}
        <Button variant="plain" disabled={disabled} onClick={() => onChange("")}>Clear all</Button>
      </div> : null}
    </section>
  );
}

function ServiceAudienceFields({ serviceLabel, mode, values, modeName, valuesName, suggestions, disabled, onModeChange, onValuesChange }: {
  serviceLabel: string;
  mode: string;
  values: string;
  modeName: string;
  valuesName: string;
  suggestions: Array<{ label: string; value: string }>;
  disabled: boolean;
  onModeChange: (value: string) => void;
  onValuesChange: (value: string) => void;
}) {
  const options = mode === "zone" ? [LEGACY_SERVICE_TARGET_OPTION, ...SERVICE_TARGET_OPTIONS] : SERVICE_TARGET_OPTIONS;
  const targetLabel = mode === "product" ? "Products" : mode === "collection" ? "Collections" : mode === "tag" ? "Product tags" : "Existing delivery zones";
  return (
    <BlockStack gap="200">
      <Text as="h4" variant="headingSm">{serviceLabel} audience</Text>
      {mode === "zone" ? <Banner tone="warning" title="Legacy delivery-zone restriction">Choose another audience option to replace this saved restriction.</Banner> : null}
      <Select
        label="Show this service for"
        name={modeName}
        value={mode}
        disabled={disabled}
        options={options}
        onChange={onModeChange}
      />
      {mode !== "all" ? (
        <ServiceTargetPicker
          options={suggestions}
          label={targetLabel}
          value={values}
          name={valuesName}
          disabled={disabled || mode === "zone"}
          onChange={onValuesChange}
        />
      ) : null}
    </BlockStack>
  );
}

async function validateServiceTarget(admin: Parameters<typeof loadShopifyTargetSuggestionsForKind>[0], shop: string, mode: string, values: string[]) {
  if (!TARGET_MODE_VALUES.has(mode)) return "Choose a supported service targeting option.";
  if (values.length > 500 || values.some((value) => value.length > 100)) return "Service targeting supports up to 500 values of 100 characters each.";
  if (mode !== "all" && values.length === 0) return "Add at least one value for the selected service targeting option.";
  if (mode === "product" || mode === "collection" || mode === "tag") {
    try {
      const suggestions = await loadShopifyTargetSuggestionsForKind(admin, mode);
      const allowed = new Set(suggestions.map((suggestion) => suggestion.value));
      if (values.some((value) => !allowed.has(value))) return "One or more selected Shopify targets are unavailable. Refresh and choose again.";
    } catch {
      return "Shopify could not verify the selected targets. Refresh and try again.";
    }
  }
  if (mode === "zone") {
    const zoneIds = values.filter((value) => /^\d+$/.test(value)).map(Number);
    const ownedZones = zoneIds.length === values.length
      ? await prisma.zone.count({ where: { shop, enabled: true, id: { in: zoneIds } } })
      : 0;
    if (ownedZones !== values.length) return "One or more selected delivery zones are unavailable. Refresh and choose again.";
  }
  return null;
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

function LocationSettingsSection({ id, title, description, status, children }: { id?: string; title: string; description: string; status: string; children: React.ReactNode }) {
  return (
    <details id={id} className="incode-location-section" open>
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

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const url = new URL(request.url);
  const requestedView = url.searchParams.get("view");
  const requestedLocationId = url.searchParams.get("location");
  const view = requestedView === "pickups" || requestedView === "deliveries" ? requestedView : "setup";
  const [rules, setting, zones, targetRuleCount] = await Promise.all([
    prisma.fulfillmentLocationRule.findMany({
      where: { shop: session.shop },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    }),
    prisma.deliverySetting.findUnique({ where: { shop: session.shop } }),
    prisma.zone.findMany({ where: { shop: session.shop, enabled: true }, orderBy: [{ priority: "asc" }, { name: "asc" }] }),
    prisma.serviceAvailabilityRule?.count?.({ where: { shop: session.shop, enabled: true } }) ?? 0,
  ]);
  const ruleByLocation = new Map(rules.map((rule) => [rule.shopifyLocationId, rule]));
  let locations: LocationRow[] = [];
  let locationError = "";
  let catalogError = "";
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
           pageInfo { hasNextPage endCursor }
         }
       }
    `);
    const payload = (await response.json()) as {
      data?: {
        locations?: { nodes?: ShopifyLocation[]; pageInfo?: { hasNextPage: boolean; endCursor: string | null } };
      };
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok || payload.errors?.length) {
      throw new Error(payload.errors?.[0]?.message ?? "Unable to load Shopify locations.");
    }
    const locationNodes = [...(payload.data?.locations?.nodes ?? [])];
    let locationPageInfo = payload.data?.locations?.pageInfo;
    let locationPages = 1;
    while (locationPageInfo?.hasNextPage) {
      if (!locationPageInfo.endCursor || locationPages >= 10) {
        locationError = "More than 100 Shopify locations exist. Only the first locations could be loaded. Use search to find a specific location.";
        break;
      }
      const nextResponse = await admin.graphql(`#graphql
        query DeliveryLocationsNext($after: String!) {
          locations(first: 100, after: $after, includeInactive: true) {
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
            pageInfo { hasNextPage endCursor }
          }
        }
      `, { variables: { after: locationPageInfo.endCursor } });
      const next = await nextResponse.json() as typeof payload;
      if (!nextResponse.ok || next.errors?.length) {
        throw new Error(next.errors?.[0]?.message ?? "Unable to load all Shopify locations.");
      }
      locationNodes.push(...(next.data?.locations?.nodes ?? []));
      const nextPageInfo = next.data?.locations?.pageInfo;
      if (!nextPageInfo || (nextPageInfo.hasNextPage && nextPageInfo.endCursor === locationPageInfo.endCursor)) {
        throw new Error("Shopify location pagination could not be completed.");
      }
      locationPageInfo = nextPageInfo;
      locationPages += 1;
      if (locationPageInfo?.hasNextPage && locationPages >= 10) {
        locationError = "More than 1,000 Shopify locations exist. Only the first 1,000 are shown.";
        break;
      }
    }
    locations = locationNodes.map((location) => ({
      ...location,
      rule: ruleByLocation.get(location.id) ?? null,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Shopify locations.";
    locationError = [locationError, message].filter(Boolean).join(" ");
    if (locations.length === 0) {
      locations = rules.map((rule) => ({
        id: rule.shopifyLocationId,
        name: rule.name,
        isActive: false,
        fulfillsOnlineOrders: false,
        address: null,
        rule,
      }));
    }
  }
  const selectedLocationId = requestedLocationId && locations.some((location) => location.id === requestedLocationId)
    ? requestedLocationId
    : view === "setup" && locations.length === 1 ? locations[0].id : null;
  if (view === "setup" && selectedLocationId) {
    try {
      const [product, collection, tag] = await Promise.all([
        loadShopifyTargetSuggestionsForKind(admin, "product"),
        loadShopifyTargetSuggestionsForKind(admin, "collection"),
        loadShopifyTargetSuggestionsForKind(admin, "tag"),
      ]);
      targetSuggestions = { product, collection, tag, zone: targetSuggestions.zone };
    } catch (error) {
      catalogError = error instanceof Error ? error.message : "Unable to load Shopify catalog choices.";
    }
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
  const deliveryOrders: DeliveryOrder[] = [];
  let deliveryOrdersError = "";
  if (view === "pickups" || view === "deliveries") {
    if (!orderAccessGranted) {
      pickupOrdersError = "Shopify order access has not been granted yet. Reauthorize the app after adding read_orders to view pickup customer details.";
    } else {
      try {
        const response = await admin.graphql(`#graphql
          query RecentServiceOrders {
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
          if (view === "deliveries") {
            const deliveryDate = attributes.get("_incode_delivery_date") ?? "";
            if (attributes.get("_incode_service_type") !== "delivery" && !deliveryDate) continue;
            const customerName = [attributes.get("_incode_delivery_first_name"), attributes.get("_incode_delivery_last_name")].filter(Boolean).join(" ")
              || order.customer?.displayName || order.shippingAddress?.name || "Customer details unavailable";
            deliveryOrders.push({
              id: order.id,
              name: order.name,
              createdAt: order.createdAt,
              displayFinancialStatus: order.displayFinancialStatus,
              displayFulfillmentStatus: order.displayFulfillmentStatus,
              customerName,
              email: attributes.get("_incode_delivery_email") || order.email || "",
              phone: attributes.get("_incode_delivery_phone") || order.phone || order.shippingAddress?.phone || "",
              address: [order.shippingAddress?.address1, order.shippingAddress?.address2, order.shippingAddress?.city, order.shippingAddress?.province, order.shippingAddress?.zip, order.shippingAddress?.country].filter(Boolean).join(", "),
              postalCode: attributes.get("_incode_service_postal_code") || order.shippingAddress?.zip || "",
              deliveryDate,
            });
            continue;
          }
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
          const message = "Some protected customer fields are unavailable. Request protected customer data access in Shopify Partners to show complete addresses.";
          pickupOrdersError = message;
          deliveryOrdersError = message;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Shopify could not load recent orders.";
        pickupOrdersError = message;
        deliveryOrdersError = message;
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
    locations,
    selectedLocationId,
    targetSuggestions,
    targetRuleCount,
    locationError,
    catalogError,
    orderAccessGranted,
    pickupOrders,
    pickupOrdersError,
    deliveryOrders,
    deliveryOrdersError,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const access = await resolvePlanAccess({ shop: session.shop, admin });
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  if (intent !== "save_location" && intent !== "save_priority_mode" && intent !== "enable_pickup") {
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
      return {
        ok: true,
        message: `${location.name} is enabled for pickup${deliveryConfigured ? " and local delivery" : ""}. Assign inventory to this location for every eligible product.`,
        saved: {
          locationId: shopifyLocationId,
          section: "enable_pickup",
          values: { enabled: true, pickupEnabled: true, localDeliveryEnabled: deliveryConfigured },
        },
      } satisfies ActionData;
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
    return { ok: true, message: "Inventory location priority saved.", savedPriorityMode: mode } satisfies ActionData;
  }

  const shopifyLocationId = String(formData.get("shopifyLocationId") ?? "").trim();
  const priority = Number(formData.get("priority") ?? 100);
  const processingDays = optionalDays(formData.get("processingDays"));
  const transitDays = optionalDays(formData.get("transitDays"));
  const pickupInstructions = String(formData.get("pickupInstructions") ?? "").trim();
  const pickupEnabled = parseBool(formData.get("pickupEnabledState") ?? formData.get("pickupEnabled"));
  const localDeliveryEnabled = parseBool(formData.get("localDeliveryEnabledState") ?? formData.get("localDeliveryEnabled"));
  const enabled = parseBool(formData.get("enabledState") ?? formData.get("enabled")) || pickupEnabled || localDeliveryEnabled;
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
  const legacyServiceTargetMode = String(formData.get("serviceTargetMode") ?? "all");
  const legacyServiceTargetValues = String(formData.get("serviceTargetValuesCsv") ?? "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const localDeliveryTargetMode = String(formData.get("localDeliveryTargetMode") ?? legacyServiceTargetMode);
  const localDeliveryTargetValues = String(formData.get("localDeliveryTargetValuesCsv") ?? (formData.has("localDeliveryTargetMode") ? "" : formData.get("serviceTargetValuesCsv") ?? ""))
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const pickupTargetMode = String(formData.get("pickupTargetMode") ?? legacyServiceTargetMode);
  const pickupTargetValues = String(formData.get("pickupTargetValuesCsv") ?? (formData.has("pickupTargetMode") ? "" : formData.get("serviceTargetValuesCsv") ?? ""))
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const serviceTargetMode = legacyServiceTargetMode;
  const serviceTargetValues = legacyServiceTargetValues;
  const patterns = String(formData.get("localDeliveryPostalCodesCsv") ?? "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const section = String(formData.get("section") ?? "all").trim() || "all";
  if (!["all", "status", "routing", "delivery", "pickup", "targeting"].includes(section)) {
    return { ok: false, message: "Unsupported location section." } satisfies ActionData;
  }

  if (!/^gid:\/\/shopify\/Location\/\d+$/.test(shopifyLocationId)) {
    return { ok: false, message: "Invalid Shopify location." } satisfies ActionData;
  }

  if (section !== "all") {
    const existingRule = await prisma.fulfillmentLocationRule.findUnique({
      where: { shop_shopifyLocationId: { shop: session.shop, shopifyLocationId } },
    });
    const submittedEnabled = parseBool(formData.get("enabledState") ?? formData.get("enabled"));
    const baseEnabled = existingRule?.enabled ?? false;
    const basePickupEnabled = existingRule?.pickupEnabled ?? false;
    const baseDeliveryEnabled = existingRule?.localDeliveryEnabled ?? false;

    if (section === "status") {
      const nextEnabled = submittedEnabled || basePickupEnabled || baseDeliveryEnabled;
      let location: ShopifyLocation | null = null;
      try {
        const response = await admin.graphql(`#graphql
          query VerifyDeliveryLocation($id: ID!) {
            location(id: $id) { id name isActive fulfillsOnlineOrders }
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
      await prisma.fulfillmentLocationRule.upsert({
        where: { shop_shopifyLocationId: { shop: session.shop, shopifyLocationId } },
        create: {
          shop: session.shop,
          shopifyLocationId,
          name: location.name,
          enabled: nextEnabled,
          priority: existingRule?.priority ?? 100,
          processingDays: existingRule?.processingDays ?? null,
          transitDays: existingRule?.transitDays ?? null,
        },
        update: { name: location.name, enabled: nextEnabled },
      });
      clearDeliveryCheckCaches(session.shop);
      return {
        ok: true,
        message: `${location.name} status saved.`,
        saved: { locationId: shopifyLocationId, section: "status", values: { enabled: nextEnabled } },
      } satisfies ActionData;
    }

    if (section === "routing") {
      if (!Number.isInteger(priority) || priority < 0 || priority > 9999) {
        return { ok: false, message: "Priority must be an integer from 0 to 9999." } satisfies ActionData;
      }
      if ([processingDays, transitDays].some((days) => days !== null && (!Number.isInteger(days) || days < 0 || days > 60))) {
        return { ok: false, message: "Processing and transit overrides must be integers from 0 to 60." } satisfies ActionData;
      }
      let location: ShopifyLocation | null = null;
      try {
        const response = await admin.graphql(`#graphql
          query VerifyDeliveryLocation($id: ID!) {
            location(id: $id) { id name isActive fulfillsOnlineOrders }
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
      await prisma.fulfillmentLocationRule.upsert({
        where: { shop_shopifyLocationId: { shop: session.shop, shopifyLocationId } },
        create: {
          shop: session.shop,
          shopifyLocationId,
          name: location.name,
          enabled: baseEnabled || basePickupEnabled || baseDeliveryEnabled,
          priority,
          processingDays,
          transitDays,
        },
        update: { name: location.name, priority, processingDays, transitDays },
      });
      clearDeliveryCheckCaches(session.shop);
      return {
        ok: true,
        message: `${location.name} routing saved.`,
        saved: {
          locationId: shopifyLocationId,
          section: "routing",
          values: {
            priority: String(priority),
            processingDays: processingDays === null ? "" : String(processingDays),
            transitDays: transitDays === null ? "" : String(transitDays),
          },
        },
      } satisfies ActionData;
    }

    if (section === "delivery") {
      if (localDeliveryEnabled) {
        const targetError = await validateServiceTarget(admin, session.shop, localDeliveryTargetMode, localDeliveryTargetValues);
        if (targetError) return { ok: false, message: targetError } satisfies ActionData;
      }
      if (localDeliveryEnabled && (patterns.length > 500 || patterns.some((pattern) => pattern.length > 30))) {
        return { ok: false, message: "Local delivery supports up to 500 postal patterns of 30 characters each." } satisfies ActionData;
      }
      if (localDeliveryEnabled && localDeliveryCountry && !COUNTRY_CODES.has(localDeliveryCountry)) {
        return { ok: false, message: "Choose a valid local delivery country." } satisfies ActionData;
      }
      if (localDeliveryEnabled && localDeliveryCoverageMode !== "postal" && localDeliveryCoverageMode !== "zone") {
        return { ok: false, message: "Choose postal patterns or delivery zones for local delivery coverage." } satisfies ActionData;
      }
      if (localDeliveryEnabled && localDeliveryCoverageMode === "postal" && (!localDeliveryCountry || !patterns.length)) {
        return { ok: false, message: "Choose a local delivery country and add at least one postal code or pattern." } satisfies ActionData;
      }
      if (localDeliveryEnabled && localDeliveryCoverageMode === "postal" && localDeliveryCountry && patterns.some((pattern) => !validatePostalPattern(localDeliveryCountry, pattern))) {
        return { ok: false, message: `A postal pattern is invalid for ${localDeliveryCountry}. Check the codes, ranges or wildcards.` } satisfies ActionData;
      }
      if (localDeliveryEnabled && (localDeliveryZoneIds.length > 100 || localDeliveryZoneIds.some((id) => !/^\d+$/.test(id)))) {
        return { ok: false, message: "Choose valid delivery zones." } satisfies ActionData;
      }
      if (localDeliveryEnabled && localDeliveryCoverageMode === "zone") {
        if (!localDeliveryZoneIds.length) return { ok: false, message: "Choose at least one delivery zone." } satisfies ActionData;
        const ownedZones = await prisma.zone.count({ where: { shop: session.shop, enabled: true, id: { in: localDeliveryZoneIds.map(Number) } } });
        if (ownedZones !== localDeliveryZoneIds.length) return { ok: false, message: "One or more delivery zones are unavailable. Refresh and choose again." } satisfies ActionData;
      }
      const nextEnabled = baseEnabled || localDeliveryEnabled || basePickupEnabled;
      let location: ShopifyLocation | null = null;
      try {
        const response = await admin.graphql(`#graphql
          query VerifyDeliveryLocation($id: ID!) {
            location(id: $id) { id name isActive fulfillsOnlineOrders }
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
      await prisma.fulfillmentLocationRule.upsert({
        where: { shop_shopifyLocationId: { shop: session.shop, shopifyLocationId } },
        create: {
          shop: session.shop,
          shopifyLocationId,
          name: location.name,
          enabled: nextEnabled,
          priority: existingRule?.priority ?? 100,
          processingDays: existingRule?.processingDays ?? null,
          transitDays: existingRule?.transitDays ?? null,
          localDeliveryEnabled,
           ...(localDeliveryEnabled ? {
             localDeliveryCountry,
             localDeliveryPostalCodesCsv: [...new Set(patterns)].join(","),
             localDeliveryCoverageMode,
             localDeliveryZoneIdsCsv: localDeliveryZoneIds.join(","),
             localDeliveryTargetMode,
             localDeliveryTargetValuesCsv: [...new Set(localDeliveryTargetValues)].join(","),
           } : {}),
        },
        update: {
          name: location.name,
          enabled: nextEnabled,
          localDeliveryEnabled,
           ...(localDeliveryEnabled ? {
             localDeliveryCountry,
             localDeliveryPostalCodesCsv: [...new Set(patterns)].join(","),
             localDeliveryCoverageMode,
             localDeliveryZoneIdsCsv: localDeliveryZoneIds.join(","),
             localDeliveryTargetMode,
             localDeliveryTargetValuesCsv: [...new Set(localDeliveryTargetValues)].join(","),
           } : {}),
        },
      });
      clearDeliveryCheckCaches(session.shop);
      return {
        ok: true,
        message: `${location.name} local delivery saved.`,
        saved: {
          locationId: shopifyLocationId,
          section: "delivery",
          values: {
            enabled: nextEnabled,
            localDeliveryEnabled,
            ...(localDeliveryEnabled ? {
              localDeliveryCountry,
             localDeliveryPostalCodesCsv: [...new Set(patterns)].join(","),
             localDeliveryCoverageMode,
             localDeliveryZoneIdsCsv: localDeliveryZoneIds.join(","),
             localDeliveryTargetMode,
             localDeliveryTargetValuesCsv: [...new Set(localDeliveryTargetValues)].join(","),
           } : {}),
          },
        },
      } satisfies ActionData;
    }

    if (section === "pickup") {
      if (pickupEnabled) {
        const targetError = await validateServiceTarget(admin, session.shop, pickupTargetMode, pickupTargetValues);
        if (targetError) return { ok: false, message: targetError } satisfies ActionData;
      }
      if (pickupEnabled && pickupInstructions.length > 500) {
        return { ok: false, message: "Pickup instructions must be 500 characters or fewer." } satisfies ActionData;
      }
      if (pickupEnabled && pickupPhone.length > 50) {
        return { ok: false, message: "Pickup phone must be 50 characters or fewer." } satisfies ActionData;
      }
      if (pickupEnabled && (!/^\d+$/.test(pickupPreparationRaw) || !Number.isInteger(pickupPreparationDays) || pickupPreparationDays < 0 || pickupPreparationDays > 60)) {
        return { ok: false, message: "Pickup preparation days must be an integer from 0 to 60." } satisfies ActionData;
      }
      if (pickupEnabled && (!/^\d+$/.test(pickupAdvanceRaw) || !Number.isInteger(pickupAdvanceDays) || pickupAdvanceDays < 1 || pickupAdvanceDays > 90 || pickupAdvanceDays < pickupPreparationDays)) {
        return { ok: false, message: "Pickup advance horizon must be an integer from 1 to 90 and at least the preparation days." } satisfies ActionData;
      }
      if (pickupEnabled && (pickupWeekdaysRaw.length > 13 || pickupWeekdays.some((day) => !/^[0-6]$/.test(day)) || !pickupWeekdays.length)) {
        return { ok: false, message: "Choose valid pickup weekdays, with at least one day when pickup is enabled." } satisfies ActionData;
      }
      if (pickupEnabled && (pickupBlockedDatesRaw.length > 4000 || pickupBlockedDates.length > 365 || pickupBlockedDates.some((date) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return true;
        const parsed = new Date(`${date}T00:00:00.000Z`);
        return !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date;
      }))) {
        return { ok: false, message: "Blocked pickup dates must be real YYYY-MM-DD dates (up to 365 dates and 4000 characters)." } satisfies ActionData;
      }
      const nextEnabled = baseEnabled || baseDeliveryEnabled || pickupEnabled;
      let location: ShopifyLocation | null = null;
      try {
        const response = await admin.graphql(`#graphql
          query VerifyDeliveryLocation($id: ID!) {
            location(id: $id) { id name isActive fulfillsOnlineOrders }
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
      await prisma.fulfillmentLocationRule.upsert({
        where: { shop_shopifyLocationId: { shop: session.shop, shopifyLocationId } },
        create: {
          shop: session.shop,
          shopifyLocationId,
          name: location.name,
          enabled: nextEnabled,
          priority: existingRule?.priority ?? 100,
          processingDays: existingRule?.processingDays ?? null,
          transitDays: existingRule?.transitDays ?? null,
          pickupEnabled,
           ...(pickupEnabled ? {
             pickupInstructions,
             pickupPhone,
             pickupPreparationDays,
             pickupWeekdaysCsv: [...new Set(pickupWeekdays)].sort().join(","),
             pickupBlockedDatesCsv: [...new Set(pickupBlockedDates)].sort().join(","),
             pickupAdvanceDays,
             pickupTargetMode,
             pickupTargetValuesCsv: [...new Set(pickupTargetValues)].join(","),
           } : {}),
        },
        update: {
          name: location.name,
          enabled: nextEnabled,
          pickupEnabled,
           ...(pickupEnabled ? {
             pickupInstructions,
             pickupPhone,
             pickupPreparationDays,
             pickupWeekdaysCsv: [...new Set(pickupWeekdays)].sort().join(","),
             pickupBlockedDatesCsv: [...new Set(pickupBlockedDates)].sort().join(","),
             pickupAdvanceDays,
             pickupTargetMode,
             pickupTargetValuesCsv: [...new Set(pickupTargetValues)].join(","),
           } : {}),
        },
      });
      clearDeliveryCheckCaches(session.shop);
      return {
        ok: true,
        message: `${location.name} pickup saved.`,
        saved: {
          locationId: shopifyLocationId,
          section: "pickup",
          values: {
            enabled: nextEnabled,
            pickupEnabled,
            ...(pickupEnabled ? {
              pickupInstructions,
              pickupPhone,
              pickupPreparationDays: String(pickupPreparationDays),
             pickupWeekdaysCsv: [...new Set(pickupWeekdays)].sort().join(","),
             pickupBlockedDatesCsv: [...new Set(pickupBlockedDates)].sort().join(","),
             pickupAdvanceDays: String(pickupAdvanceDays),
             pickupTargetMode,
             pickupTargetValuesCsv: [...new Set(pickupTargetValues)].join(","),
           } : {}),
          },
        },
      } satisfies ActionData;
    }

    if (section === "targeting") {
      const targetError = await validateServiceTarget(admin, session.shop, serviceTargetMode, serviceTargetValues);
      if (targetError) return { ok: false, message: targetError } satisfies ActionData;
      let location: ShopifyLocation | null = null;
      try {
        const response = await admin.graphql(`#graphql
          query VerifyDeliveryLocation($id: ID!) {
            location(id: $id) { id name isActive fulfillsOnlineOrders }
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
      await prisma.fulfillmentLocationRule.upsert({
        where: { shop_shopifyLocationId: { shop: session.shop, shopifyLocationId } },
        create: {
          shop: session.shop,
          shopifyLocationId,
          name: location.name,
          enabled: baseEnabled || basePickupEnabled || baseDeliveryEnabled,
           priority: existingRule?.priority ?? 100,
           processingDays: existingRule?.processingDays ?? null,
           transitDays: existingRule?.transitDays ?? null,
           localDeliveryTargetMode: serviceTargetMode,
           localDeliveryTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
           pickupTargetMode: serviceTargetMode,
           pickupTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
           serviceTargetMode,
           serviceTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
        },
        update: {
          name: location.name,
          localDeliveryTargetMode: serviceTargetMode,
          localDeliveryTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
          pickupTargetMode: serviceTargetMode,
          pickupTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
          serviceTargetMode,
          serviceTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
        },
      });
      clearDeliveryCheckCaches(session.shop);
      return {
        ok: true,
        message: `${location.name} targeting saved.`,
        saved: {
          locationId: shopifyLocationId,
          section: "targeting",
          values: {
            localDeliveryTargetMode: serviceTargetMode,
            localDeliveryTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
            pickupTargetMode: serviceTargetMode,
            pickupTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
          },
        },
      } satisfies ActionData;
    }
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
  const localTargetError = await validateServiceTarget(admin, session.shop, localDeliveryTargetMode, localDeliveryTargetValues);
  if (localTargetError) return { ok: false, message: localTargetError } satisfies ActionData;
  const pickupTargetError = await validateServiceTarget(admin, session.shop, pickupTargetMode, pickupTargetValues);
  if (pickupTargetError) return { ok: false, message: pickupTargetError } satisfies ActionData;

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
      localDeliveryTargetMode,
      localDeliveryTargetValuesCsv: [...new Set(localDeliveryTargetValues)].join(","),
      pickupTargetMode,
      pickupTargetValuesCsv: [...new Set(pickupTargetValues)].join(","),
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
      localDeliveryTargetMode,
      localDeliveryTargetValuesCsv: [...new Set(localDeliveryTargetValues)].join(","),
      pickupTargetMode,
      pickupTargetValuesCsv: [...new Set(pickupTargetValues)].join(","),
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
              <Text as="p" tone="subdued">Recent Shopify orders that contain an ETADeliverPickup selection. Customer data is read live and is not copied into the app database.</Text>
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

function DeliveryOrdersPanel({ orders, error, orderAccessGranted, shop, shopHandle }: {
  orders: DeliveryOrder[];
  error: string;
  orderAccessGranted: boolean;
  shop: string;
  shopHandle: string;
}) {
  const formatTimestamp = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return (
    <BlockStack gap="400">
      {!orderAccessGranted ? (
        <Banner tone="warning" title="Order access required" action={{ content: "Reauthorize app", url: `/auth?shop=${encodeURIComponent(shop)}` }}>{error}</Banner>
      ) : error ? <Banner tone="warning" title="Some order details are unavailable">{error}</Banner> : null}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">Delivery customer details</Text>
              <Text as="p" tone="subdued">Local-delivery selections from recent Shopify orders. Customer data is read live and is not copied into the app database.</Text>
            </BlockStack>
            <Button url="/app/locations?view=deliveries">Refresh orders</Button>
          </InlineStack>
          {orderAccessGranted ? <Text as="p" tone="subdued" variant="bodySm">Showing local-delivery selections found in the latest 100 Shopify orders.</Text> : null}
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
                <div><small>Delivery</small><strong>{order.deliveryDate || "Date unavailable"}</strong><span>ZIP/PIN: {order.postalCode || "Unavailable"}</span></div>
                <div><small>Address</small><strong>{order.address || "Protected address unavailable"}</strong><span>Available only when Shopify grants protected customer data access.</span></div>
              </div>
            </BlockStack>
          </Card>;
        })}
      </div> : orderAccessGranted && !error ? (
        <Card><BlockStack gap="200"><Text as="h2" variant="headingMd">No delivery orders yet</Text><Text as="p" tone="subdued">Orders appear here after a customer selects Local delivery, enters their details, and completes checkout.</Text></BlockStack></Card>
      ) : null}
    </BlockStack>
  );
}

export default function LocationsPage() {
  const { view, access, apiKey, shop, locations, selectedLocationId, targetSuggestions, targetRuleCount, priorityMode, locationError, catalogError, orderAccessGranted, pickupOrders, pickupOrdersError, deliveryOrders, deliveryOrdersError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isAdvanced = access.features.inventory;
  const shopHandle = shop.replace(/\.myshopify\.com$/i, "");
  const shopifyLocationsUrl = `https://admin.shopify.com/store/${shopHandle}/settings/locations`;
  const [forms, setForms] = useState<Record<string, LocationForm>>(() => Object.fromEntries(locations.map((location) => [location.id, locationForm(location)])));
  const [persistedForms, setPersistedForms] = useState<Record<string, LocationForm>>(() => Object.fromEntries(locations.map((location) => [location.id, locationForm(location)])));
  const [locationSearch, setLocationSearch] = useState("");
  const [selectedPriorityMode, setSelectedPriorityMode] = useState(priorityMode);
  const [persistedPriorityMode, setPersistedPriorityMode] = useState(priorityMode);
  const [activeSave, setActiveSave] = useState("");
  const [lastSaved, setLastSaved] = useState<{ id: string; section: string; at: number } | null>(null);
  const submittedLocation = useRef<{ id: string; section: string } | null>(null);
  const isSaving = (key: string) => fetcher.state !== "idle" && activeSave === key;
  useEffect(() => {
    if (fetcher.state === "idle") setActiveSave("");
    else setLastSaved(null);
  }, [fetcher.state]);
  useEffect(() => {
    if (!fetcher.formData) return;
    const intent = String(fetcher.formData.get("intent") ?? "");
    const id = String(fetcher.formData.get("shopifyLocationId") ?? "");
    if (id) submittedLocation.current = { id, section: intent === "enable_pickup" ? intent : String(fetcher.formData.get("section") ?? "all") };
  }, [fetcher.formData]);
  useEffect(() => {
    const saved = fetcher.state === "idle" && fetcher.data?.ok ? submittedLocation.current : null;
    const savedData = fetcher.data?.saved;
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.savedPriorityMode) {
      setPersistedPriorityMode(fetcher.data.savedPriorityMode);
    }
    if (saved && savedData?.locationId === saved.id && savedData.section === saved.section) {
      setLastSaved({ ...saved, at: Date.now() });
      setPersistedForms((current) => ({
        ...current,
        [saved.id]: { ...(current[saved.id] ?? locationForm(locations.find((location) => location.id === saved.id)!)), ...savedData.values },
      }));
    }
    setForms((current) => Object.fromEntries(locations.map((location) => {
      const existing = current[location.id];
      const fresh = locationForm(location);
      if (!existing) return [location.id, fresh];
      if (!saved || saved.id !== location.id) return [location.id, existing];
       if (savedData?.locationId === location.id && savedData.section === saved.section) {
         return [location.id, { ...existing, ...savedData.values }];
      }
      return [location.id, existing];
    })));
    if (saved) submittedLocation.current = null;
  }, [fetcher.data, fetcher.state, locations]);
  const isSectionSaved = (section: string, locationId = selectedLocationId) => lastSaved?.id === locationId && lastSaved.section === section;
  const savedLabel = (section: string, locationId = selectedLocationId) => isSectionSaved(section, locationId) ? <span className="incode-save-state" role="status">Saved just now</span> : null;
  const sectionDirty = (location: LocationRow, section: string) => {
    const form = forms[location.id];
    const saved = persistedForms[location.id] ?? locationForm(location);
    if (!form) return false;
    if (section === "status") return form.enabled !== saved.enabled;
    if (section === "routing") return form.priority !== saved.priority || form.processingDays !== saved.processingDays || form.transitDays !== saved.transitDays;
    if (section === "delivery") return form.localDeliveryEnabled !== saved.localDeliveryEnabled
      || form.localDeliveryCountry !== saved.localDeliveryCountry
       || form.localDeliveryPostalCodesCsv !== saved.localDeliveryPostalCodesCsv
       || form.localDeliveryCoverageMode !== saved.localDeliveryCoverageMode
       || form.localDeliveryZoneIdsCsv !== saved.localDeliveryZoneIdsCsv
       || form.localDeliveryTargetMode !== saved.localDeliveryTargetMode
       || form.localDeliveryTargetValuesCsv !== saved.localDeliveryTargetValuesCsv;
    if (section === "pickup") return form.pickupEnabled !== saved.pickupEnabled
      || form.pickupInstructions !== saved.pickupInstructions
      || form.pickupPhone !== saved.pickupPhone
      || form.pickupPreparationDays !== saved.pickupPreparationDays
       || form.pickupWeekdaysCsv !== saved.pickupWeekdaysCsv
       || form.pickupBlockedDatesCsv !== saved.pickupBlockedDatesCsv
       || form.pickupAdvanceDays !== saved.pickupAdvanceDays
       || form.pickupTargetMode !== saved.pickupTargetMode
       || form.pickupTargetValuesCsv !== saved.pickupTargetValuesCsv;
    return false;
  };
  const saveButtonLabel = (location: LocationRow, section: string, label: string) => sectionDirty(location, section) ? label : "Already saved";
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
   const dirty = selectedPriorityMode !== persistedPriorityMode || locations.some((location) => {
    const form = forms[location.id];
    const rule = location.rule;
    return form.enabled !== (rule?.enabled ?? location.isActive) || form.priority !== String(rule?.priority ?? 100)
      || form.processingDays !== String(rule?.processingDays ?? "") || form.transitDays !== String(rule?.transitDays ?? "")
        || form.localDeliveryEnabled !== (rule?.localDeliveryEnabled ?? false) || form.localDeliveryPostalCodesCsv !== (rule?.localDeliveryPostalCodesCsv ?? "")
       || form.localDeliveryCountry !== (rule?.localDeliveryCountry || location.address?.countryCode || "")
       || form.localDeliveryCoverageMode !== (rule?.localDeliveryCoverageMode === "zone" ? "zone" : "postal") || form.localDeliveryZoneIdsCsv !== (rule?.localDeliveryZoneIdsCsv ?? "")
       || form.localDeliveryTargetMode !== (rule?.localDeliveryTargetMode ?? rule?.serviceTargetMode ?? "all")
       || form.localDeliveryTargetValuesCsv !== (rule?.localDeliveryTargetValuesCsv ?? rule?.serviceTargetValuesCsv ?? "")
       || form.pickupEnabled !== (rule?.pickupEnabled ?? false) || form.pickupInstructions !== (rule?.pickupInstructions ?? "")
       || form.pickupPhone !== (rule?.pickupPhone ?? "") || form.pickupPreparationDays !== String(rule?.pickupPreparationDays ?? 0)
       || form.pickupWeekdaysCsv !== (rule?.pickupWeekdaysCsv ?? "0,1,2,3,4,5,6") || form.pickupBlockedDatesCsv !== (rule?.pickupBlockedDatesCsv ?? "")
       || form.pickupAdvanceDays !== String(rule?.pickupAdvanceDays ?? 30)
       || form.pickupTargetMode !== (rule?.pickupTargetMode ?? rule?.serviceTargetMode ?? "all")
       || form.pickupTargetValuesCsv !== (rule?.pickupTargetValuesCsv ?? rule?.serviceTargetValuesCsv ?? "");
  });
  useBeforeUnload((event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  useBlocker(() => dirty && !window.confirm("Leave with unsaved location changes?"));
  const blockEditorUrl = (template: "cart" | "product") => `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=${template}&addAppBlockId=${apiKey}/delivery-service-options&target=mainSection`;
  const selectedLocation = locations.find((location) => location.id === selectedLocationId) ?? null;
  const locationUrl = (locationId: string) => `/app/locations?location=${encodeURIComponent(locationId)}#location-workspace`;
  const visibleLocations = locations.filter((location) => {
    const query = locationSearch.trim().toLowerCase();
    if (!query) return true;
    return [location.name, location.address?.address1, location.address?.address2, location.address?.city, location.address?.province, location.address?.zip, location.address?.country]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  return (
      <Page
      title="Delivery & pickup"
      subtitle="Connect the storefront, choose a location, and turn on its services."
      titleMetadata={<Badge tone={isAdvanced ? "success" : "info"}>{isAdvanced ? "Standard" : "Subscription required"}</Badge>}
    >
      <BlockStack gap="400">
        <div className="incode-location-tabs" role="navigation" aria-label="Delivery and pickup views">
          <Button url="/app/locations" variant={view === "setup" ? "primary" : "tertiary"}>Service setup</Button>
          <Button url="/app/locations?view=deliveries" variant={view === "deliveries" ? "primary" : "tertiary"}>Delivery orders</Button>
          <Button url="/app/locations?view=pickups" variant={view === "pickups" ? "primary" : "tertiary"}>Pickup orders</Button>
        </div>
        {view === "deliveries" ? (
          <DeliveryOrdersPanel orders={deliveryOrders} error={deliveryOrdersError} orderAccessGranted={orderAccessGranted} shop={shop} shopHandle={shopHandle} />
        ) : view === "pickups" ? (
          <PickupOrdersPanel orders={pickupOrders} error={pickupOrdersError} orderAccessGranted={orderAccessGranted} shop={shop} shopHandle={shopHandle} />
        ) : <BlockStack gap="400">
        <Card>
          <div className="incode-setup-rail" aria-label="Setup steps">
            <section>
              <span>1</span>
              <div><strong>Set Shipping coverage</strong><small>Exact PINs, ranges, or zones.</small></div>
              <Button url="/app/delivery-settings?tab=coverage" size="slim">Open coverage</Button>
            </section>
            <section>
              <span>2</span>
              <div><strong>Set Product rules</strong><small>{targetRuleCount ? `${targetRuleCount} active` : "Optional exceptions"}</small></div>
              <Button url="/app/service-rules" size="slim">Manage rules</Button>
            </section>
            <section>
              <span>3</span>
              <div><strong>Configure locations</strong><small>{`${locations.length} synced from Shopify`}</small></div>
              <Button url={shopifyLocationsUrl} external target="_blank" size="slim">Add location</Button>
            </section>
          </div>
        </Card>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">Storefront setup</Text>
                <Text as="p" tone="subdued" variant="bodySm">Add the service selector to both templates. Shopify requires one app block on Product and one on Cart.</Text>
              </BlockStack>
              <InlineStack gap="200" wrap>
                <Button url={blockEditorUrl("product")} external target="_blank" variant="primary" size="slim">Add to Product</Button>
                <Button url={blockEditorUrl("cart")} external target="_blank" size="slim">Add to Cart</Button>
              </InlineStack>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">Use the <strong>Delivery & pickup tabs</strong> layout, then save and publish the theme. The block is not an app embed.</Text>
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
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
              <BlockStack gap="050"><Text as="h2" variant="headingLg">Locations</Text><Text as="p" tone="subdued" variant="bodySm">Choose one to configure.</Text></BlockStack>
              <InlineStack gap="200"><Button url="/app/locations" size="slim">Refresh</Button><Button url={shopifyLocationsUrl} external target="_blank" size="slim">Add in Shopify</Button></InlineStack>
            </InlineStack>
            {locations.length > 1 ? <TextField label="Search locations" labelHidden value={locationSearch} onChange={setLocationSearch} clearButton onClearButtonClick={() => setLocationSearch("")} autoComplete="off" placeholder={`Search ${locations.length} locations`} /> : null}
            {visibleLocations.length ? <div className="incode-pickup-directory">
              {visibleLocations.map((location) => {
                const form = forms[location.id];
                const ready = location.isActive && location.fulfillsOnlineOrders && form.enabled;
                const shortAddress = [location.address?.city, location.address?.provinceCode, location.address?.countryCode].filter(Boolean).join(", ");
                return <div key={location.id} className={`incode-pickup-directory__item${selectedLocationId === location.id ? " is-selected" : ""}`}>
                  <span className="incode-pickup-directory__pin" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 22s7-6.1 7-13a7 7 0 1 0-14 0c0 6.9 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/></svg></span>
                  <span><strong>{location.name}</strong><small>{shortAddress || "Address needed in Shopify"}</small></span>
                  <span className={`incode-pickup-directory__state ${ready ? "is-ready" : ""}`}>{ready ? form.pickupEnabled ? "Pickup on" : form.localDeliveryEnabled ? "Delivery on" : "Ready" : "Needs setup"}</span>
                  <span className="incode-pickup-directory__actions">
                     {!form.pickupEnabled ? <fetcher.Form method="post" onSubmit={() => setActiveSave(`enable-pickup:${location.id}`)}><input type="hidden" name="intent" value="enable_pickup"/><input type="hidden" name="shopifyLocationId" value={location.id}/><Button submit size="slim" variant="primary" disabled={!isAdvanced || fetcher.state !== "idle"} loading={isSaving(`enable-pickup:${location.id}`)}>Enable pickup</Button></fetcher.Form> : null}
                    <Button size="slim" url={locationUrl(location.id)} variant={selectedLocationId === location.id ? "primary" : "secondary"}>{selectedLocationId === location.id ? "Selected" : "Configure"}</Button>
                  </span>
                </div>;
              })}
            </div> : locations.length ? <Text as="p" tone="subdued">No matching locations.</Text> : <Banner tone="warning" title="No Shopify locations found">Add a Shopify location, assign inventory, then refresh.</Banner>}
          </BlockStack>
        </Card>
        {catalogError ? <Banner tone="warning" title="Product choices unavailable">{catalogError} Refresh before editing the audience.</Banner> : null}
        {locations.filter((location) => location.id === selectedLocationId).map((location) => {
          const form = forms[location.id];
          const address = [location.address?.address1, location.address?.address2, location.address?.city, location.address?.province || location.address?.provinceCode, location.address?.zip, location.address?.country || location.address?.countryCode]
            .filter(Boolean)
            .join(", ");
          return (
             <div key={location.id} id="location-workspace" className="incode-location-anchor"><Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start" gap="200" wrap>
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">{location.name}</Text>
                      <Text as="p" tone="subdued">{address || "No address configured in Shopify"}</Text>
                    </BlockStack>
                    <InlineStack gap="200" wrap>
                      <Badge tone={location.isActive ? "success" : undefined}>{location.isActive ? "Active" : "Inactive"}</Badge>
                       <Badge tone={location.fulfillsOnlineOrders ? "info" : undefined}>{location.fulfillsOnlineOrders ? "Online fulfillment" : "Not online"}</Badge>
                    </InlineStack>
                   </InlineStack>
                     <fetcher.Form method="post" onSubmit={() => setActiveSave(`status:${location.id}`)}>
                      <input type="hidden" name="intent" value="save_location" />
                      <input type="hidden" name="section" value="status" />
                      <input type="hidden" name="shopifyLocationId" value={location.id} />
                      <input type="hidden" name="enabledState" value={String(form.enabled)} />
                      <div className="incode-location-enable">
                      <Checkbox label="Location enabled for services" name="enabled" checked={form.enabled} disabled={!isAdvanced || form.localDeliveryEnabled || form.pickupEnabled} onChange={(checked) => updateForm(location.id, "enabled", checked)} helpText={form.localDeliveryEnabled || form.pickupEnabled ? "Automatically enabled while delivery or pickup is on." : "Enable this location for routing."} />
                        <div className="incode-status-save">{savedLabel("status", location.id)}<Button submit disabled={!isAdvanced || !sectionDirty(location, "status") || fetcher.state !== "idle"} loading={isSaving(`status:${location.id}`)}>{saveButtonLabel(location, "status", "Save status")}</Button></div>
                     </div>
                   </fetcher.Form>
                   <div className="incode-location-sections">
                     <LocationSettingsSection id="location-section-routing" title="Routing & timing" description="Priority and delivery-day overrides" status={selectedPriorityMode === "manual" ? `Priority ${form.priority}` : "Stock based"}>
                        <fetcher.Form method="post" onSubmit={() => setActiveSave("priority-mode")}>
                          <input type="hidden" name="intent" value="save_priority_mode" />
                          <div className="incode-location-strategy">
                            <div><Text as="h3" variant="headingSm">Location selection</Text><Text as="p" tone="subdued" variant="bodySm">Choose how stocked locations are selected.</Text></div>
                            <Select label="Selection strategy" labelHidden name="priorityMode" value={selectedPriorityMode} disabled={!isAdvanced} onChange={setSelectedPriorityMode} options={[{ label: "Manual priority", value: "manual" }, { label: "Highest available stock", value: "highest_stock" }]} />
                            <Button submit disabled={!isAdvanced || selectedPriorityMode === persistedPriorityMode || fetcher.state !== "idle"} loading={isSaving("priority-mode")}>{selectedPriorityMode === persistedPriorityMode ? "Already saved" : "Save strategy"}</Button>
                          </div>
                        </fetcher.Form>
                        <fetcher.Form method="post" onSubmit={() => setActiveSave(`routing:${location.id}`)}>
                        <input type="hidden" name="intent" value="save_location" />
                        <input type="hidden" name="section" value="routing" />
                        <input type="hidden" name="shopifyLocationId" value={location.id} />
                      <FormLayout>
                      <FormLayout.Group condensed>
                       <TextField label="Priority" name="priority" type="number" min={0} max={9999} value={form.priority} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "priority", value)} autoComplete="off" helpText="Lower priority is selected first." />
                       <TextField label="Processing days override" name="processingDays" type="number" min={0} max={60} value={form.processingDays} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "processingDays", value)} autoComplete="off" />
                       <TextField label="Transit days override" name="transitDays" type="number" min={0} max={60} value={form.transitDays} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "transitDays", value)} autoComplete="off" />
                      </FormLayout.Group>
                         <div className="incode-section-save">{savedLabel("routing")}<Button submit variant="primary" disabled={!isAdvanced || !sectionDirty(location, "routing") || fetcher.state !== "idle"} loading={isSaving(`routing:${location.id}`)}>{saveButtonLabel(location, "routing", "Save routing")}</Button></div>
                      </FormLayout>
                      </fetcher.Form>
                    </LocationSettingsSection>
                     <LocationSettingsSection id="location-section-delivery" title="Local delivery" description="Zones or postal coverage" status={form.localDeliveryEnabled ? form.localDeliveryCoverageMode === "zone" ? `${form.localDeliveryZoneIdsCsv.split(",").filter(Boolean).length} zones` : "Postal coverage" : "Off"}>
                       <fetcher.Form method="post" onSubmit={() => setActiveSave(`delivery:${location.id}`)}>
                         <input type="hidden" name="intent" value="save_location" />
                         <input type="hidden" name="section" value="delivery" />
                         <input type="hidden" name="shopifyLocationId" value={location.id} />
                         <input type="hidden" name="localDeliveryEnabledState" value={String(form.localDeliveryEnabled)} />
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
                     <ServiceAudienceFields
                       serviceLabel="Local delivery"
                       mode={form.localDeliveryTargetMode}
                       values={form.localDeliveryTargetValuesCsv}
                       modeName="localDeliveryTargetMode"
                       valuesName="localDeliveryTargetValuesCsv"
                       suggestions={targetSuggestions[form.localDeliveryTargetMode as keyof TargetSuggestions] ?? []}
                       disabled={!isAdvanced}
                       onModeChange={(value) => {
                         updateForm(location.id, "localDeliveryTargetMode", value);
                         updateForm(location.id, "localDeliveryTargetValuesCsv", "");
                       }}
                       onValuesChange={(value) => updateForm(location.id, "localDeliveryTargetValuesCsv", value)}
                     />
                     </div>
                      <div className="incode-section-save">{savedLabel("delivery")}<Button submit variant="primary" disabled={!isAdvanced || !sectionDirty(location, "delivery") || fetcher.state !== "idle"} loading={isSaving(`delivery:${location.id}`)}>{saveButtonLabel(location, "delivery", "Save delivery")}</Button></div>
                      </FormLayout>
                      </fetcher.Form>
                    </LocationSettingsSection>
                     <LocationSettingsSection id="location-section-pickup" title="Store pickup" description="Schedule and customer instructions" status={form.pickupEnabled ? "Enabled" : "Off"}>
                       <fetcher.Form method="post" onSubmit={() => setActiveSave(`pickup:${location.id}`)}>
                         <input type="hidden" name="intent" value="save_location" />
                         <input type="hidden" name="section" value="pickup" />
                         <input type="hidden" name="shopifyLocationId" value={location.id} />
                         <input type="hidden" name="pickupEnabledState" value={String(form.pickupEnabled)} />
                       <FormLayout>
                     <Checkbox label="Offer in-store pickup from this location" name="pickupEnabled" checked={form.pickupEnabled} disabled={!isAdvanced} onChange={(checked) => updateForm(location.id, "pickupEnabled", checked)} />
                    {!location.isActive || !location.fulfillsOnlineOrders ? <Banner tone="warning" title="Shopify setup required">Activate this location and online fulfillment in Shopify before offering pickup.</Banner> : null}
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
                     <ServiceAudienceFields
                       serviceLabel="Store pickup"
                       mode={form.pickupTargetMode}
                       values={form.pickupTargetValuesCsv}
                       modeName="pickupTargetMode"
                       valuesName="pickupTargetValuesCsv"
                       suggestions={targetSuggestions[form.pickupTargetMode as keyof TargetSuggestions] ?? []}
                       disabled={!isAdvanced}
                       onModeChange={(value) => {
                         updateForm(location.id, "pickupTargetMode", value);
                         updateForm(location.id, "pickupTargetValuesCsv", "");
                       }}
                       onValuesChange={(value) => updateForm(location.id, "pickupTargetValuesCsv", value)}
                     />
                     </div>
                      <div className="incode-section-save">{savedLabel("pickup")}<Button submit variant="primary" disabled={!isAdvanced || !sectionDirty(location, "pickup") || fetcher.state !== "idle"} loading={isSaving(`pickup:${location.id}`)}>{saveButtonLabel(location, "pickup", "Save pickup")}</Button></div>
                      </FormLayout>
                      </fetcher.Form>
                     </LocationSettingsSection>
                  </div>
                </BlockStack>
            </Card></div>
          );
        })}
         {!selectedLocation && locations.length ? <div className="incode-location-empty"><strong>Select a location above</strong><span>Its delivery, pickup, routing, and service audience settings will appear here.</span></div> : null}
        </BlockStack>}
      </BlockStack>
    </Page>
  );
}
