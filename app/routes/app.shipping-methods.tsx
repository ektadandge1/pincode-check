import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  FormLayout,
  InlineStack,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import prisma from "../db.server";
import { resolvePlanAccess } from "../services/plan-access.server";
import { requireActiveBilling } from "../services/billing.server";
import {
  inferShippingMethodKind,
  shippingMethodHandle,
  SHIPPING_METHOD_KINDS,
  validateShippingMethodFields,
} from "../utils/shipping-method";

type ActionData = {
  ok: boolean;
  message: string;
  needsReauthorization?: boolean;
};

type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type SyncedDefinition = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
};

const EMPTY_FORM = {
  id: "",
  name: "",
  handle: "",
  kind: "standard",
  priority: "100",
  processingDays: "",
  transitDays: "3",
  description: "",
  customMessage: "",
};

function hasScope(scopeCsv: string | null | undefined, scope: string) {
  return String(scopeCsv ?? "").split(",").map((value) => value.trim()).includes(scope);
}

async function grantedScopes(admin: AdminClient): Promise<Set<string>> {
  const response = await admin.graphql(`#graphql
    query ShippingMethodSyncScopes {
      currentAppInstallation {
        accessScopes { handle }
      }
    }
  `);
  if (!response.ok) throw new Error(`Shopify returned HTTP ${response.status}.`);
  const json = await response.json() as {
    data?: { currentAppInstallation?: { accessScopes?: Array<{ handle?: string }> } | null };
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).filter(Boolean).join(" "));
  }
  return new Set(
    (json.data?.currentAppInstallation?.accessScopes ?? [])
      .map((scope) => scope.handle)
      .filter((scope): scope is string => Boolean(scope)),
  );
}

async function loadShopifyMethodDefinitions(admin: AdminClient): Promise<SyncedDefinition[]> {
  const definitions: SyncedDefinition[] = [];
  let after: string | null = null;
  let profileCount = 0;

  do {
    const response = await admin.graphql(`#graphql
      query ShippingMethodDefinitionsForSync($after: String) {
        deliveryProfiles(first: 1, after: $after) {
          nodes {
            profileLocationGroups {
              locationGroupZones(first: 25) {
                pageInfo { hasNextPage }
                nodes {
                  methodDefinitions(first: 25) {
                    pageInfo { hasNextPage }
                    nodes { id name description active }
                  }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { variables: { after } });

    if (!response.ok) throw new Error(`Shopify returned HTTP ${response.status}.`);
    const json = await response.json() as {
      data?: {
        deliveryProfiles?: {
          nodes?: Array<{
            profileLocationGroups?: Array<{
              locationGroupZones?: {
                pageInfo?: { hasNextPage?: boolean };
                nodes?: Array<{
                  methodDefinitions?: {
                    pageInfo?: { hasNextPage?: boolean };
                    nodes?: SyncedDefinition[];
                  };
                }>;
              };
            }>;
          }>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) {
      throw new Error(json.errors.map((error) => error.message).filter(Boolean).join(" "));
    }

    const profiles = json.data?.deliveryProfiles;
    if (!profiles) {
      throw new Error("Shopify did not return delivery profiles. No methods were changed.");
    }
    for (const profile of profiles?.nodes ?? []) {
      profileCount += 1;
      for (const group of profile.profileLocationGroups ?? []) {
        const zones = group.locationGroupZones;
        if (zones?.pageInfo?.hasNextPage) {
          throw new Error("A delivery profile has more than 25 zones. No methods were changed; contact support for a segmented sync.");
        }
        for (const zone of zones?.nodes ?? []) {
          if (zone.methodDefinitions?.pageInfo?.hasNextPage) {
            throw new Error("A delivery zone has more than 25 methods. No methods were changed; contact support for a segmented sync.");
          }
          definitions.push(...(zone.methodDefinitions?.nodes ?? []));
        }
      }
    }

    if (profileCount > 250) {
      throw new Error("More than 250 delivery profiles were found. No methods were changed.");
    }
    after = profiles?.pageInfo?.hasNextPage ? profiles.pageInfo.endCursor ?? null : null;
    if (profiles?.pageInfo?.hasNextPage && !after) {
      throw new Error("Shopify did not return a delivery profile cursor. No methods were changed.");
    }
  } while (after);

  return definitions;
}

async function syncShopifyMethods(shop: string, admin: AdminClient) {
  const scopes = await grantedScopes(admin);
  if (!scopes.has("read_shipping") && !scopes.has("write_shipping")) {
    return {
      ok: false,
      needsReauthorization: true,
      message: "Shopify has not granted read_shipping. Reauthorize the app, then run sync again. Manual method creation remains available.",
    } satisfies ActionData;
  }

  const definitions = await loadShopifyMethodDefinitions(admin);
  const uniqueDefinitions = new Map<string, SyncedDefinition>();
  for (const definition of definitions) {
    const name = definition.name.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("en-US");
    const current = uniqueDefinitions.get(key);
    uniqueDefinitions.set(key, {
      ...definition,
      name,
      active: definition.active || current?.active === true,
      description: current?.description ?? definition.description?.trim().slice(0, 250) ?? null,
    });
  }

  const existing = await prisma.shippingMethodRule.findMany({ where: { shop } });
  const existingByName = new Map(existing.map((method) => [method.name.toLocaleLowerCase("en-US"), method]));
  const usedHandles = new Set(existing.map((method) => method.handle));
  let created = 0;
  let enriched = 0;
  let preserved = 0;

  const operations = [...uniqueDefinitions.entries()].map(([nameKey, definition], index) => {
    const matched = existingByName.get(nameKey);
    let handle = matched?.handle ?? shippingMethodHandle(definition.name);
    if (!matched && usedHandles.has(handle)) {
      const suffix = definition.id.split("/").pop()?.replace(/\D/g, "").slice(-8) || String(index + 1);
      handle = `${handle.slice(0, Math.max(2, 49 - suffix.length))}-${suffix}`;
      let collision = 2;
      while (usedHandles.has(handle)) {
        const collisionSuffix = `-${suffix}-${collision}`;
        handle = `${shippingMethodHandle(definition.name).slice(0, 50 - collisionSuffix.length)}${collisionSuffix}`;
        collision += 1;
      }
    }
    usedHandles.add(handle);

    const importedDescription = definition.description || null;
    if (!matched) created += 1;
    else if (!matched.description && importedDescription) enriched += 1;
    else preserved += 1;

    return prisma.shippingMethodRule.upsert({
      where: { shop_handle: { shop, handle } },
      create: {
        shop,
        handle,
        name: definition.name,
        kind: inferShippingMethodKind(definition.name),
        enabled: false,
        priority: Math.min(9999, 100 + index),
        processingDays: null,
        transitDays: 3,
        description: importedDescription,
      },
      update: {
        description: matched?.description ?? importedDescription,
      },
    });
  });

  if (operations.length) await prisma.$transaction(operations);
  const activeDefinitions = definitions.filter((definition) => definition.active).length;
  return {
    ok: true,
    message: `Found ${definitions.length} Shopify definitions (${activeDefinitions} active, ${uniqueDefinitions.size} unique). Added ${created} disabled, enriched ${enriched}, and preserved ${preserved} existing rules. No rules were deleted or enabled.`,
  } satisfies ActionData;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const [access, methods, setting] = await Promise.all([
    resolvePlanAccess({ shop: session.shop, admin }),
    prisma.shippingMethodRule.findMany({
      where: { shop: session.shop },
      orderBy: [{ priority: "asc" }, { id: "asc" }],
    }),
    prisma.deliverySetting.findUnique({ where: { shop: session.shop } }),
  ]);
  return {
    access,
    methods,
    displayStyle: setting?.shippingMethodDisplayStyle ?? "visual",
    hasReadShipping: hasScope(session.scope, "read_shipping") || hasScope(session.scope, "write_shipping"),
    reauthorizeUrl: `/auth?shop=${encodeURIComponent(session.shop)}`,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const access = await resolvePlanAccess({ shop: session.shop, admin });
  const data = await request.formData();
  const intent = String(data.get("intent") ?? "");
  if (!access.features.deliveryOptions) {
    return { ok: false, message: "Shipping method ETA rules require an active Standard subscription." } satisfies ActionData;
  }

  if (intent === "sync") {
    try {
      return await syncShopifyMethods(session.shop, admin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Shopify API error.";
      const missingScope = /access denied|read_shipping|shipping scope|permission/i.test(message);
      return {
        ok: false,
        needsReauthorization: missingScope,
        message: missingScope
          ? "Shopify denied access to delivery methods. Reauthorize the app to grant read_shipping, or continue creating methods manually."
          : `Shopify method sync failed: ${message}`,
      } satisfies ActionData;
    }
  }

  if (intent === "display-style") {
    const displayStyle = String(data.get("displayStyle") ?? "visual");
    if (displayStyle !== "visual" && displayStyle !== "dropdown") {
      return { ok: false, message: "Invalid display style." } satisfies ActionData;
    }
    await prisma.deliverySetting.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, shippingMethodDisplayStyle: displayStyle },
      update: { shippingMethodDisplayStyle: displayStyle },
    });
    return { ok: true, message: "Storefront method display saved." } satisfies ActionData;
  }

  if (intent === "save") {
    const parsed = validateShippingMethodFields(Object.fromEntries(data));
    if (!parsed.value) return { ok: false, message: parsed.error ?? "Invalid shipping method." } satisfies ActionData;
    const fields = parsed.value;
    const id = Number(data.get("id"));
    try {
      if (Number.isInteger(id) && id > 0) {
        const existing = await prisma.shippingMethodRule.findFirst({ where: { id, shop: session.shop } });
        if (!existing) return { ok: false, message: "Shipping method not found." } satisfies ActionData;
        await prisma.shippingMethodRule.update({ where: { id }, data: fields });
        return { ok: true, message: `${fields.name} updated.` } satisfies ActionData;
      }
      await prisma.shippingMethodRule.create({
        data: { shop: session.shop, ...fields },
      });
      return { ok: true, message: `${fields.name} created.` } satisfies ActionData;
    } catch (error) {
      if (error instanceof Error && /unique constraint/i.test(error.message)) {
        return { ok: false, message: "That handle is already used. Edit the existing method or choose another handle." } satisfies ActionData;
      }
      throw error;
    }
  }

  const id = Number(data.get("id"));
  const method = await prisma.shippingMethodRule.findFirst({ where: { id, shop: session.shop } });
  if (!method) return { ok: false, message: "Shipping method not found." } satisfies ActionData;
  if (intent === "toggle") {
    await prisma.shippingMethodRule.update({ where: { id }, data: { enabled: !method.enabled } });
    return { ok: true, message: `${method.name} ${method.enabled ? "disabled" : "enabled"}.` } satisfies ActionData;
  }
  if (intent === "delete") {
    await prisma.shippingMethodRule.delete({ where: { id } });
    return { ok: true, message: `${method.name} deleted.` } satisfies ActionData;
  }
  return { ok: false, message: "Unsupported action." } satisfies ActionData;
}

export default function ShippingMethodsPage() {
  const { access, methods, displayStyle, hasReadShipping, reauthorizeUrl } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isAdvanced = access.active;
  const [form, setForm] = useState(EMPTY_FORM);
  const [methodDisplayStyle, setMethodDisplayStyle] = useState(displayStyle);
  const isSaving = fetcher.state !== "idle";

  const editMethod = (method: (typeof methods)[number]) => {
    setForm({
      id: String(method.id),
      name: method.name,
      handle: method.handle,
      kind: method.kind,
      priority: String(method.priority),
      processingDays: method.processingDays === null ? "" : String(method.processingDays),
      transitDays: String(method.transitDays),
      description: method.description ?? "",
      customMessage: method.customMessage ?? "",
    });
  };

  const rows = methods.map((method) => [
    method.name,
    method.handle,
    method.kind.replaceAll("_", " "),
    method.processingDays ?? "Default",
    method.transitDays,
    method.priority,
    method.enabled
      ? <Badge key={`${method.id}-status`} tone="success">Enabled</Badge>
      : <Badge key={`${method.id}-status`}>Disabled</Badge>,
    <InlineStack key={`${method.id}-actions`} gap="200" wrap={false}>
      <Button size="slim" disabled={!isAdvanced} onClick={() => editMethod(method)}>Edit</Button>
      <fetcher.Form method="post"><input type="hidden" name="intent" value="toggle" /><input type="hidden" name="id" value={method.id} /><Button submit size="slim" disabled={!isAdvanced}>{method.enabled ? "Disable" : "Enable"}</Button></fetcher.Form>
      <fetcher.Form method="post"><input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={method.id} /><Button submit size="slim" tone="critical" disabled={!isAdvanced}>Delete</Button></fetcher.Form>
    </InlineStack>,
  ]);

  return (
    <Page title="Shipping method ETAs" subtitle="Show informational delivery estimates for eligible methods without changing Shopify checkout rates." titleMetadata={<Badge tone={isAdvanced ? "success" : "info"}>{isAdvanced ? "Standard" : "Subscription required"}</Badge>}>
      <BlockStack gap="400">
        {fetcher.data ? (
          <Banner
            tone={fetcher.data.ok ? "success" : "critical"}
            action={fetcher.data.needsReauthorization ? { content: "Reauthorize app", url: reauthorizeUrl } : undefined}
          >
            {fetcher.data.message}
          </Banner>
        ) : null}
        {!isAdvanced ? (
          <Banner tone="info" title="Standard subscription required" action={{ content: "View plan", url: "/app/plans" }}>
            Activate Standard to configure method-specific processing and transit times.
          </Banner>
        ) : null}
        {!hasReadShipping ? (
          <Banner tone="warning" title="Shopify shipping permission required" action={{ content: "Reauthorize app", url: reauthorizeUrl }}>
            Sync requires the new read_shipping scope. Existing and manually created rules continue to work without it.
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Sync from Shopify</Text>
            <Text as="p" tone="subdued">Import delivery profile method definitions through Admin GraphQL. New methods are disabled with inferred eligibility and a three-day transit default. Sync never deletes or enables rules.</Text>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="sync" />
              <Button submit disabled={!isAdvanced} loading={isSaving}>Sync Shopify methods</Button>
            </fetcher.Form>
          </BlockStack>
        </Card>

        <Card>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="display-style" />
            <FormLayout>
              <Text as="h2" variant="headingMd">Storefront selection style</Text>
              <Select
                label="Method control"
                name="displayStyle"
                value={methodDisplayStyle}
                disabled={!isAdvanced}
                onChange={setMethodDisplayStyle}
                options={[
                  { label: "Visual option cards", value: "visual" },
                  { label: "Classic dropdown", value: "dropdown" },
                ]}
                helpText="Shoppers select an informational estimate only. This does not select or alter a Shopify checkout shipping rate."
              />
              <Button submit variant="primary" loading={isSaving} disabled={!isAdvanced}>Save display style</Button>
            </FormLayout>
          </fetcher.Form>
        </Card>

        <Card>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="id" value={form.id} />
            <FormLayout>
              <Text as="h2" variant="headingMd">{form.id ? "Edit method" : "Create method manually"}</Text>
              <FormLayout.Group condensed>
                <TextField label="Method name" name="name" value={form.name} disabled={!isAdvanced} maxLength={100} onChange={(value) => setForm((current) => ({ ...current, name: value }))} autoComplete="off" placeholder="Express delivery" />
                <TextField label="Handle" name="handle" value={form.handle} disabled={!isAdvanced} maxLength={50} onChange={(value) => setForm((current) => ({ ...current, handle: value.toLowerCase() }))} autoComplete="off" placeholder="express" />
                <Select label="Eligibility" name="kind" value={form.kind} disabled={!isAdvanced} onChange={(value) => setForm((current) => ({ ...current, kind: value }))} options={SHIPPING_METHOD_KINDS.map((kind) => ({ label: kind.replaceAll("_", " "), value: kind }))} />
              </FormLayout.Group>
              <FormLayout.Group condensed>
                <TextField label="Processing days override" name="processingDays" type="number" min={0} max={60} value={form.processingDays} disabled={!isAdvanced} onChange={(value) => setForm((current) => ({ ...current, processingDays: value }))} autoComplete="off" />
                <TextField label="Transit days" name="transitDays" type="number" min={0} max={60} value={form.transitDays} disabled={!isAdvanced} onChange={(value) => setForm((current) => ({ ...current, transitDays: value }))} autoComplete="off" />
                <TextField label="Priority" name="priority" type="number" min={0} max={9999} value={form.priority} disabled={!isAdvanced} onChange={(value) => setForm((current) => ({ ...current, priority: value }))} autoComplete="off" />
              </FormLayout.Group>
              <TextField label="Description" name="description" value={form.description} disabled={!isAdvanced} maxLength={250} showCharacterCount multiline={2} onChange={(value) => setForm((current) => ({ ...current, description: value }))} autoComplete="off" helpText="Optional supporting copy shown with the method." />
              <TextField label="Custom selection message" name="customMessage" value={form.customMessage} disabled={!isAdvanced} maxLength={500} showCharacterCount multiline={3} onChange={(value) => setForm((current) => ({ ...current, customMessage: value }))} autoComplete="off" helpText="Optional message shown after a shopper selects this method." />
              <InlineStack gap="200">
                <Button submit variant="primary" loading={isSaving} disabled={!isAdvanced}>{form.id ? "Update method" : "Create method"}</Button>
                {form.id ? <Button onClick={() => setForm(EMPTY_FORM)}>Cancel edit</Button> : null}
              </InlineStack>
            </FormLayout>
          </fetcher.Form>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Configured methods</Text>
            {rows.length ? <DataTable columnContentTypes={["text", "text", "text", "text", "numeric", "numeric", "text", "text"]} headings={["Name", "Handle", "Eligibility", "Processing", "Transit", "Priority", "Status", "Actions"]} rows={rows} /> : <Text as="p" tone="subdued">No shipping methods configured. Sync from Shopify or create one manually.</Text>}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
