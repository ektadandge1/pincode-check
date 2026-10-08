import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useEffect, useState } from "react";
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

export default function ServiceRulesPage() {
  const { access, rules, editingRule, editNotFound } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const [form, setForm] = useState(EMPTY_FORM);
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

  return (
    <Page
      title="Service availability rules"
      subtitle="Control Shipping, Local delivery, and Store pickup without changing delivery-date estimates."
      backAction={{ content: "Delivery & pickup", url: "/app/locations" }}
      titleMetadata={<Badge tone={access.features.targeting ? "success" : "info"}>{access.features.targeting ? "Standard" : "Subscription required"}</Badge>}
    >
      <BlockStack gap="400">
        {actionData ? <Banner tone={actionData.ok ? "success" : "critical"} title={actionData.ok ? "Service rules updated" : "Could not update service rules"}>{actionData.message}</Banner> : null}
        {editNotFound ? <Banner tone="warning" title="Service rule not found" action={{ content: "Clear edit link", url: "/app/service-rules" }}>The requested rule is unavailable or does not belong to this shop. No changes were made.</Banner> : null}
        <Banner tone="info" title="Independent from delivery-date rules">
          These rules only show or hide fulfillment services. Processing days, transit days, delivery messages, and PIN protection remain under Delivery settings → Product rules.
        </Banner>
        <div className="incode-service-rule-metrics" aria-label="Service rule summary">
          <div><strong>{rules.length}</strong><span>Total rules</span></div>
          <div><strong>{enabledRules}</strong><span>Enabled rules</span></div>
          <div><strong>{restrictedServices}</strong><span>Blocked service choices</span></div>
        </div>
        <div className="incode-service-rule-editor"><Card>
          <Form method="post">
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="id" value={editingRule?.id ?? ""} />
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingLg">{editingRule ? `Edit ${editingRule.name}` : "Create service rule"}</Text>
                <Text as="p" tone="subdued">Match one catalog group, then choose the fulfillment services shoppers can use.</Text>
              </BlockStack>
              <FormLayout>
                <FormLayout.Group>
                  <TextField label="Rule name" name="name" value={form.name} onChange={(name) => setForm((current) => ({ ...current, name }))} maxLength={60} autoComplete="off" />
                  <TextField label="Priority" name="priority" type="number" min={0} max={9999} value={form.priority} onChange={(priority) => setForm((current) => ({ ...current, priority }))} helpText="Lower wins when multiple rules match." autoComplete="off" />
                </FormLayout.Group>
                <FormLayout.Group>
                  <Select label="Match" name="targetKind" value={form.targetKind} onChange={(targetKind) => setForm((current) => ({ ...current, targetKind, targetValue: "" }))} options={[{ label: "Product", value: "product" }, { label: "Collection", value: "collection" }, { label: "Vendor", value: "vendor" }, { label: "Product tag", value: "tag" }]} />
                  <TextField label="Target value" name="targetValue" value={form.targetValue} onChange={(targetValue) => setForm((current) => ({ ...current, targetValue }))} helpText={targetHelp} autoComplete="off" />
                </FormLayout.Group>
                <Text as="h3" variant="headingMd">Services available for matching products</Text>
                <InlineStack gap="400" wrap>
                  <Checkbox label="Shipping" name="shippingAvailable" checked={form.shippingAvailable} onChange={(shippingAvailable) => setForm((current) => ({ ...current, shippingAvailable }))} />
                  <Checkbox label="Local delivery" name="localDeliveryAvailable" checked={form.localDeliveryAvailable} onChange={(localDeliveryAvailable) => setForm((current) => ({ ...current, localDeliveryAvailable }))} />
                  <Checkbox label="Store pickup" name="pickupAvailable" checked={form.pickupAvailable} onChange={(pickupAvailable) => setForm((current) => ({ ...current, pickupAvailable }))} />
                </InlineStack>
              </FormLayout>
              <InlineStack gap="200">
                <Button submit variant="primary" loading={savePending} disabled={!access.features.targeting || saving}>{editingRule ? "Save service rule" : "Create service rule"}</Button>
                {editingRule ? <Button url="/app/service-rules" disabled={saving}>Cancel</Button> : null}
              </InlineStack>
            </BlockStack>
          </Form>
        </Card></div>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="end" gap="300" wrap>
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">Configured service rules</Text>
              <Text as="p" tone="subdued">Lower priority numbers win when more than one rule matches.</Text>
            </BlockStack>
            <Badge tone={enabledRules ? "success" : "info"}>{`${enabledRules} enabled`}</Badge>
          </InlineStack>
          {rules.length ? rules.map((rule) => (
            <div key={rule.id} className={`incode-service-rule-card${rule.enabled ? "" : " is-disabled"}`}><Card>
              <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center"><Text as="h3" variant="headingMd">{rule.name}</Text>{rule.enabled ? <Badge tone="success">Enabled</Badge> : <Badge>Disabled</Badge>}</InlineStack>
                  <Text as="p" tone="subdued">{rule.targetKind}: {rule.targetValue} · Priority {rule.priority}</Text>
                  <InlineStack gap="200" wrap>
                    <Badge tone={rule.shippingAvailable ? "success" : undefined}>{`Shipping ${rule.shippingAvailable ? "available" : "blocked"}`}</Badge>
                    <Badge tone={rule.localDeliveryAvailable ? "success" : undefined}>{`Local delivery ${rule.localDeliveryAvailable ? "available" : "blocked"}`}</Badge>
                    <Badge tone={rule.pickupAvailable ? "success" : undefined}>{`Store pickup ${rule.pickupAvailable ? "available" : "blocked"}`}</Badge>
                  </InlineStack>
                </BlockStack>
                <InlineStack gap="200" wrap>
                  <Button size="slim" url={`/app/service-rules?edit=${rule.id}`} disabled={saving}>Edit</Button>
                  <Form method="post"><input type="hidden" name="intent" value="toggle" /><input type="hidden" name="id" value={rule.id} /><Button submit size="slim" disabled={saving} loading={pendingIntent === "toggle" && pendingId === rule.id}>{rule.enabled ? "Disable" : "Enable"}</Button></Form>
                  <Form method="post" onSubmit={(event) => { if (!window.confirm(`Delete service rule "${rule.name}"?`)) event.preventDefault(); }}><input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={rule.id} /><Button submit size="slim" tone="critical" disabled={saving} loading={pendingIntent === "delete" && pendingId === rule.id}>Delete</Button></Form>
                </InlineStack>
              </InlineStack>
            </Card></div>
          )) : <div className="incode-service-rule-empty"><Card><BlockStack gap="200" inlineAlign="center"><Text as="h3" variant="headingMd">No service rules yet</Text><Text as="p" tone="subdued">Matching products currently use the configured global and location defaults.</Text></BlockStack></Card></div>}
        </BlockStack>
      </BlockStack>
    </Page>
  );
}
