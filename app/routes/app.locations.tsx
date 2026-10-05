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

type LocationRow = ShopifyLocation & {
  rule: Awaited<ReturnType<typeof prisma.fulfillmentLocationRule.findMany>>[number] | null;
};

function parseBool(value: FormDataEntryValue | null): boolean {
  return ["1", "true", "on"].includes(String(value ?? "").toLowerCase());
}

function optionalDays(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  return raw ? Number(raw) : null;
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
    priorityMode: setting?.locationPriorityMode === "highest_stock" ? "highest_stock" : "manual",
    locations,
    locationError,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const access = await resolvePlanAccess({ shop: session.shop, admin });
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  if (intent !== "save_location" && intent !== "save_priority_mode") {
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

export default function LocationsPage() {
  const { access, locations, priorityMode, locationError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isAdvanced = access.active;
  const [forms, setForms] = useState(() => Object.fromEntries(locations.map((location) => [location.id, {
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
  const updateForm = (locationId: string, field: string, value: string | boolean) => {
    setForms((current) => ({
      ...current,
      [locationId]: { ...current[locationId], [field]: value },
    }));
  };

  return (
    <Page
      title="Fulfillment locations"
      subtitle="Route estimates to stocked Shopify locations and configure pickup or local delivery."
      titleMetadata={<Badge tone={isAdvanced ? "success" : "info"}>{isAdvanced ? "Standard" : "Subscription required"}</Badge>}
    >
      <BlockStack gap="400">
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
              <Text as="h2" variant="headingMd">Inventory location priority</Text>
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
                helpText="Highest-stock mode uses manual priority as the tie-breaker. Shopify still makes the final fulfillment assignment."
              />
              <Button submit variant="primary" disabled={!isAdvanced} loading={fetcher.state !== "idle"}>Save strategy</Button>
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
      </BlockStack>
    </Page>
  );
}
