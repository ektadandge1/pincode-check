import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { Badge, Banner, BlockStack, Button, Card, Checkbox, FormLayout, InlineStack, Page, Select, Text, TextField } from "@shopify/polaris";
import prisma from "../db.server";
import { requireActiveBilling } from "../services/billing.server";
import { clearDeliveryCheckCaches } from "../services/delivery-checker.server";
import { resolvePlanAccess } from "../services/plan-access.server";
import { SHIPPING_METHOD_KINDS, shippingMethodHandle, validateShippingMethodFields } from "../utils/shipping-method";

type ActionData = { ok: boolean; message: string };
type Method = Awaited<ReturnType<typeof prisma.shippingMethodRule.findMany>>[number];
const KIND_OPTIONS = [
  { label: "Standard (all serviceable destinations)", value: "standard" },
  { label: "Express coverage", value: "express" },
  { label: "Same-day coverage", value: "same_day" },
  { label: "Next-day coverage", value: "next_day" },
  { label: "Local delivery at the selected location", value: "local" },
  { label: "Pickup at the selected location", value: "pickup" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const [access, methods, setting] = await Promise.all([
    resolvePlanAccess({ shop: session.shop, admin }),
    prisma.shippingMethodRule.findMany({ where: { shop: session.shop }, orderBy: [{ priority: "asc" }, { id: "asc" }] }),
    prisma.deliverySetting.findUnique({ where: { shop: session.shop } }),
  ]);
  return { access, methods, displayStyle: setting?.shippingMethodDisplayStyle === "dropdown" ? "dropdown" : "visual" };
}

export async function action({ request }: ActionFunctionArgs): Promise<ActionData> {
  const { admin, session } = await requireActiveBilling(request);
  const shop = session.shop;
  const access = await resolvePlanAccess({ shop, admin });
  if (!access.features.deliveryOptions) return { ok: false, message: "Shipping method estimates require an active Standard subscription." };
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "save_display_style") {
    const shippingMethodDisplayStyle = String(form.get("displayStyle") ?? "");
    if (!["visual", "dropdown"].includes(shippingMethodDisplayStyle)) return { ok: false, message: "Choose a supported display style." };
    await prisma.deliverySetting.upsert({ where: { shop }, create: { shop, shippingMethodDisplayStyle }, update: { shippingMethodDisplayStyle } });
    clearDeliveryCheckCaches(shop);
    return { ok: true, message: "Shipping method display saved." };
  }
  if (!["save_method", "delete_method"].includes(intent)) return { ok: false, message: "Unsupported action." };
  const idRaw = String(form.get("id") ?? "").trim();
  const id = idRaw ? Number(idRaw) : null;
  if ((id !== null && (!Number.isSafeInteger(id) || id <= 0)) || (intent === "delete_method" && id === null)) {
    return { ok: false, message: "Invalid shipping method." };
  }
  if (intent === "delete_method") {
    const deleted = await prisma.shippingMethodRule.deleteMany({ where: { id: id!, shop } });
    if (!deleted.count) return { ok: false, message: "Shipping method not found." };
    clearDeliveryCheckCaches(shop);
    return { ok: true, message: "Shipping method deleted." };
  }
  const parsed = validateShippingMethodFields(Object.fromEntries(form));
  if (parsed.error) return { ok: false, message: parsed.error };
  const data = { ...parsed.value!, enabled: ["on", "true", "1"].includes(String(form.get("enabled") ?? "")) };
  try {
    if (id === null) {
      if (await prisma.shippingMethodRule.count({ where: { shop } }) >= 50) return { ok: false, message: "You can configure up to 50 shipping method estimates. Edit or delete an existing rule first." };
      await prisma.shippingMethodRule.create({ data: { shop, ...data } });
    } else {
      const updated = await prisma.shippingMethodRule.updateMany({ where: { id, shop }, data });
      if (!updated.count) return { ok: false, message: "Shipping method not found." };
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return { ok: false, message: "A shipping method with this handle already exists for this shop." };
    }
    throw error;
  }
  clearDeliveryCheckCaches(shop);
  return { ok: true, message: id === null ? "Shipping method created." : "Shipping method saved." };
}

function MethodEditor({ method, disabled }: { method?: Method; disabled: boolean }) {
  const fetcher = useFetcher<ActionData>();
  const [form, setForm] = useState({
    name: method?.name ?? "", handle: method?.handle ?? "", kind: method?.kind ?? "standard",
    priority: String(method?.priority ?? 100), processingDays: String(method?.processingDays ?? ""),
    transitDays: String(method?.transitDays ?? 5), description: method?.description ?? "",
    customMessage: method?.customMessage ?? "", enabled: method?.enabled ?? true,
  });
  const update = (field: string, value: string | boolean) => setForm((current) => ({ ...current, [field]: value }));
  const busy = fetcher.state !== "idle";
  return (
    <Card>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="save_method" />
        <input type="hidden" name="id" value={method?.id ?? ""} />
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">{method ? method.name : "Add shipping method estimate"}</Text>
            {method ? <Badge tone={method.enabled ? "success" : undefined}>{method.enabled ? "Enabled" : "Disabled"}</Badge> : null}
          </InlineStack>
          {fetcher.data ? <Banner tone={fetcher.data.ok ? "success" : "critical"}>{fetcher.data.message}</Banner> : null}
          <FormLayout>
            <FormLayout.Group>
              <TextField label="Name" name="name" value={form.name} onChange={(value) => update("name", value)} disabled={disabled || busy} maxLength={100} autoComplete="off" />
              <TextField label="Handle" name="handle" value={form.handle} onChange={(value) => update("handle", value)} disabled={disabled || busy} autoComplete="off" helpText="Unique in this shop; 2-50 lowercase letters, numbers, hyphens or underscores." />
            </FormLayout.Group>
            {!method ? <Button disabled={disabled || busy || !form.name} onClick={() => update("handle", shippingMethodHandle(form.name))}>Generate handle from name</Button> : null}
            <Select label="Eligibility" name="kind" value={form.kind} onChange={(value) => update("kind", value)} disabled={disabled || busy} options={SHIPPING_METHOD_KINDS.includes(form.kind as typeof SHIPPING_METHOD_KINDS[number]) ? KIND_OPTIONS : [{ label: `Unsupported saved kind: ${form.kind}`, value: form.kind }, ...KIND_OPTIONS]} helpText="Express, same-day and next-day use postal coverage flags. Local delivery and pickup require eligible inventory-aware location routing." />
            <FormLayout.Group>
              <TextField label="Processing days override" name="processingDays" type="number" min={0} max={60} value={form.processingDays} onChange={(value) => update("processingDays", value)} disabled={disabled || busy} autoComplete="off" helpText="Blank uses the resolved product/location/shop processing time." />
              <TextField label="Transit days" name="transitDays" type="number" min={0} max={60} value={form.transitDays} onChange={(value) => update("transitDays", value)} disabled={disabled || busy} autoComplete="off" />
              <TextField label="Priority" name="priority" type="number" min={0} max={9999} value={form.priority} onChange={(value) => update("priority", value)} disabled={disabled || busy} autoComplete="off" helpText="Lower numbers display first." />
            </FormLayout.Group>
            <TextField label="Description" name="description" value={form.description} onChange={(value) => update("description", value)} disabled={disabled || busy} maxLength={250} autoComplete="off" />
            <TextField label="Custom message" name="customMessage" value={form.customMessage} onChange={(value) => update("customMessage", value)} disabled={disabled || busy} maxLength={500} multiline={2} autoComplete="off" helpText="Plain shopper-facing text, not a checkout rate or shortcode template." />
            <Checkbox label="Enabled" name="enabled" checked={form.enabled} onChange={(value) => update("enabled", value)} disabled={disabled || busy} />
            <InlineStack gap="200">
              <Button submit variant="primary" disabled={disabled} loading={busy}>{method ? "Save method" : "Add method"}</Button>
              {method ? <Button tone="critical" disabled={disabled || busy} onClick={() => {
                if (window.confirm(`Delete ${method.name}?`)) fetcher.submit({ intent: "delete_method", id: String(method.id) }, { method: "post" });
              }}>Delete method</Button> : null}
            </InlineStack>
          </FormLayout>
        </BlockStack>
      </fetcher.Form>
    </Card>
  );
}

export default function ShippingMethodsPage() {
  const { access, methods, displayStyle } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const [style, setStyle] = useState(displayStyle);
  const disabled = !access.features.deliveryOptions;
  return (
    <Page title="Shipping method estimates" subtitle="Manage the named delivery options returned by postal-code checks.">
      <BlockStack gap="400">
        <Banner tone="info" title="Estimates, not Shopify shipping rates">
          These merchant-defined rules label eligible storefront delivery estimates. They do not create, import, select, or change Shopify checkout rates. Configure actual rates in Shopify shipping settings.
        </Banner>
        {disabled ? <Banner tone="warning" action={{ content: "View plan", url: "/app/plans" }}>Activate Standard to manage shipping method estimates.</Banner> : null}
        <Card>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="save_display_style" />
            <BlockStack gap="300">
              {fetcher.data ? <Banner tone={fetcher.data.ok ? "success" : "critical"}>{fetcher.data.message}</Banner> : null}
              <Select label="Storefront display" name="displayStyle" value={style} onChange={setStyle} disabled={disabled} options={[{ label: "Visual options", value: "visual" }, { label: "Dropdown", value: "dropdown" }]} />
              <Button submit variant="primary" disabled={disabled} loading={fetcher.state !== "idle"}>Save display style</Button>
            </BlockStack>
          </fetcher.Form>
        </Card>
        {methods.map((method) => <MethodEditor key={`${method.id}:${method.updatedAt}`} method={method} disabled={disabled} />)}
        {!methods.length ? <Text as="p" tone="subdued">No shipping method rules yet. Add a standard estimate to start.</Text> : null}
        <MethodEditor key={`new:${methods.map((method) => method.id).join(",")}`} disabled={disabled} />
        <InlineStack gap="200">
          <Button url="/app/delivery-settings?tab=coverage">Review postal coverage</Button>
          <Button url="/app/locations">Configure local delivery and pickup</Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
