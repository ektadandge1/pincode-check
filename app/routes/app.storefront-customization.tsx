import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
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
import { isSafeStorefrontCss } from "../utils/custom-css";
import { authenticate } from "../shopify.server";

type Customization = {
  storefrontFontFamily: string;
  storefrontFontSize: number;
  storefrontHeadingSize: number;
  storefrontTextColor: string;
  storefrontMutedColor: string;
  storefrontAccentColor: string;
  storefrontButtonColor: string;
  storefrontButtonTextColor: string;
  storefrontCardBackground: string;
  storefrontJourneyBackground: string;
  storefrontJourneyActiveColor: string;
  storefrontJourneyLineColor: string;
  storefrontJourneyLineStyle: string;
  storefrontTemplate: string;
  storefrontBorderRadius: number;
  storefrontIconStyle: string;
  storefrontAnimation: string;
  storefrontShowJourney: boolean;
  storefrontCustomCss: string;
};

type ActionData = { ok: boolean; message: string };

const DEFAULTS: Customization = {
  storefrontFontFamily: "system",
  storefrontFontSize: 14,
  storefrontHeadingSize: 18,
  storefrontTextColor: "#16151a",
  storefrontMutedColor: "#667085",
  storefrontAccentColor: "#2b2640",
  storefrontButtonColor: "#2b2640",
  storefrontButtonTextColor: "#ffffff",
  storefrontCardBackground: "#ffffff",
  storefrontJourneyBackground: "#e6edff",
  storefrontJourneyActiveColor: "#9bb8f2",
  storefrontJourneyLineColor: "#f28c52",
  storefrontJourneyLineStyle: "dotted",
  storefrontTemplate: "modern-card",
  storefrontBorderRadius: 14,
  storefrontIconStyle: "number",
  storefrontAnimation: "soft",
  storefrontShowJourney: true,
  storefrontCustomCss: "",
};

const FONT_OPTIONS = [
  { label: "System / Shopify native", value: "system" },
  { label: "Inter", value: "inter" },
  { label: "Poppins", value: "poppins" },
  { label: "DM Sans", value: "dm-sans" },
  { label: "Plus Jakarta Sans", value: "jakarta" },
];

const ICON_OPTIONS = [
  { label: "Numbered steps", value: "number" },
  { label: "Premium outline icons", value: "delivery" },
  { label: "Soft duotone icons", value: "duotone" },
  { label: "Minimal dots", value: "minimal" },
  { label: "Friendly emoji", value: "emoji" },
];

const ANIMATION_OPTIONS = [
  { label: "Staggered reveal", value: "soft" },
  { label: "Route progress pulse", value: "route" },
  { label: "Icon heartbeat", value: "pulse" },
  { label: "Floating icons", value: "float" },
  { label: "Elegant shimmer", value: "shimmer" },
  { label: "No animation", value: "none" },
];

const LINE_OPTIONS = [
  { label: "Dotted timeline", value: "dotted" },
  { label: "Dashed timeline", value: "dashed" },
  { label: "Solid timeline", value: "solid" },
  { label: "No connector", value: "none" },
];

const TEMPLATE_OPTIONS = [
  { label: "Modern delivery card", value: "modern-card" },
  { label: "Soft segmented journey", value: "soft-segments" },
  { label: "Pastel connected timeline", value: "pastel-timeline" },
  { label: "Fresh progress track", value: "progress-track" },
  { label: "Bold ring milestones", value: "ring-milestones" },
  { label: "Cyan arrow steps", value: "cyan-arrows" },
  { label: "Warm illustrated steps", value: "warm-steps" },
  { label: "Compact delivery strip", value: "compact-strip" },
  { label: "Countdown spotlight", value: "countdown-focus" },
];

const STOREFRONT_SURFACES = [
  ["Product page", "product"],
  ["Collection page", "collection"],
  ["Cart page", "cart"],
  ["Home page", "index"],
  ["Search page", "search"],
  ["Other pages", "page"],
] as const;

const TEMPLATE_PRESETS: Record<string, Partial<Customization>> = {
  "modern-card": { storefrontCardBackground: "#ffffff", storefrontJourneyBackground: "#e6edff", storefrontJourneyActiveColor: "#9bb8f2", storefrontJourneyLineColor: "#5979bd", storefrontJourneyLineStyle: "none", storefrontIconStyle: "number", storefrontAnimation: "soft", storefrontBorderRadius: 14 },
  "soft-segments": { storefrontCardBackground: "#eef3ff", storefrontJourneyBackground: "#dce7ff", storefrontJourneyActiveColor: "#9bb8f2", storefrontJourneyLineColor: "#6f8fcf", storefrontJourneyLineStyle: "none", storefrontIconStyle: "duotone", storefrontAnimation: "soft", storefrontBorderRadius: 16 },
  "pastel-timeline": { storefrontCardBackground: "#fff5fc", storefrontJourneyBackground: "#f8def4", storefrontJourneyActiveColor: "#ffffff", storefrontJourneyLineColor: "#b25bac", storefrontJourneyLineStyle: "solid", storefrontIconStyle: "duotone", storefrontAnimation: "route", storefrontBorderRadius: 16 },
  "progress-track": { storefrontCardBackground: "#fbfff2", storefrontJourneyBackground: "#f4ffe3", storefrontJourneyActiveColor: "#ffffff", storefrontJourneyLineColor: "#648c1e", storefrontJourneyLineStyle: "solid", storefrontIconStyle: "minimal", storefrontAnimation: "route", storefrontBorderRadius: 12 },
  "ring-milestones": { storefrontCardBackground: "#f8f8f8", storefrontJourneyBackground: "#ffffff", storefrontJourneyActiveColor: "#ffffff", storefrontJourneyLineColor: "#151515", storefrontJourneyLineStyle: "solid", storefrontIconStyle: "delivery", storefrontAnimation: "pulse", storefrontBorderRadius: 8 },
  "cyan-arrows": { storefrontCardBackground: "#edffff", storefrontJourneyBackground: "#cfffff", storefrontJourneyActiveColor: "#ffffff", storefrontJourneyLineColor: "#28bcc5", storefrontJourneyLineStyle: "solid", storefrontIconStyle: "duotone", storefrontAnimation: "soft", storefrontBorderRadius: 2 },
  "warm-steps": { storefrontCardBackground: "#fff8e9", storefrontJourneyBackground: "#fff1d6", storefrontJourneyActiveColor: "#ffffff", storefrontJourneyLineColor: "#8a6338", storefrontJourneyLineStyle: "solid", storefrontIconStyle: "delivery", storefrontAnimation: "float", storefrontBorderRadius: 12 },
  "compact-strip": { storefrontCardBackground: "#effdfa", storefrontJourneyBackground: "#d9faf3", storefrontJourneyActiveColor: "#ffffff", storefrontJourneyLineColor: "#188f7c", storefrontJourneyLineStyle: "dotted", storefrontIconStyle: "minimal", storefrontAnimation: "route", storefrontBorderRadius: 12 },
  "countdown-focus": { storefrontCardBackground: "#edfaff", storefrontJourneyBackground: "#ffffff", storefrontJourneyActiveColor: "#ffffff", storefrontJourneyLineColor: "#47b9dd", storefrontJourneyLineStyle: "solid", storefrontIconStyle: "minimal", storefrontAnimation: "pulse", storefrontBorderRadius: 16 },
};

function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function readCustomization(setting: Partial<Customization> | null): Customization {
  return { ...DEFAULTS, ...(setting ?? {}) };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const setting = await prisma.deliverySetting.findUnique({ where: { shop: session.shop } });
  return { shop: session.shop, apiKey: process.env.SHOPIFY_API_KEY || "", customization: readCustomization(setting) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const customization = {
    storefrontFontFamily: String(formData.get("storefrontFontFamily") ?? "system"),
    storefrontFontSize: Number(formData.get("storefrontFontSize") ?? 14),
    storefrontHeadingSize: Number(formData.get("storefrontHeadingSize") ?? 18),
    storefrontTextColor: String(formData.get("storefrontTextColor") ?? "").trim(),
    storefrontMutedColor: String(formData.get("storefrontMutedColor") ?? "").trim(),
    storefrontAccentColor: String(formData.get("storefrontAccentColor") ?? "").trim(),
    storefrontButtonColor: String(formData.get("storefrontButtonColor") ?? "").trim(),
    storefrontButtonTextColor: String(formData.get("storefrontButtonTextColor") ?? "").trim(),
    storefrontCardBackground: String(formData.get("storefrontCardBackground") ?? "").trim(),
    storefrontJourneyBackground: String(formData.get("storefrontJourneyBackground") ?? "").trim(),
    storefrontJourneyActiveColor: String(formData.get("storefrontJourneyActiveColor") ?? "").trim(),
    storefrontJourneyLineColor: String(formData.get("storefrontJourneyLineColor") ?? "").trim(),
    storefrontJourneyLineStyle: String(formData.get("storefrontJourneyLineStyle") ?? "dotted"),
    storefrontTemplate: String(formData.get("storefrontTemplate") ?? "modern-card"),
    storefrontBorderRadius: Number(formData.get("storefrontBorderRadius") ?? 14),
    storefrontIconStyle: String(formData.get("storefrontIconStyle") ?? "number"),
    storefrontAnimation: String(formData.get("storefrontAnimation") ?? "soft"),
    storefrontShowJourney: formData.has("storefrontShowJourney"),
    storefrontCustomCss: String(formData.get("storefrontCustomCss") ?? "").trim(),
  } satisfies Customization;

  if (!FONT_OPTIONS.some((option) => option.value === customization.storefrontFontFamily)) {
    return { ok: false, message: "Choose a supported storefront font." } satisfies ActionData;
  }
  if (!ICON_OPTIONS.some((option) => option.value === customization.storefrontIconStyle)) {
    return { ok: false, message: "Choose a supported icon style." } satisfies ActionData;
  }
  if (!ANIMATION_OPTIONS.some((option) => option.value === customization.storefrontAnimation)) {
    return { ok: false, message: "Choose a supported animation." } satisfies ActionData;
  }
  if (!LINE_OPTIONS.some((option) => option.value === customization.storefrontJourneyLineStyle)) {
    return { ok: false, message: "Choose a supported journey connector." } satisfies ActionData;
  }
  if (!TEMPLATE_OPTIONS.some((option) => option.value === customization.storefrontTemplate)) {
    return { ok: false, message: "Choose a supported storefront template." } satisfies ActionData;
  }
  if (!Number.isInteger(customization.storefrontFontSize) || customization.storefrontFontSize < 12 || customization.storefrontFontSize > 18) {
    return { ok: false, message: "Body font size must be between 12 and 18 pixels." } satisfies ActionData;
  }
  if (!Number.isInteger(customization.storefrontHeadingSize) || customization.storefrontHeadingSize < 16 || customization.storefrontHeadingSize > 28) {
    return { ok: false, message: "Heading size must be between 16 and 28 pixels." } satisfies ActionData;
  }
  if (!Number.isInteger(customization.storefrontBorderRadius) || customization.storefrontBorderRadius < 0 || customization.storefrontBorderRadius > 28) {
    return { ok: false, message: "Corner radius must be between 0 and 28 pixels." } satisfies ActionData;
  }
  const colors = [
    customization.storefrontTextColor,
    customization.storefrontMutedColor,
    customization.storefrontAccentColor,
    customization.storefrontButtonColor,
    customization.storefrontButtonTextColor,
    customization.storefrontCardBackground,
    customization.storefrontJourneyBackground,
    customization.storefrontJourneyActiveColor,
    customization.storefrontJourneyLineColor,
  ];
  if (colors.some((color) => !isHex(color))) {
    return { ok: false, message: "Use six-digit hex colors such as #2B2640." } satisfies ActionData;
  }
  if (!isSafeStorefrontCss(customization.storefrontCustomCss)) {
    return { ok: false, message: "Custom CSS must be 5,000 characters or fewer and cannot load external URLs, imports, or scripts." } satisfies ActionData;
  }

  try {
    await prisma.deliverySetting.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, ...customization },
      update: customization,
    });
  } catch (error) {
    console.error("Unable to save storefront customization", error);
    return {
      ok: false,
      message: "Storefront style could not be saved. Refresh the app and try again.",
    } satisfies ActionData;
  }

  return { ok: true, message: "Storefront style saved." } satisfies ActionData;
}

function fontFamily(value: string): string {
  return {
    system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    inter: "Inter, system-ui, sans-serif",
    poppins: "Poppins, system-ui, sans-serif",
    "dm-sans": "'DM Sans', system-ui, sans-serif",
    jakarta: "'Plus Jakarta Sans', system-ui, sans-serif",
  }[value] ?? "system-ui, sans-serif";
}

function JourneyIcon({ step, style }: { step: number; style: string }) {
  if (style === "emoji") return <>{["🛒", "📦", "🏠"][step]}</>;
  if (style === "number") return <>{step + 1}</>;
  if (style === "minimal") return <span className="incode-custom-preview__dot" />;

  const paths = [
    <><circle cx="9" cy="19" r="1.5" /><circle cx="18" cy="19" r="1.5" /><path d="M3 4h2l2.4 10.1a2 2 0 0 0 2 1.5h7.8a2 2 0 0 0 1.9-1.4L21 8H7" /></>,
    <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="M4 7v10l8 4 8-4V7M12 11v10" /><path d="m8 5 8 4" /></>,
    <><path d="m3 11 9-8 9 8" /><path d="M5.5 9.5V21h13V9.5M9 21v-7h6v7" /><path d="M16 6V3h2v5" /></>,
  ];
  return <svg viewBox="0 0 24 24" aria-hidden="true"><g className={style === "duotone" ? "is-duotone" : undefined}>{paths[step]}</g></svg>;
}

export default function StorefrontCustomizationPage() {
  const { customization, shop, apiKey } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const [form, setForm] = useState(customization);
  const update = <K extends keyof Customization>(key: K, value: Customization[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const applyTemplate = (value: string) => {
    setForm((current) => ({
      ...current,
      ...TEMPLATE_PRESETS[value],
      storefrontTemplate: value,
    }));
  };
  const themeEditorUrl = (template: string) =>
    `https://${shop}/admin/themes/current/editor?template=${template}&addAppBlockId=${apiKey}/delivery-checker&target=mainSection`;
  const appEmbedEditorUrl = `https://${shop}/admin/themes/current/editor?context=apps&template=product&activateAppId=${apiKey}/delivery-checker-embed`;

  return (
    <Page title="Storefront style" subtitle="Create a polished delivery experience that matches your brand.">
      <fetcher.Form method="post">
        <BlockStack gap="500">
          {fetcher.data ? <Banner tone={fetcher.data.ok ? "success" : "critical"}>{fetcher.data.message}</Banner> : null}
          <Layout>
            <Layout.Section>
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">ETA everywhere shoppers decide</Text>
                      <Text as="p" tone="subdued">Add the same delivery widget to product, collection, cart, home, search, and content pages. Checkout is intentionally excluded.</Text>
                    </BlockStack>
                    <InlineStack gap="200" wrap>
                      <Button url={appEmbedEditorUrl} target="_blank" variant="primary">Enable everywhere</Button>
                      {STOREFRONT_SURFACES.map(([label, template]) => (
                        <Button key={template} url={themeEditorUrl(template)} target="_blank">Add to {label}</Button>
                      ))}
                    </InlineStack>
                    <Text as="p" tone="subdued" variant="bodySm">Thank-you and order-status estimates are available through the Delivery estimate surfaces extension in Shopify’s checkout editor. Do not add an extension to checkout.</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Template library</Text>
                      <Text as="p" tone="subdued">Start with a complete delivery design, then customize every detail below.</Text>
                    </BlockStack>
                    <Select label="Storefront template" name="storefrontTemplate" options={TEMPLATE_OPTIONS} value={form.storefrontTemplate} onChange={applyTemplate} />
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Typography</Text>
                      <Text as="p" tone="subdued">Use a confident type system without changing your theme code.</Text>
                    </BlockStack>
                    <FormLayout.Group condensed>
                      <Select label="Font family" name="storefrontFontFamily" options={FONT_OPTIONS} value={form.storefrontFontFamily} onChange={(value) => update("storefrontFontFamily", value)} />
                      <TextField label="Body size" name="storefrontFontSize" type="number" min={12} max={18} suffix="px" value={String(form.storefrontFontSize)} onChange={(value) => update("storefrontFontSize", Number(value))} autoComplete="off" />
                      <TextField label="Heading size" name="storefrontHeadingSize" type="number" min={16} max={28} suffix="px" value={String(form.storefrontHeadingSize)} onChange={(value) => update("storefrontHeadingSize", Number(value))} autoComplete="off" />
                    </FormLayout.Group>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Brand colors</Text>
                      <Text as="p" tone="subdued">Set a clear hierarchy for text, action, cards, and the delivery journey.</Text>
                    </BlockStack>
                    <FormLayout.Group condensed>
                      {([
                        ["storefrontTextColor", "Text color"],
                        ["storefrontMutedColor", "Muted text"],
                        ["storefrontAccentColor", "Accent color"],
                        ["storefrontButtonColor", "Button color"],
                        ["storefrontButtonTextColor", "Button text"],
                        ["storefrontCardBackground", "Main widget background"],
                        ["storefrontJourneyBackground", "Journey panel background"],
                        ["storefrontJourneyActiveColor", "Active step"],
                        ["storefrontJourneyLineColor", "Connector line"],
                      ] as Array<[keyof Customization, string]>).map(([key, label]) => (
                        <InlineStack key={key} gap="200" blockAlign="end" wrap={false}>
                          <input className="incode-color-input" type="color" value={String(form[key])} onChange={(event) => update(key, event.currentTarget.value)} aria-label={label} />
                          <TextField label={label} name={key} value={String(form[key])} onChange={(value) => update(key, value)} autoComplete="off" />
                        </InlineStack>
                      ))}
                    </FormLayout.Group>
                    <TextField label="Corner radius" name="storefrontBorderRadius" type="number" min={0} max={28} suffix="px" value={String(form.storefrontBorderRadius)} onChange={(value) => update("storefrontBorderRadius", Number(value))} autoComplete="off" />
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Delivery journey</Text>
                      <Text as="p" tone="subdued">Choose the visual language shoppers see after a successful PIN check.</Text>
                    </BlockStack>
                    <FormLayout.Group condensed>
                      <Select label="Step icons" name="storefrontIconStyle" options={ICON_OPTIONS} value={form.storefrontIconStyle} onChange={(value) => update("storefrontIconStyle", value)} />
                      <Select label="Animation" name="storefrontAnimation" options={ANIMATION_OPTIONS} value={form.storefrontAnimation} onChange={(value) => update("storefrontAnimation", value)} />
                      <Select label="Icon connector" name="storefrontJourneyLineStyle" options={LINE_OPTIONS} value={form.storefrontJourneyLineStyle} onChange={(value) => update("storefrontJourneyLineStyle", value)} />
                    </FormLayout.Group>
                    <Checkbox label="Show Order now, Ready to ship, and At your doorstep" name="storefrontShowJourney" checked={form.storefrontShowJourney} onChange={(value) => update("storefrontShowJourney", value)} />
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Developer CSS</Text>
                      <Text as="p" tone="subdued">Optional CSS for advanced visual adjustments. External URLs, imports, and scripts are blocked. Arbitrary JavaScript is intentionally not supported.</Text>
                    </BlockStack>
                    <TextField
                      label="Custom CSS"
                      name="storefrontCustomCss"
                      value={form.storefrontCustomCss}
                      onChange={(value) => update("storefrontCustomCss", value)}
                      multiline={8}
                      maxLength={5000}
                      showCharacterCount
                      autoComplete="off"
                      placeholder={".pin-checker__heading { letter-spacing: 0.02em; }"}
                    />
                    <Button submit variant="primary" loading={fetcher.state !== "idle"}>Save storefront style</Button>
                  </BlockStack>
                </Card>
              </BlockStack>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Live preview</Text>
                    <span className="incode-preview-live">LIVE</span>
                  </InlineStack>
                  <div
                    className={`incode-custom-preview incode-custom-preview--${form.storefrontAnimation}`}
                    data-template={form.storefrontTemplate}
                    style={{
                      fontFamily: fontFamily(form.storefrontFontFamily),
                      fontSize: `${form.storefrontFontSize}px`,
                      color: form.storefrontTextColor,
                      background: form.storefrontCardBackground,
                      borderColor: form.storefrontAccentColor,
                      borderRadius: `${form.storefrontBorderRadius}px`,
                    }}
                  >
                    <span className="incode-custom-preview__eyebrow" style={{ color: form.storefrontAccentColor }}>DELIVERY CHECKER</span>
                    <strong style={{ fontSize: `${form.storefrontHeadingSize}px` }}>Receive your order by Oct 05</strong>
                    <span style={{ color: form.storefrontMutedColor }}>Pune, Maharashtra · 411001</span>
                    {form.storefrontShowJourney ? (
                      <div
                        className="incode-custom-preview__journey"
                        data-line-style={form.storefrontJourneyLineStyle}
                        style={{
                          background: form.storefrontJourneyBackground,
                          "--incode-line-color": form.storefrontJourneyLineColor,
                        } as React.CSSProperties}
                      >
                        {[
                          ["1", "Order now"],
                          ["2", "Ready to ship"],
                          ["3", "At your doorstep"],
                        ].map(([, label], index) => (
                          <div
                            key={label}
                            className={index === 0 ? "is-active" : ""}
                            style={index === 0 && form.storefrontJourneyLineStyle === "none" ? { background: form.storefrontJourneyActiveColor } : undefined}
                          >
                            <span><JourneyIcon step={index} style={form.storefrontIconStyle} /></span>
                            <small>{label}</small>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {form.storefrontTemplate === "countdown-focus" ? (
                      <div className="incode-custom-preview__countdown">
                        <strong>03</strong><small>Days</small>
                        <strong>18</strong><small>Hours</small>
                        <strong>05</strong><small>Minutes</small>
                        <strong>29</strong><small>Seconds</small>
                      </div>
                    ) : null}
                    <button type="button" style={{ background: form.storefrontButtonColor, color: form.storefrontButtonTextColor, borderRadius: `${Math.max(8, form.storefrontBorderRadius - 2)}px` }}>Check delivery</button>
                  </div>
                  <Text as="p" tone="subdued" variant="bodySm">Save changes, then refresh your product page to see the live storefront style.</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </BlockStack>
      </fetcher.Form>
    </Page>
  );
}
