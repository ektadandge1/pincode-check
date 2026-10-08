import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import prisma from "../db.server";
import { requireActiveBilling } from "../services/billing.server";
import { clearDeliveryCheckCaches } from "../services/delivery-checker.server";
import { resolvePlanAccess } from "../services/plan-access.server";
import { normalizeTargetKind, normalizeTargetValue } from "../utils/targeting.server";

type ActionData = { ok: boolean; message: string };

function parseBool(value: FormDataEntryValue | null): boolean {
  return ["1", "true", "on"].includes(String(value ?? "").toLowerCase());
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const access = await resolvePlanAccess({ shop: session.shop, admin });
  const rules = await prisma.serviceAvailabilityRule.findMany({
    where: { shop: session.shop },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  });
  const editParam = new URL(request.url).searchParams.get("edit");
  const editId = Number(editParam ?? 0);
  const editingRule = Number.isSafeInteger(editId) && editId > 0 ? rules.find((rule) => rule.id === editId) ?? null : null;
  return {
    access,
    rules,
    editingRule,
    editNotFound: editParam !== null && !editingRule,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const access = await resolvePlanAccess({ shop: session.shop, admin });
  if (!access.features.targeting) {
    return { ok: false, message: "Service availability rules require an active Standard subscription." } satisfies ActionData;
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "save");
  const id = Number(formData.get("id") ?? 0);

  if (intent === "toggle" || intent === "delete") {
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, message: "Invalid service rule." } satisfies ActionData;
    const rule = await prisma.serviceAvailabilityRule.findFirst({ where: { id, shop: session.shop } });
    if (!rule) return { ok: false, message: "Service rule not found." } satisfies ActionData;
    if (intent === "delete") {
      await prisma.serviceAvailabilityRule.delete({ where: { id } });
      clearDeliveryCheckCaches(session.shop);
      return { ok: true, message: `Service rule "${rule.name}" deleted.` } satisfies ActionData;
    }
    await prisma.serviceAvailabilityRule.update({ where: { id }, data: { enabled: !rule.enabled } });
    clearDeliveryCheckCaches(session.shop);
    return { ok: true, message: `Service rule "${rule.name}" ${rule.enabled ? "disabled" : "enabled"}.` } satisfies ActionData;
  }

  const name = String(formData.get("name") ?? "").trim();
  const kind = normalizeTargetKind(String(formData.get("targetKind") ?? ""));
  const value = kind ? normalizeTargetValue(kind, String(formData.get("targetValue") ?? "")) : null;
  const priority = Number(formData.get("priority") ?? 100);
  if (!name || name.length > 60) return { ok: false, message: "Rule name is required and must be 60 characters or fewer." } satisfies ActionData;
  if (!kind || !value) return { ok: false, message: "Choose a valid target and enter its product ID, collection handle, vendor, or tag." } satisfies ActionData;
  if (!Number.isInteger(priority) || priority < 0 || priority > 9999) return { ok: false, message: "Priority must be an integer from 0 to 9999." } satisfies ActionData;
  if (id && (!Number.isSafeInteger(id) || id <= 0)) return { ok: false, message: "Invalid service rule." } satisfies ActionData;

  const duplicate = await prisma.serviceAvailabilityRule.findUnique({ where: { shop_name: { shop: session.shop, name } } });
  if (duplicate && duplicate.id !== id) return { ok: false, message: "A service rule with this name already exists." } satisfies ActionData;
  const data = {
    shop: session.shop,
    name,
    targetKind: kind,
    targetValue: value,
    priority,
    shippingAvailable: parseBool(formData.get("shippingAvailable")),
    localDeliveryAvailable: parseBool(formData.get("localDeliveryAvailable")),
    pickupAvailable: parseBool(formData.get("pickupAvailable")),
  };
  if (id) {
    const existing = await prisma.serviceAvailabilityRule.findFirst({ where: { id, shop: session.shop } });
    if (!existing) return { ok: false, message: "Service rule not found." } satisfies ActionData;
    await prisma.serviceAvailabilityRule.update({ where: { id }, data });
  } else {
    await prisma.serviceAvailabilityRule.create({ data: { ...data, enabled: true } });
  }
  clearDeliveryCheckCaches(session.shop);
  return { ok: true, message: `Service rule "${name}" ${id ? "updated" : "created"}.` } satisfies ActionData;
}

const EMPTY_FORM = {
  name: "",
  targetKind: "product",
  targetValue: "",
  priority: "100",
  shippingAvailable: true,
  localDeliveryAvailable: true,
  pickupAvailable: true,
};

const SERVICE_META = [
  { key: "shippingAvailable", title: "Shipping", desc: "Standard PIN estimate", icon: "🌍" },
  { key: "localDeliveryAvailable", title: "Local delivery", desc: "Zone / postcode delivery", icon: "🚚" },
  { key: "pickupAvailable", title: "Store pickup", desc: "Location + date pickup", icon: "🏬" },
] as const;

export default function ServiceRulesPage() {
  const { access, rules, editingRule, editNotFound } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState("");
  useEffect(() => {
    setForm(editingRule ? {
      name: editingRule.name,
      targetKind: editingRule.targetKind,
      targetValue: editingRule.targetValue,
      priority: String(editingRule.priority),
      shippingAvailable: editingRule.shippingAvailable,
      localDeliveryAvailable: editingRule.localDeliveryAvailable,
      pickupAvailable: editingRule.pickupAvailable,
    } : EMPTY_FORM);
  }, [editingRule]);
  const saving = navigation.state !== "idle";
  const pendingIntent = String(navigation.formData?.get("intent") ?? "");
  const pendingId = Number(navigation.formData?.get("id") ?? 0);
  const savePending = pendingIntent === "save";
  const enabledRules = rules.filter((rule) => rule.enabled).length;
  const restrictedServices = rules.reduce((total, rule) => total
    + Number(!rule.shippingAvailable)
    + Number(!rule.localDeliveryAvailable)
    + Number(!rule.pickupAvailable), 0);
  const targetHelp = form.targetKind === "product"
    ? "Enter the numeric Shopify product ID."
    : form.targetKind === "collection"
      ? "Enter the collection handle, for example sale-items."
      : form.targetKind === "vendor"
        ? "Enter the vendor name."
        : "Enter the exact product tag.";

  const visibleRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((rule) => `${rule.name} ${rule.targetKind} ${rule.targetValue}`.toLowerCase().includes(q));
  }, [rules, search]);

  const enabledCount = [form.shippingAvailable, form.localDeliveryAvailable, form.pickupAvailable].filter(Boolean).length;

  return (
    <Page
      title="Service availability rules"
      subtitle="ETADeliverPickup premium control for Shipping, Local delivery and Store pickup."
      backAction={{ content: "Delivery & pickup", url: "/app/locations" }}
      titleMetadata={<Badge tone={access.features.targeting ? "success" : "info"}>{access.features.targeting ? "Standard" : "Subscription required"}</Badge>}
    >
      <BlockStack gap="500">
        <div className="incode-hero service-hero">
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <img src="/eta-deliver-pickup-logo.svg" alt="ETADeliverPickup logo" width={40} height={40} />
              <Badge tone="info">Independent from date rules</Badge>
              <Badge tone="success">{`${enabledRules}/${rules.length} enabled`}</Badge>
            </InlineStack>
            <InlineStack align="space-between" blockAlign="end" gap="400">
              <BlockStack gap="100">
                <Text as="h1" variant="heading2xl">Show the right service for every product.</Text>
                <div className="incode-hero__copy">
                  <Text as="p" variant="bodyLg">Match one catalog group, then allow only the services shoppers can actually use. Lower priority wins on overlap.</Text>
                </div>
              </BlockStack>
              <InlineStack gap="200">
                <Button url="/app/locations" variant="secondary">Delivery & pickup</Button>
                <Button url="/app/delivery-settings?tab=products" variant="primary">Product date rules</Button>
              </InlineStack>
            </InlineStack>
            <ProgressBar progress={rules.length ? Math.round((enabledRules / rules.length) * 100) : 0} size="small" tone="primary" />
          </BlockStack>
        </div>

        {actionData ? <Banner tone={actionData.ok ? "success" : "critical"} title={actionData.ok ? "Service rules updated" : "Could not update service rules"}>{actionData.message}</Banner> : null}
        {editNotFound ? <Banner tone="warning" title="Service rule not found" action={{ content: "Clear edit link", url: "/app/service-rules" }}>The requested rule is unavailable or does not belong to this shop. No changes were made.</Banner> : null}
        <Banner tone="info" title="Dates stay untouched">
          These rules only show or hide Shipping, Local delivery and Pickup. Processing days, transit days, messages and PIN protection stay under Delivery settings → Product rules.
        </Banner>

        <div className="service-metrics">
          <Card><div className="service-metric"><span className="service-metric__icon">📦</span><div><Text as="p" variant="heading2xl" fontWeight="bold">{rules.length}</Text><Text as="p" tone="subdued" variant="bodySm">Total rules</Text></div><Badge>{rules.length ? "Configured" : "Empty"}</Badge></div></Card>
          <Card><div className="service-metric"><span className="service-metric__icon">✅</span><div><Text as="p" variant="heading2xl" fontWeight="bold">{enabledRules}</Text><Text as="p" tone="subdued" variant="bodySm">Enabled rules</Text></div><Badge tone="success">Live</Badge></div></Card>
          <Card><div className="service-metric"><span className="service-metric__icon">🚫</span><div><Text as="p" variant="heading2xl" fontWeight="bold">{restrictedServices}</Text><Text as="p" tone="subdued" variant="bodySm">Blocked service choices</Text></div><Badge tone={restrictedServices ? "critical" : undefined}>Guarded</Badge></div></Card>
        </div>

        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              <Card>
                <Form method="post">
                  <input type="hidden" name="intent" value="save" />
                  <input type="hidden" name="id" value={editingRule?.id ?? ""} />
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="h2" variant="headingLg">{editingRule ? `Edit ${editingRule.name}` : "Create service rule"}</Text>
                        <Text as="p" tone="subdued">Match one catalog group, then choose allowed services. Preview updates live.</Text>
                      </BlockStack>
                      <Badge tone="info">{`Priority ${form.priority || "100"}`}</Badge>
                    </InlineStack>
                    <FormLayout>
                      <FormLayout.Group>
                        <TextField label="Rule name" name="name" value={form.name} onChange={(name) => setForm((current) => ({ ...current, name }))} maxLength={60} autoComplete="off" placeholder="Bulky furniture — pickup only" />
                        <TextField label="Priority" name="priority" type="number" min={0} max={9999} value={form.priority} onChange={(priority) => setForm((current) => ({ ...current, priority }))} helpText="Lower wins when multiple rules match." autoComplete="off" />
                      </FormLayout.Group>
                      <FormLayout.Group>
                        <Select label="Match" name="targetKind" value={form.targetKind} onChange={(targetKind) => setForm((current) => ({ ...current, targetKind, targetValue: "" }))} options={[{ label: "Product", value: "product" }, { label: "Collection", value: "collection" }, { label: "Vendor", value: "vendor" }, { label: "Product tag", value: "tag" }]} />
                        <TextField label="Target value" name="targetValue" value={form.targetValue} onChange={(targetValue) => setForm((current) => ({ ...current, targetValue }))} helpText={targetHelp} autoComplete="off" placeholder={form.targetKind === "product" ? "1234567890" : form.targetKind === "collection" ? "sale-items" : form.targetKind === "vendor" ? "Acme" : "bulky"} />
                      </FormLayout.Group>
                    </FormLayout>
                    <div className="service-toggles">
                      {SERVICE_META.map((service) => {
                        const active = form[service.key];
                        return (
                          <label key={service.key} className={`service-toggle${active ? " is-on" : " is-off"}`}>
                            <input type="checkbox" name={service.key} value="1" checked={active} onChange={(event) => setForm((current) => ({ ...current, [service.key]: event.currentTarget.checked }))} />
                            <span className="service-toggle__icon">{service.icon}</span>
                            <span><strong>{service.title}</strong><small>{service.desc}</small></span>
                            <span className={`service-toggle__state${active ? " is-on" : ""}`}>{active ? "ON" : "OFF"}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="service-preview">
                      <Text as="p" variant="bodySm" tone="subdued">Shopper will see:</Text>
                      <InlineStack gap="200">
                        {enabledCount === 0 ? <Badge tone="critical">No services — shoppers see unavailable</Badge> : null}
                        {form.shippingAvailable ? <Badge tone="success">Shipping</Badge> : null}
                        {form.localDeliveryAvailable ? <Badge tone="success">Local delivery</Badge> : null}
                        {form.pickupAvailable ? <Badge tone="success">Store pickup</Badge> : null}
                      </InlineStack>
                    </div>
                    <InlineStack gap="200">
                      <Button submit variant="primary" loading={savePending} disabled={!access.features.targeting || saving}>{editingRule ? "Save service rule" : "Create service rule"}</Button>
                      {editingRule ? <Button url="/app/service-rules" disabled={saving}>Cancel</Button> : null}
                    </InlineStack>
                  </BlockStack>
                </Form>
              </Card>

              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="end" gap="300" wrap>
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingLg">Configured service rules</Text>
                    <Text as="p" tone="subdued">Lower priority numbers win. Toggle instantly without deleting.</Text>
                  </BlockStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={enabledRules ? "success" : "info"}>{`${enabledRules} enabled`}</Badge>
                  </InlineStack>
                </InlineStack>
                <TextField label="Search rules" labelHidden value={search} onChange={setSearch} autoComplete="off" placeholder="Search name, target or value…" />
                {visibleRules.length ? visibleRules.map((rule) => (
                  <div key={rule.id} className={`service-rule-card${rule.enabled ? "" : " is-disabled"}`}>
                    <div className="service-rule-card__main">
                      <span className="service-rule-card__priority" title="Priority">#{rule.priority}</span>
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center"><Text as="h3" variant="headingMd">{rule.name}</Text>{rule.enabled ? <Badge tone="success">Enabled</Badge> : <Badge>Disabled</Badge>}</InlineStack>
                        <Text as="p" tone="subdued">{rule.targetKind}: {rule.targetValue}</Text>
                        <InlineStack gap="200" wrap>
                          <Badge tone={rule.shippingAvailable ? "success" : undefined}>{`Shipping ${rule.shippingAvailable ? "on" : "off"}`}</Badge>
                          <Badge tone={rule.localDeliveryAvailable ? "success" : undefined}>{`Delivery ${rule.localDeliveryAvailable ? "on" : "off"}`}</Badge>
                          <Badge tone={rule.pickupAvailable ? "success" : undefined}>{`Pickup ${rule.pickupAvailable ? "on" : "off"}`}</Badge>
                        </InlineStack>
                      </BlockStack>
                    </div>
                    <InlineStack gap="200" wrap>
                      <Button size="slim" url={`/app/service-rules?edit=${rule.id}`} disabled={saving}>Edit</Button>
                      <Form method="post"><input type="hidden" name="intent" value="toggle" /><input type="hidden" name="id" value={rule.id} /><Button submit size="slim" disabled={saving} loading={pendingIntent === "toggle" && pendingId === rule.id}>{rule.enabled ? "Disable" : "Enable"}</Button></Form>
                      <Form method="post" onSubmit={(event) => { if (!window.confirm(`Delete service rule "${rule.name}"?`)) event.preventDefault(); }}><input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={rule.id} /><Button submit size="slim" tone="critical" disabled={saving} loading={pendingIntent === "delete" && pendingId === rule.id}>Delete</Button></Form>
                    </InlineStack>
                  </div>
                )) : (
                  <Card><BlockStack gap="200" inlineAlign="center">
                    <Text as="h3" variant="headingMd">{rules.length ? "No rules match search" : "No service rules yet"}</Text>
                    <Text as="p" tone="subdued">{rules.length ? "Clear search to see all rules." : "Matching products currently use global and location defaults. Create your first premium rule above."}</Text>
                    {rules.length ? <Button onClick={() => setSearch("")}>Clear search</Button> : null}
                  </BlockStack></Card>
                )}
              </BlockStack>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card><BlockStack gap="200">
                <Text as="h2" variant="headingMd">How priority works</Text>
                <Text as="p" tone="subdued">Example: Priority 10 bulky-tag blocks Shipping, Priority 100 default allows all. Product matching both uses Priority 10.</Text>
              </BlockStack></Card>
              <Card><BlockStack gap="200">
                <Text as="h2" variant="headingMd">Real-store test</Text>
                <Text as="p" tone="subdued">1. Create rule for one product. 2. Open product page. 3. Confirm only allowed tabs appear. 4. Remove rule and confirm tabs return.</Text>
                <Button url="/app/additional" fullWidth>Open setup guide</Button>
              </BlockStack></Card>
              <Card><BlockStack gap="200">
                <Text as="h2" variant="headingMd">Safety</Text>
                <Text as="p" tone="subdued">Toggle disables instantly, delete is permanent with confirm. Cache clears automatically on every change.</Text>
              </BlockStack></Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
