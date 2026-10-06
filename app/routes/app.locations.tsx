import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
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
  Text,
  TextField,
} from "@shopify/polaris";
import prisma from "../db.server";
import { resolvePlanAccess } from "../services/plan-access.server";
import { NO_PLAN_ACCESS } from "../services/plans.server";
import { requireActiveBilling } from "../services/billing.server";

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

type ActionData = { ok: boolean; message: string };

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
  localDeliveryPostalCodesCsv: string;
  pickupEnabled: boolean;
  pickupInstructions: string;
};

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

function previewPostalMatches(postalCode: string, patterns: string): boolean {
  const value = postalCode.trim();
  return patterns.split(/[\n,]/).map((pattern) => pattern.trim()).filter(Boolean).some((pattern) => {
    if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
    const range = pattern.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range && /^\d+$/.test(value)) {
      const numeric = Number(value);
      return numeric >= Number(range[1]) && numeric <= Number(range[2]);
    }
    return pattern.toLowerCase() === value.toLowerCase();
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const [rules, setting] = await Promise.all([
    prisma.fulfillmentLocationRule.findMany({
      where: { shop: session.shop },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    }),
    prisma.deliverySetting.findUnique({ where: { shop: session.shop } }),
  ]);
  const ruleByLocation = new Map(rules.map((rule) => [rule.shopifyLocationId, rule]));
  let locations: LocationRow[] = [];
  let locationError = "";
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
      }
    `);
    const payload = (await response.json()) as {
      data?: { locations?: { nodes?: ShopifyLocation[] } };
      errors?: Array<{ message?: string }>;
    };
    if (!response.ok || payload.errors?.length) {
      throw new Error(payload.errors?.[0]?.message ?? "Unable to load Shopify locations.");
    }
    locations = (payload.data?.locations?.nodes ?? []).map((location) => ({
      ...location,
      rule: ruleByLocation.get(location.id) ?? null,
    }));
  } catch (error) {
    locationError = error instanceof Error ? error.message : "Unable to load Shopify locations.";
    locations = rules.map((rule) => ({
      id: rule.shopifyLocationId,
      name: rule.name,
      isActive: rule.enabled,
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
    locationError,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const access = await resolvePlanAccess({ shop: session.shop, admin });
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
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
    return { ok: true, message: "Storefront service icon style saved." } satisfies ActionData;
  }

  const shopifyLocationId = String(formData.get("shopifyLocationId") ?? "").trim();
  const name = String(formData.get("locationName") ?? "").trim();
  const priority = Number(formData.get("priority") ?? 100);
  const processingDays = optionalDays(formData.get("processingDays"));
  const transitDays = optionalDays(formData.get("transitDays"));
  const pickupInstructions = String(formData.get("pickupInstructions") ?? "").trim();
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
  if (pickupInstructions.length > 500) {
    return { ok: false, message: "Pickup instructions must be 500 characters or fewer." } satisfies ActionData;
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
      localDeliveryPostalCodesCsv: [...new Set(patterns)].join(","),
      pickupEnabled: parseBool(formData.get("pickupEnabled")),
      pickupInstructions,
    },
    update: {
      name,
      enabled: parseBool(formData.get("enabled")),
      priority,
      processingDays,
      transitDays,
      localDeliveryEnabled: parseBool(formData.get("localDeliveryEnabled")),
      localDeliveryPostalCodesCsv: [...new Set(patterns)].join(","),
      pickupEnabled: parseBool(formData.get("pickupEnabled")),
      pickupInstructions,
    },
  });
  return { ok: true, message: `${name} saved.` } satisfies ActionData;
}

function ServiceIcon({ kind, style }: { kind: "local" | "pickup"; style: string }) {
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
  postalCode,
  localDeliveryAvailable,
  previewMode,
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
  postalCode: string;
  localDeliveryAvailable: boolean;
  previewMode: "automatic" | "postal";
  routingEnabled: boolean;
  iconStyle: string;
  serviceIconColor: string;
  serviceBackground: string;
  serviceEffect: string;
  shop: string;
  apiKey: string;
}) {
  const shopHandle = shop.replace(/\.myshopify\.com$/i, "");
  const themeEditorUrl = (template: "product" | "cart", blockHandle: string) =>
    `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=${template}&addAppBlockId=${apiKey}/${blockHandle}&target=mainSection`;
  const hasShopperPostalCode = previewMode === "postal" && Boolean(postalCode.trim());
  const localOptionState = !hasShopperPostalCode ? "is-pending" : localDeliveryAvailable ? "is-available" : "is-unavailable";
  const pickupOptionState = !hasShopperPostalCode ? "is-pending" : form.pickupEnabled ? "is-available" : "is-unavailable";
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">Storefront preview</Text>
            <Text as="p" tone="subdued">Customer-facing delivery options for the current settings.</Text>
          </BlockStack>
          <Badge tone={routingEnabled ? "success" : "attention"}>{routingEnabled ? "Live sample" : "Setup preview"}</Badge>
        </InlineStack>
        {!routingEnabled ? (
          <Banner tone="warning" title="Enable this location to publish the result">
            The preview uses this Shopify location so you can style the customer experience. Turn on ETA routing in the location settings on the left to use it in the storefront.
          </Banner>
        ) : null}
        <div className="incode-storefront-preview__hint">
          {previewMode === "automatic"
            ? "Automatic ETA is visible immediately. Local delivery requires the shopper's postal code."
            : "This simulates a shopper entering a postal code. The warehouse address is never used as the shopper destination."}
        </div>
        <div className="incode-storefront-delivery-card">
          <div className="incode-storefront-delivery-card__header">
            <span>{hasShopperPostalCode ? <>Checked for <strong>{postalCode}</strong></> : previewMode === "automatic" ? "General delivery estimate" : "Enter PIN/ZIP to check services"}</span>
            <span className="incode-storefront-delivery-card__check">✓ Available</span>
          </div>
          <div className="incode-storefront-delivery-card__eta">
            <span className="incode-storefront-delivery-card__eta-icon">⌁</span>
            <div>
              <strong>Estimated delivery</strong>
              <span>{form.processingDays || "General"} processing + {form.transitDays || "general"} transit time</span>
            </div>
            <b>Oct 8–10</b>
          </div>
          <div className="incode-storefront-delivery-card__options">
            <div className={`${localOptionState} incode-service-option--${serviceEffect}`} style={{ "--service-icon-color": serviceIconColor, "--service-background": serviceBackground } as React.CSSProperties}>
              <span className="incode-storefront-delivery-card__option-icon"><ServiceIcon kind="local" style={iconStyle} /></span>
              <span>Local delivery</span>
              <b>{hasShopperPostalCode ? (localDeliveryAvailable ? "Available" : "Not available") : "Check PIN/ZIP"}</b>
            </div>
            <div className={`${pickupOptionState} incode-service-option--${serviceEffect}`} style={{ "--service-icon-color": serviceIconColor, "--service-background": serviceBackground } as React.CSSProperties}>
              <span className="incode-storefront-delivery-card__option-icon"><ServiceIcon kind="pickup" style={iconStyle} /></span>
              <span>Store pickup</span>
              <b>{hasShopperPostalCode ? (form.pickupEnabled ? "Available" : "Not available") : "Check PIN/ZIP"}</b>
            </div>
          </div>
          <small className="incode-storefront-delivery-card__location">Fulfilled from {location.name}</small>
        </div>
        <BlockStack gap="200">
          <Text as="p" tone="subdued" variant="bodySm">Add Local delivery & pickup independently where shoppers make a decision:</Text>
          <InlineStack gap="200" wrap>
            <Button url={themeEditorUrl("product", "delivery-service-options")} target="_blank" variant="primary">Add to product page</Button>
            <Button url={themeEditorUrl("cart", "delivery-service-options")} target="_blank">Add to cart page</Button>
          </InlineStack>
          <Text as="p" tone="subdued" variant="bodySm">Automatic delivery dates remain separate and can be enabled from Storefront style.</Text>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

export default function LocationsPage() {
  const { access, apiKey, shop, locations, priorityMode, iconStyle, serviceIconColor, serviceBackground, serviceEffect, locationError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isAdvanced = access.active;
  const [forms, setForms] = useState<Record<string, LocationForm>>(() => Object.fromEntries(locations.map((location) => [location.id, {
    enabled: location.rule?.enabled ?? location.isActive,
    priority: String(location.rule?.priority ?? 100),
    processingDays: location.rule?.processingDays === null || location.rule?.processingDays === undefined ? "" : String(location.rule.processingDays),
    transitDays: location.rule?.transitDays === null || location.rule?.transitDays === undefined ? "" : String(location.rule.transitDays),
    localDeliveryEnabled: location.rule?.localDeliveryEnabled ?? false,
    localDeliveryPostalCodesCsv: location.rule?.localDeliveryPostalCodesCsv ?? "",
    pickupEnabled: location.rule?.pickupEnabled ?? false,
    pickupInstructions: location.rule?.pickupInstructions ?? "",
  }])));
  const [selectedPriorityMode, setSelectedPriorityMode] = useState(priorityMode);
  const [selectedIconStyle, setSelectedIconStyle] = useState(iconStyle);
  const [selectedServiceIconColor, setSelectedServiceIconColor] = useState(serviceIconColor);
  const [selectedServiceBackground, setSelectedServiceBackground] = useState(serviceBackground);
  const [selectedServiceEffect, setSelectedServiceEffect] = useState(serviceEffect);
  const [previewMode, setPreviewMode] = useState<"automatic" | "postal">("automatic");
  const [previewPostalCode, setPreviewPostalCode] = useState("10001");
  const [checkedPreviewPostalCode, setCheckedPreviewPostalCode] = useState("");
  const updateForm = (locationId: string, field: string, value: string | boolean) => {
    setForms((current) => ({
      ...current,
      [locationId]: { ...current[locationId], [field]: value },
      }));
  };
  const configuredLocations = locations.filter((location) => forms[location.id]?.enabled && location.isActive);
  const previewLocations = [...configuredLocations].sort((a, b) => {
    const priorityDifference = Number(forms[a.id]?.priority ?? 100) - Number(forms[b.id]?.priority ?? 100);
    return priorityDifference;
  });
  const previewLocation = previewLocations[0] ?? locations[0] ?? null;
  const previewForm = previewLocation ? forms[previewLocation.id] : null;
  const previewRoutingEnabled = Boolean(previewLocation && configuredLocations.some((location) => location.id === previewLocation.id));
  const checkedPostalCode = previewMode === "postal" ? checkedPreviewPostalCode : "";
  const previewLocalDelivery = Boolean(previewRoutingEnabled && checkedPostalCode && previewForm?.localDeliveryEnabled && previewPostalMatches(checkedPostalCode, String(previewForm.localDeliveryPostalCodesCsv ?? "")));
  const locationsWithLocalDelivery = locations.filter((location) => forms[location.id]?.localDeliveryEnabled).length;
  const locationsWithPickup = locations.filter((location) => forms[location.id]?.pickupEnabled).length;

  return (
    <Page
      title="Fulfillment locations"
      subtitle="Route estimates to stocked Shopify locations and configure pickup or local delivery."
      titleMetadata={<Badge tone={isAdvanced ? "success" : "info"}>{isAdvanced ? "Standard" : "Subscription required"}</Badge>}
    >
      <BlockStack gap="400">
        <Layout>
          <Layout.Section>
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
                <Text as="p" tone="subdued">Choose how Local delivery and Store pickup appear inside the delivery result on your storefront.</Text>
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
        <Card>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">Routing preview</Text>
              <Text as="p" tone="subdued">Test how the current enabled locations would be used for a shopper. This preview explains the route; the live storefront uses the selected product variant and real Shopify inventory.</Text>
            </BlockStack>
            <FormLayout.Group condensed>
              <Select
                label="Preview mode"
                value={previewMode}
                onChange={(value) => {
                  const mode = value as "automatic" | "postal";
                  setPreviewMode(mode);
                  if (mode === "automatic") setCheckedPreviewPostalCode("");
                }}
                options={[
                  { label: "Automatic estimate (no postal code)", value: "automatic" },
                  { label: "Shopper postal-code check", value: "postal" },
                ]}
                helpText="Use automatic mode for the product/cart first view. Use postal mode to test local delivery coverage."
              />
              <TextField label="Shopper PIN / ZIP code" value={previewPostalCode} onChange={(value) => { setPreviewPostalCode(value); setCheckedPreviewPostalCode(""); }} disabled={previewMode !== "postal"} autoComplete="postal-code" helpText={previewMode === "postal" ? "Enter a shopper destination code, then click Check availability." : "Switch to postal-code check mode to test destination-specific services."} />
              <TextField label="Example quantity" value="1" disabled autoComplete="off" helpText="Live routing uses the shopper's requested quantity." />
            </FormLayout.Group>
            {previewMode === "postal" ? (
              <InlineStack gap="200" blockAlign="center" wrap>
                <Button variant="primary" disabled={!previewPostalCode.trim()} onClick={() => setCheckedPreviewPostalCode(previewPostalCode.trim())}>Check availability</Button>
                <Text as="span" tone="subdued">{checkedPostalCode ? `Checked ${checkedPostalCode}` : "Local delivery and pickup results appear after checking."}</Text>
              </InlineStack>
            ) : null}
            {previewLocation && previewForm ? (
              <>
                <div className="incode-location-preview">
                  <div className="incode-location-preview__result">
                    <span className="incode-location-preview__icon">✓</span>
                    <div>
                      <strong>{previewLocation.name}</strong>
                      <small>{selectedPriorityMode === "highest_stock" ? "Live storefront checks stock first; preview uses priority" : `Priority ${previewForm.priority || "100"} selected first`}</small>
                    </div>
                    <Badge tone="success">Selected</Badge>
                  </div>
                  <div className="incode-location-preview__details">
                    <span><b>{previewForm.processingDays || "General"}</b> processing days</span>
                    <span><b>{previewForm.transitDays || "General"}</b> transit days</span>
                    <span><b>{checkedPostalCode ? (previewLocalDelivery ? "Available" : "Not matched") : "Check required"}</b> local delivery</span>
                    <span><b>{checkedPostalCode ? (previewForm.pickupEnabled ? "Available" : "Not enabled") : "Check required"}</b> store pickup</span>
                  </div>
                  {checkedPostalCode && previewForm.localDeliveryEnabled && !previewLocalDelivery ? <Text as="p" tone="subdued">This PIN / ZIP does not match the selected location local delivery patterns.</Text> : null}
                </div>
              </>
            ) : (
              <Banner tone="warning" title="No eligible routing location">
                Enable at least one active Shopify location for ETA routing. If inventory-aware estimates are enabled, the selected product variant must also have enough stock at an eligible location.
              </Banner>
            )}
          </BlockStack>
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
                    <Button submit variant="primary" loading={fetcher.state !== "idle"} disabled={!isAdvanced}>Save location</Button>
                  </FormLayout>
                </BlockStack>
              </fetcher.Form>
            </Card>
          );
        })}
        {locations.length === 0 ? <Text as="p">No Shopify locations are available.</Text> : null}
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <div className="incode-locations-preview-column">
              {previewLocation && previewForm ? (
                <StorefrontLocationPreview
                  location={previewLocation}
                  form={previewForm}
                  postalCode={checkedPostalCode}
                  localDeliveryAvailable={previewLocalDelivery}
                  previewMode={previewMode}
                  routingEnabled={previewRoutingEnabled}
                  iconStyle={selectedIconStyle}
                  serviceIconColor={selectedServiceIconColor}
                  serviceBackground={selectedServiceBackground}
                  serviceEffect={selectedServiceEffect}
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
