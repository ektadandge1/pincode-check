import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
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
  Layout,
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
    city?: string | null;
    provinceCode?: string | null;
    zip?: string | null;
    countryCode?: string | null;
  } | null;
};

type ActionData = { ok: boolean; message: string; previewKey?: string; postalCode?: string; localDelivery?: boolean };

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
  pickupEnabled: boolean;
  pickupInstructions: string;
  serviceTargetMode: string;
  serviceTargetValuesCsv: string;
};

type TargetSuggestions = Record<"product" | "collection" | "tag" | "zone", Array<{ label: string; value: string }>>;

const SERVICE_TARGET_OPTIONS = [
  { label: "All products and customers", value: "all" },
  { label: "Only selected products", value: "product" },
  { label: "Only products in selected collections", value: "collection" },
  { label: "Only products with selected tags", value: "tag" },
  { label: "Only selected delivery zones", value: "zone" },
];

function ServiceTargetPicker({ options, label, value, disabled, onChange }: {
  options: Array<{ label: string; value: string }>;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
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
      <input type="hidden" name="serviceTargetValuesCsv" value={value} />
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
              city
              provinceCode
              zip
              countryCode
            }
           }
         }
          products(first: 250) { nodes { id title tags } pageInfo { hasNextPage endCursor } }
          collections(first: 250) { nodes { handle title } pageInfo { hasNextPage endCursor } }
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
  return {
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
  if (intent !== "save_location" && intent !== "save_priority_mode" && intent !== "save_icon_style") {
    return { ok: false, message: "Unsupported action." } satisfies ActionData;
  }
  if (!access.features.inventory) {
    return { ok: false, message: "Fulfillment location rules require an active Standard subscription." } satisfies ActionData;
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
  const name = String(formData.get("locationName") ?? "").trim();
  const priority = Number(formData.get("priority") ?? 100);
  const processingDays = optionalDays(formData.get("processingDays"));
  const transitDays = optionalDays(formData.get("transitDays"));
  const pickupInstructions = String(formData.get("pickupInstructions") ?? "").trim();
  const localDeliveryCountry = String(formData.get("localDeliveryCountry") ?? "").trim().toUpperCase();
  const serviceTargetMode = String(formData.get("serviceTargetMode") ?? "all");
  const serviceTargetValues = String(formData.get("serviceTargetValuesCsv") ?? "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  const patterns = String(formData.get("localDeliveryPostalCodesCsv") ?? "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!/^gid:\/\/shopify\/Location\/\d+$/.test(shopifyLocationId) || !name || name.length > 255) {
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
  if (parseBool(formData.get("localDeliveryEnabled")) && (!localDeliveryCountry || !patterns.length)) {
    return { ok: false, message: "Choose a local delivery country and add at least one postal code or pattern." } satisfies ActionData;
  }
  if (localDeliveryCountry && patterns.some((pattern) => !validatePostalPattern(localDeliveryCountry, pattern))) {
    return { ok: false, message: `A postal pattern is invalid for ${localDeliveryCountry}. Check the codes, ranges or wildcards.` } satisfies ActionData;
  }
  if (pickupInstructions.length > 500) {
    return { ok: false, message: "Pickup instructions must be 500 characters or fewer." } satisfies ActionData;
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

  await prisma.fulfillmentLocationRule.upsert({
    where: { shop_shopifyLocationId: { shop: session.shop, shopifyLocationId } },
    create: {
      shop: session.shop,
      shopifyLocationId,
      name,
      enabled: parseBool(formData.get("enabled")),
      priority,
      processingDays,
      transitDays,
      localDeliveryEnabled: parseBool(formData.get("localDeliveryEnabled")),
      localDeliveryCountry,
      localDeliveryPostalCodesCsv: [...new Set(patterns)].join(","),
      pickupEnabled: parseBool(formData.get("pickupEnabled")),
      pickupInstructions,
      serviceTargetMode,
      serviceTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
    },
    update: {
      name,
      enabled: parseBool(formData.get("enabled")),
      priority,
      processingDays,
      transitDays,
      localDeliveryEnabled: parseBool(formData.get("localDeliveryEnabled")),
      localDeliveryCountry,
      localDeliveryPostalCodesCsv: [...new Set(patterns)].join(","),
      pickupEnabled: parseBool(formData.get("pickupEnabled")),
      pickupInstructions,
      serviceTargetMode,
      serviceTargetValuesCsv: [...new Set(serviceTargetValues)].join(","),
    },
  });
  clearDeliveryCheckCaches(session.shop);
  return { ok: true, message: `${name} saved.` } satisfies ActionData;
}

function ServiceIcon({ kind, style }: { kind: "local" | "pickup"; style: string }) {
  if (style === "number") return <span aria-hidden="true">&#10003;</span>;
  if (style === "emoji") return <span aria-hidden="true">{kind === "local" ? "🚚" : "🏪"}</span>;
  if (style === "minimal") return <span className="incode-service-icon__dot" aria-hidden="true" />;
  if (style === "circle") return <span className="incode-service-icon__circle" aria-hidden="true">✓</span>;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {kind === "local" ? (
        <><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>
      ) : (
        <><path d="M3 10 12 3l9 7v10H3z" /><path d="M8 21v-6h8v6M7 10h10" /></>
      )}
    </svg>
  );
}

function StorefrontLocationPreview({
  location,
  form,
  routingEnabled,
  iconStyle,
  serviceIconColor,
  serviceBackground,
  serviceEffect,
  shop,
  apiKey,
}: {
  location: LocationRow;
  form: LocationForm;
  routingEnabled: boolean;
  iconStyle: string;
  serviceIconColor: string;
  serviceBackground: string;
  serviceEffect: string;
  shop: string;
  apiKey: string;
}) {
  const [resultView, setResultView] = useState("initial");
  const shopHandle = shop.replace(/\.myshopify\.com$/i, "");
  const themeEditorUrl = (template: "product" | "cart" | "page", blockHandle: string) =>
    `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=${template}&addAppBlockId=${apiKey}/${blockHandle}&target=mainSection`;
  const checked = resultView !== "initial";
  const eligible = routingEnabled && resultView === "available";
  const style = { "--service-icon-color": serviceIconColor, "--service-background": serviceBackground } as React.CSSProperties;
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">Storefront preview</Text>
          <Badge tone="info">Sample</Badge>
        </InlineStack>
        <Select label="Preview state" value={resultView} onChange={setResultView} options={[
          { label: "Before ZIP check", value: "initial" },
          { label: "Available result (sample)", value: "available" },
          { label: "Unavailable result (sample)", value: "unavailable" },
        ]} />
        {!routingEnabled ? <Text as="p" tone="caution" variant="bodySm">Enable an active online location to offer these services.</Text> : null}
        <div className="incode-local-preview" style={style}>
          <div className="incode-local-preview__intro">
            <span className="incode-local-preview__mark"><ServiceIcon kind="local" style="delivery" /></span>
            <div>
              <strong>Check delivery options</strong>
              <p>Enter your ZIP to check delivery & pickup.</p>
            </div>
          </div>
          <div className="incode-local-preview__form" aria-label="Illustrative ZIP input">
            <span>{location.address?.countryCode || "Country"}</span>
            <span>{checked ? "Example ZIP" : "Enter PIN / ZIP code"}</span>
            <button type="button" onClick={() => setResultView(checked ? "initial" : "available")}>{checked ? "Change ZIP" : "Check availability"}</button>
          </div>
          {checked ? <div className={`incode-local-preview__result ${eligible ? "is-available" : "is-unavailable"}`}><span>Example result</span><strong>{eligible ? "Delivery available" : "Not available"}</strong></div> : null}
          <div className="incode-local-preview__options">
            {([
              ["local", "Local delivery", form.localDeliveryEnabled],
              ["pickup", "Store pickup", form.pickupEnabled],
            ] as const).map(([kind, title, enabled]) => {
              const available = eligible && enabled && (kind !== "local" || Boolean(form.localDeliveryPostalCodesCsv.trim()));
              const state = !enabled ? "is-disabled" : !checked ? "is-pending" : available ? "is-available" : "is-unavailable";
              return <div key={kind} className={`${state} incode-service-option--${serviceEffect}`}>
                <span className="incode-local-preview__icon"><ServiceIcon kind={kind} style={iconStyle} /></span>
                <strong>{title}</strong>
                <span className="incode-local-preview__status">{!enabled ? "Not offered" : !checked ? "Check ZIP" : available ? "Available" : "Not available"}</span>
              </div>;
            })}
          </div>
          {eligible && form.pickupEnabled && form.pickupInstructions.trim() ? <p className="incode-local-preview__instructions">{form.pickupInstructions}</p> : null}
          <div className="incode-local-preview__meta">
            <span>{location.name}</span>
            <span>{form.serviceTargetMode === "all" ? "All products" : `${form.serviceTargetValuesCsv.split(",").filter((value) => value.trim()).length} selected ${form.serviceTargetMode === "product" ? "products" : form.serviceTargetMode === "collection" ? "collections" : form.serviceTargetMode === "zone" ? "zones" : "tags"}`}</span>
          </div>
        </div>
        <Text as="p" tone="subdued" variant="bodySm">Design sample only. Live results use ZIP, targeting and stock.</Text>
        <InlineStack gap="200" wrap>
            <Button url={themeEditorUrl("product", "delivery-service-options")} target="_blank" variant="primary">Add to product page</Button>
            <Button url={themeEditorUrl("cart", "delivery-service-options")} target="_blank">Add to cart page</Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

export default function LocationsPage() {
  const { access, apiKey, shop, locations, targetSuggestions, priorityMode, iconStyle, serviceIconColor, serviceBackground, serviceEffect, locationError, inventoryAwareEnabled } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isAdvanced = access.active;
  const [forms, setForms] = useState<Record<string, LocationForm>>(() => Object.fromEntries(locations.map((location) => [location.id, {
    enabled: location.rule?.enabled ?? location.isActive,
    priority: String(location.rule?.priority ?? 100),
    processingDays: location.rule?.processingDays === null || location.rule?.processingDays === undefined ? "" : String(location.rule.processingDays),
    transitDays: location.rule?.transitDays === null || location.rule?.transitDays === undefined ? "" : String(location.rule.transitDays),
    localDeliveryEnabled: location.rule?.localDeliveryEnabled ?? false,
    localDeliveryCountry: location.rule?.localDeliveryCountry || location.address?.countryCode || "",
    localDeliveryPostalCodesCsv: location.rule?.localDeliveryPostalCodesCsv ?? "",
     pickupEnabled: location.rule?.pickupEnabled ?? false,
     pickupInstructions: location.rule?.pickupInstructions ?? "",
     serviceTargetMode: location.rule?.serviceTargetMode ?? "all",
     serviceTargetValuesCsv: location.rule?.serviceTargetValuesCsv ?? "",
  }])));
  const [selectedPriorityMode, setSelectedPriorityMode] = useState(priorityMode);
  const [selectedIconStyle, setSelectedIconStyle] = useState(iconStyle);
  const [selectedServiceIconColor, setSelectedServiceIconColor] = useState(serviceIconColor);
  const [selectedServiceBackground, setSelectedServiceBackground] = useState(serviceBackground);
  const [selectedServiceEffect, setSelectedServiceEffect] = useState(serviceEffect);
  const [appearanceSource, setAppearanceSource] = useState("shop");
  const [themeAppearance, setThemeAppearance] = useState({ iconStyle: "delivery", color: "#1f4f91", background: "#fff8e8", effect: "soft" });
  const [previewLocationId, setPreviewLocationId] = useState(locations[0]?.id ?? "");
  const updateForm = (locationId: string, field: string, value: string | boolean) => {
    setPreviewLocationId(locationId);
    setForms((current) => ({
      ...current,
      [locationId]: { ...current[locationId], [field]: value },
      }));
  };
  const configuredLocations = locations.filter((location) => forms[location.id]?.enabled && location.isActive && location.fulfillsOnlineOrders);
  const previewLocation = locations.find((location) => location.id === previewLocationId) ?? locations[0] ?? null;
  const previewForm = previewLocation ? forms[previewLocation.id] : null;
  const previewRoutingEnabled = Boolean(previewLocation && configuredLocations.some((location) => location.id === previewLocation.id));
  const dirty = selectedPriorityMode !== priorityMode || selectedIconStyle !== iconStyle || selectedServiceIconColor !== serviceIconColor || selectedServiceBackground !== serviceBackground || selectedServiceEffect !== serviceEffect || locations.some((location) => {
    const form = forms[location.id];
    const rule = location.rule;
    return form.enabled !== (rule?.enabled ?? location.isActive) || form.priority !== String(rule?.priority ?? 100)
      || form.processingDays !== String(rule?.processingDays ?? "") || form.transitDays !== String(rule?.transitDays ?? "")
        || form.localDeliveryEnabled !== (rule?.localDeliveryEnabled ?? false) || form.localDeliveryPostalCodesCsv !== (rule?.localDeliveryPostalCodesCsv ?? "")
        || form.localDeliveryCountry !== (rule?.localDeliveryCountry || location.address?.countryCode || "")
       || form.pickupEnabled !== (rule?.pickupEnabled ?? false) || form.pickupInstructions !== (rule?.pickupInstructions ?? "")
       || form.serviceTargetMode !== (rule?.serviceTargetMode ?? "all") || form.serviceTargetValuesCsv !== (rule?.serviceTargetValuesCsv ?? "");
  });
  useBeforeUnload((event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  useBlocker(() => dirty && !window.confirm("Leave with unsaved location changes?"));
  const locationsWithLocalDelivery = locations.filter((location) => forms[location.id]?.localDeliveryEnabled).length;
  const locationsWithPickup = locations.filter((location) => forms[location.id]?.pickupEnabled).length;
  const shopHandle = shop.replace(/\.myshopify\.com$/i, "");
  const availabilityThemeEditorUrl = `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=product&addAppBlockId=${apiKey}/availability-checker&target=mainSection`;

  return (
      <Page
      title="Delivery & pickup"
      subtitle="Set up where you deliver, then configure local delivery and pickup options."
      titleMetadata={<Badge tone={isAdvanced ? "success" : "info"}>{isAdvanced ? "Standard" : "Subscription required"}</Badge>}
    >
      <BlockStack gap="400">
        <Layout>
          <Layout.Section>
        <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="200" wrap>
              <BlockStack gap="100">
                <Text as="h2" variant="headingLg">Customer ZIP availability checker</Text>
                <Text as="p" tone="subdued">This is a separate storefront feature. Customers enter their ZIP or postal code and see Available or Not available. It does not show automatically and it does not include delivery dates.</Text>
              </BlockStack>
              <Badge tone={isAdvanced ? "success" : "attention"}>{isAdvanced ? "Ready to configure" : "Standard required"}</Badge>
            </InlineStack>
            <div className="incode-location-flow" aria-label="ZIP availability setup steps">
              {[
                ["1", "Configure coverage", "Add ZIP codes, ranges, or zones in Delivery control."],
                ["2", "Add the right block", "Use ZIP availability checker, not the ETA or combined options block."],
                ["3", "Shopper enters ZIP", "Nothing is checked until the customer presses Check availability."],
              ].map(([step, title, description]) => (
                <div key={step} className="incode-location-flow__step">
                  <span>{step}</span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </div>
              ))}
            </div>
            <InlineStack gap="200" wrap>
              <Button url="/app/delivery-settings?tab=coverage">Configure ZIP coverage</Button>
              <Button url={availabilityThemeEditorUrl} external target="_blank" variant="primary">Add ZIP availability block</Button>
            </InlineStack>
            <Banner tone="info" title="Which block should you add?">
              Add <strong>ZIP availability checker</strong> when you only want an availability answer. Add <strong>Estimated delivery date</strong> for automatic dates. Add <strong>Local delivery & pickup</strong> only when you want those service options. These blocks are independent and can be used separately.
            </Banner>
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">Choose where each order ships from</Text>
              <Text as="p" tone="subdued">
                Incode uses these Shopify warehouses and stores to make delivery dates more accurate. Configure this page only when you have multiple fulfillment locations, local delivery, or in-store pickup.
              </Text>
            </BlockStack>
            <div className="incode-location-flow" aria-label="Fulfillment location routing flow">
              {[
                ["1", "Shopify inventory", "Read the product stock at each location."],
                ["2", "Choose a location", "Use priority or the highest available stock."],
                ["3", "Calculate the ETA", "Apply processing and transit time for that location."],
              ].map(([step, title, description]) => (
                <div key={step} className="incode-location-flow__step">
                  <span>{step}</span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </div>
              ))}
            </div>
            <InlineStack gap="200" wrap>
              <Badge tone={locations.length === 1 ? "success" : "info"}>{locations.length === 1 ? "Single location setup" : `${locations.length} Shopify locations`}</Badge>
              <Badge>{`${locationsWithLocalDelivery} local delivery enabled`}</Badge>
              <Badge>{`${locationsWithPickup} pickup enabled`}</Badge>
              <Badge tone={inventoryAwareEnabled ? "success" : "attention"}>{inventoryAwareEnabled ? "Inventory-aware estimates enabled" : "Inventory-aware estimates disabled"}</Badge>
            </InlineStack>
            {locations.length === 1 ? (
              <Banner tone="info" title="One location? Keep it simple">
                Leave the default priority, enable ETA routing, and save only the processing or transit overrides that are different from your general delivery settings. You do not need to configure local delivery or pickup unless you offer them.
              </Banner>
            ) : (
              <Banner tone="info" title="How location routing reaches the storefront">
                Turn on inventory-aware estimates in Delivery control → Product settings. Then a product lookup can select the stocked location and return its location name, delivery estimate, local delivery, and pickup options.
              </Banner>
            )}
            <InlineStack gap="200" wrap>
              <Button url="/app/delivery-settings?tab=products">Configure inventory-aware estimates</Button>
              <Button url="/app/delivery-settings?tab=coverage" variant="plain">Review delivery coverage</Button>
            </InlineStack>
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
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="save_priority_mode" />
            <FormLayout>
              <Text as="h2" variant="headingMd">How should Incode choose a location?</Text>
              <Select
                label="Selection strategy"
                name="priorityMode"
                value={selectedPriorityMode}
                disabled={!isAdvanced}
                onChange={setSelectedPriorityMode}
                options={[
                  { label: "Manual priority (lowest number first)", value: "manual" },
                  { label: "Highest available stock", value: "highest_stock" },
                ]}
                helpText="Manual chooses the lowest priority number. Highest stock chooses the location with enough available inventory, then uses priority as the tie-breaker. Shopify still makes the final fulfillment assignment."
              />
              <Button submit variant="primary" disabled={!isAdvanced} loading={fetcher.state !== "idle"}>Save strategy</Button>
            </FormLayout>
          </fetcher.Form>
        </Card>
        <Card>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="save_icon_style" />
            <FormLayout>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Storefront service icons</Text>
                <Text as="p" tone="subdued">These shared shop styles also affect the main delivery widget. The independent Local delivery & pickup block uses its own Theme Editor settings; saving here does not change that block.</Text>
              </BlockStack>
              <Select
                label="Icon style"
                name="iconStyle"
                value={selectedIconStyle}
                disabled={!isAdvanced}
                onChange={setSelectedIconStyle}
                options={ICON_OPTIONS}
                helpText="Premium and duotone styles suit branded stores. Standard and minimal styles keep the result compact."
              />
              <FormLayout.Group condensed>
                <InlineStack gap="200" blockAlign="end" wrap={false}>
                  <input className="incode-color-input" type="color" value={selectedServiceIconColor} onChange={(event) => setSelectedServiceIconColor(event.currentTarget.value)} aria-label="Service icon color" />
                  <TextField label="Icon color" name="serviceIconColor" value={selectedServiceIconColor} onChange={setSelectedServiceIconColor} autoComplete="off" />
                </InlineStack>
                <InlineStack gap="200" blockAlign="end" wrap={false}>
                  <input className="incode-color-input" type="color" value={selectedServiceBackground} onChange={(event) => setSelectedServiceBackground(event.currentTarget.value)} aria-label="Service option background" />
                  <TextField label="Option background" name="serviceBackground" value={selectedServiceBackground} onChange={setSelectedServiceBackground} autoComplete="off" />
                </InlineStack>
                <Select label="Option effect" name="serviceEffect" value={selectedServiceEffect} options={EFFECT_OPTIONS} onChange={setSelectedServiceEffect} />
              </FormLayout.Group>
              <Button submit variant="primary" disabled={!isAdvanced} loading={fetcher.state !== "idle"}>Save icon style</Button>
            </FormLayout>
          </fetcher.Form>
        </Card>
        {locations.map((location) => {
          const form = forms[location.id];
          const address = [location.address?.city, location.address?.provinceCode, location.address?.zip, location.address?.countryCode]
            .filter(Boolean)
            .join(", ");
          return (
            <Card key={location.id}>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="save_location" />
                <input type="hidden" name="shopifyLocationId" value={location.id} />
                <input type="hidden" name="locationName" value={location.name} />
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center" gap="200">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">{location.name}</Text>
                      <Text as="p" tone="subdued">{address || "No address configured in Shopify"}</Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Badge tone={location.isActive ? "success" : undefined}>{location.isActive ? "Active" : "Inactive"}</Badge>
                      <Badge tone={location.fulfillsOnlineOrders ? "info" : undefined}>{location.fulfillsOnlineOrders ? "Online fulfillment" : "Not online"}</Badge>
                    </InlineStack>
                  </InlineStack>
                  <Checkbox label="Use this location for ETA routing" name="enabled" checked={form.enabled} disabled={!isAdvanced} onChange={(checked) => updateForm(location.id, "enabled", checked)} />
                  <FormLayout>
                    <FormLayout.Group condensed>
                      <TextField label="Priority" name="priority" type="number" min={0} max={9999} value={form.priority} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "priority", value)} autoComplete="off" helpText="Lower priority is selected first." />
                      <TextField label="Processing days override" name="processingDays" type="number" min={0} max={60} value={form.processingDays} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "processingDays", value)} autoComplete="off" />
                      <TextField label="Transit days override" name="transitDays" type="number" min={0} max={60} value={form.transitDays} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "transitDays", value)} autoComplete="off" />
                    </FormLayout.Group>
                    <Checkbox label="Offer local delivery from this location" name="localDeliveryEnabled" checked={form.localDeliveryEnabled} disabled={!isAdvanced} onChange={(checked) => updateForm(location.id, "localDeliveryEnabled", checked)} />
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
                    <Checkbox label="Offer in-store pickup from this location" name="pickupEnabled" checked={form.pickupEnabled} disabled={!isAdvanced} onChange={(checked) => updateForm(location.id, "pickupEnabled", checked)} />
                    <TextField label="Pickup instructions" name="pickupInstructions" value={form.pickupInstructions} disabled={!isAdvanced} onChange={(value) => updateForm(location.id, "pickupInstructions", value)} multiline={2} maxLength={500} autoComplete="off" />
                    <BlockStack gap="200">
                      <BlockStack gap="050">
                        <Text as="h3" variant="headingMd">Who can see these services?</Text>
                        <Text as="p" tone="subdued">Control both Local delivery and Store pickup from this location. Leave it on All when there is no product or zone restriction.</Text>
                      </BlockStack>
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
                    </BlockStack>
                    <Button submit variant="primary" loading={fetcher.state !== "idle"} disabled={!isAdvanced}>Save location</Button>
                  </FormLayout>
                </BlockStack>
              </fetcher.Form>
            </Card>
          );
        })}
        {locations.length === 0 ? <Text as="p">No Shopify locations are available.</Text> : null}
        </BlockStack>
          </Layout.Section>
          <Layout.Section variant="oneThird">
             <div className="incode-locations-preview-column">
              <Card><BlockStack gap="300">
                <Select label="Location" value={previewLocationId} onChange={setPreviewLocationId} options={locations.map((location) => ({ label: location.name, value: location.id }))} disabled={!locations.length} />
                <Select label="Preview style" value={appearanceSource} onChange={setAppearanceSource} options={[{ label: "Use shop colors", value: "shop" }, { label: "Try block colors", value: "theme" }]} />
                <Text as="p" tone="subdued" variant="bodySm">Save block appearance in Theme Editor.</Text>
                {appearanceSource === "theme" ? <>
                  <Select label="Block icons" options={ICON_OPTIONS} value={themeAppearance.iconStyle} onChange={(value) => setThemeAppearance((current) => ({ ...current, iconStyle: value }))} />
                  <TextField label="Block accent color" value={themeAppearance.color} onChange={(value) => setThemeAppearance((current) => ({ ...current, color: value }))} autoComplete="off" />
                  <TextField label="Block option background" value={themeAppearance.background} onChange={(value) => setThemeAppearance((current) => ({ ...current, background: value }))} autoComplete="off" />
                  <Select label="Block effect" options={EFFECT_OPTIONS.filter((option) => option.value !== "route")} value={themeAppearance.effect} onChange={(value) => setThemeAppearance((current) => ({ ...current, effect: value }))} />
                </> : null}
              </BlockStack></Card>
              {previewLocation && previewForm ? (
                <StorefrontLocationPreview
                  location={previewLocation}
                  form={previewForm}
                  routingEnabled={previewRoutingEnabled}
                  iconStyle={appearanceSource === "shop" ? selectedIconStyle : themeAppearance.iconStyle}
                  serviceIconColor={appearanceSource === "shop" ? selectedServiceIconColor : themeAppearance.color}
                  serviceBackground={appearanceSource === "shop" ? selectedServiceBackground : themeAppearance.background}
                  serviceEffect={appearanceSource === "shop" ? selectedServiceEffect : themeAppearance.effect}
                  shop={shop}
                  apiKey={apiKey}
                />
              ) : (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">Storefront preview</Text>
                    <Banner tone="warning" title="Enable a routing location">Enable an active location on the left to see the customer-facing delivery card.</Banner>
                  </BlockStack>
                </Card>
              )}
            </div>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
