import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useBeforeUnload, useBlocker, useFetcher, useLoaderData } from "react-router";
import {
  Banner,
  Badge,
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
import { requireActiveBilling } from "../services/billing.server";
import { clearDeliveryCheckCaches } from "../services/delivery-checker.server";

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
  storefrontFieldBackground: string;
  storefrontFieldBorderColor: string;
  storefrontResultBackground: string;
  storefrontResultTextColor: string;
  storefrontJourneyBackground: string;
  storefrontJourneyActiveColor: string;
  storefrontJourneyLineColor: string;
  storefrontJourneyLineStyle: string;
  storefrontTemplate: string;
  storefrontBorderRadius: number;
  storefrontIconStyle: string;
  storefrontAnimation: string;
  storefrontShowJourney: boolean;
  storefrontEtaDisplayMode: string;
  storefrontCountdownBackground: string;
  storefrontCountdownDigitColor: string;
  storefrontCountdownTextColor: string;
  storefrontCountdownTitle: string;
  countdownEnabled: boolean;
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
  storefrontFieldBackground: "#ffffff",
  storefrontFieldBorderColor: "#d7d9dd",
  storefrontResultBackground: "#171717",
  storefrontResultTextColor: "#ffffff",
  storefrontJourneyBackground: "#e6edff",
  storefrontJourneyActiveColor: "#9bb8f2",
  storefrontJourneyLineColor: "#f28c52",
  storefrontJourneyLineStyle: "dotted",
  storefrontTemplate: "modern-card",
  storefrontBorderRadius: 14,
  storefrontIconStyle: "number",
  storefrontAnimation: "soft",
  storefrontShowJourney: true,
  storefrontEtaDisplayMode: "both",
  storefrontCountdownBackground: "#06451f",
  storefrontCountdownDigitColor: "#ff6500",
  storefrontCountdownTextColor: "#ffffff",
  storefrontCountdownTitle: "Order cutoff countdown",
  countdownEnabled: true,
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
  { label: "Standard checkmarks", value: "number" },
  { label: "Premium delivery icons", value: "delivery" },
  { label: "Advanced duotone icons", value: "duotone" },
  { label: "Circular badges", value: "circle" },
  { label: "Simple minimal dots", value: "minimal" },
  { label: "Friendly emoji icons", value: "emoji" },
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

const ETA_CONTENT_SECTIONS = ["date", "journey"] as const;

const TEMPLATE_OPTIONS = [
  { label: "ZIP checker + ETA journey", value: "modern-card" },
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
  ["Cart page", "cart"],
] as const;

const TEMPLATE_PRESETS: Record<string, Partial<Customization>> = {
  "modern-card": { storefrontAccentColor: "#f45d08", storefrontButtonColor: "#f45d08", storefrontButtonTextColor: "#111111", storefrontCardBackground: "#ffffff", storefrontFieldBackground: "#ffffff", storefrontFieldBorderColor: "#d7d9dd", storefrontResultBackground: "#171717", storefrontResultTextColor: "#ffffff", storefrontJourneyBackground: "#ffffff", storefrontJourneyActiveColor: "#ffffff", storefrontJourneyLineColor: "#333333", storefrontJourneyLineStyle: "dotted", storefrontIconStyle: "delivery", storefrontAnimation: "soft", storefrontBorderRadius: 12, storefrontCountdownBackground: "#06451f", storefrontCountdownDigitColor: "#ff6500", storefrontCountdownTextColor: "#ffffff" },
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

function normalizeEtaSections(value: string | undefined): string {
  const sections = new Set(
    value === "both"
      ? ["date", "journey"]
      : String(value ?? "").split(",").map((section) => section.trim()).filter(Boolean),
  );
  const normalized = ETA_CONTENT_SECTIONS.filter((section) => sections.has(section));
  return (normalized.length > 0 ? normalized : ["date", "journey"]).join(",");
}

function readCustomization(setting: Partial<Customization> | null): Customization {
  const customization = { ...DEFAULTS, ...(setting ?? {}) };
  customization.storefrontEtaDisplayMode = normalizeEtaSections(
    customization.storefrontEtaDisplayMode,
  );
  return customization;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await requireActiveBilling(request);
  const setting = await prisma.deliverySetting.findUnique({ where: { shop: session.shop } });
  return { shop: session.shop, apiKey: process.env.SHOPIFY_API_KEY || "", customization: readCustomization(setting) };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await requireActiveBilling(request);
  const formData = await request.formData();
  const existing = await prisma.deliverySetting.findUnique({ where: { shop: session.shop } });
  const storefrontEtaDisplayMode = normalizeEtaSections(
    String(formData.get("storefrontEtaDisplayMode") ?? ""),
  );
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
    storefrontFieldBackground: String(formData.get("storefrontFieldBackground") ?? "").trim(),
    storefrontFieldBorderColor: String(formData.get("storefrontFieldBorderColor") ?? "").trim(),
    storefrontResultBackground: String(formData.get("storefrontResultBackground") ?? "").trim(),
    storefrontResultTextColor: String(formData.get("storefrontResultTextColor") ?? "").trim(),
    storefrontJourneyBackground: String(formData.get("storefrontJourneyBackground") ?? "").trim(),
    storefrontJourneyActiveColor: String(formData.get("storefrontJourneyActiveColor") ?? "").trim(),
    storefrontJourneyLineColor: String(formData.get("storefrontJourneyLineColor") ?? "").trim(),
    storefrontJourneyLineStyle: String(formData.get("storefrontJourneyLineStyle") ?? "dotted"),
    storefrontTemplate: String(formData.get("storefrontTemplate") ?? "modern-card"),
    storefrontBorderRadius: Number(formData.get("storefrontBorderRadius") ?? 14),
    storefrontIconStyle: String(formData.get("storefrontIconStyle") ?? "number"),
    storefrontAnimation: String(formData.get("storefrontAnimation") ?? "soft"),
    storefrontShowJourney: storefrontEtaDisplayMode.split(",").includes("journey"),
    storefrontEtaDisplayMode,
    storefrontCountdownBackground: String(formData.get("storefrontCountdownBackground") ?? "").trim(),
    storefrontCountdownDigitColor: String(formData.get("storefrontCountdownDigitColor") ?? "").trim(),
    storefrontCountdownTextColor: String(formData.get("storefrontCountdownTextColor") ?? "").trim(),
    storefrontCountdownTitle: String(formData.get("storefrontCountdownTitle") ?? existing?.storefrontCountdownTitle ?? DEFAULTS.storefrontCountdownTitle).trim(),
    countdownEnabled: existing?.countdownEnabled ?? DEFAULTS.countdownEnabled,
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
  const etaSections = customization.storefrontEtaDisplayMode.split(",");
  if (etaSections.length === 0 || etaSections.some((section) => !ETA_CONTENT_SECTIONS.includes(section as typeof ETA_CONTENT_SECTIONS[number]))) {
    return { ok: false, message: "Choose at least one supported automatic ETA section." } satisfies ActionData;
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
    customization.storefrontFieldBackground,
    customization.storefrontFieldBorderColor,
    customization.storefrontResultBackground,
    customization.storefrontResultTextColor,
    customization.storefrontJourneyBackground,
    customization.storefrontJourneyActiveColor,
    customization.storefrontJourneyLineColor,
    customization.storefrontCountdownBackground,
    customization.storefrontCountdownDigitColor,
    customization.storefrontCountdownTextColor,
  ];
  if (colors.some((color) => !isHex(color))) {
    return { ok: false, message: "Use six-digit hex colors such as #2B2640." } satisfies ActionData;
  }
  if (!isSafeStorefrontCss(customization.storefrontCustomCss)) {
    return { ok: false, message: "Custom CSS must be 5,000 characters or fewer and cannot load external URLs, imports, or scripts." } satisfies ActionData;
  }
  const countdownEnabledForStyle = existing?.countdownEnabled ?? DEFAULTS.countdownEnabled;
  if (countdownEnabledForStyle && !customization.storefrontCountdownTitle) {
    return { ok: false, message: "Countdown heading is required when the countdown is enabled, and must be 80 characters or fewer." } satisfies ActionData;
  }
  if (customization.storefrontCountdownTitle.length > 80) {
    return { ok: false, message: "Countdown heading must be 80 characters or fewer." } satisfies ActionData;
  }

  try {
    const { countdownEnabled: _omitCountdown, ...storefrontStyle } = customization;
    void _omitCountdown;
    await prisma.deliverySetting.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, ...customization },
      update: storefrontStyle,
    });
  } catch (error) {
    console.error("Unable to save storefront customization", error);
    return {
      ok: false,
      message: "Storefront style could not be saved. Refresh the app and try again.",
    } satisfies ActionData;
  }

  clearDeliveryCheckCaches(session.shop);
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
  if (style === "circle") return <span className="incode-custom-preview__circle-icon">{step + 1}</span>;

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
  const dirty = JSON.stringify(form) !== JSON.stringify(customization);
  useBeforeUnload((event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  useBlocker(() => dirty && !window.confirm("Leave with unsaved storefront style changes?"));
  const [previewSurface, setPreviewSurface] = useState<string>("product");
  const experienceMode = "checker" as const;
  const [previewChecked, setPreviewChecked] = useState(false);
  const previewSavedPostal = "10001";
  const previewLabel = STOREFRONT_SURFACES.find(([, template]) => template === previewSurface)?.[0] ?? "Product page";
  const previewExperienceMode: string = experienceMode;
  const selectedEtaSections = form.storefrontEtaDisplayMode.split(",");
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
  const toggleEtaSection = (section: typeof ETA_CONTENT_SECTIONS[number], checked: boolean) => {
    setForm((current) => {
      const sections = new Set(current.storefrontEtaDisplayMode.split(",").filter(Boolean));
      if (checked) sections.add(section);
      else sections.delete(section);
      if (sections.size === 0) return current;
      const storefrontEtaDisplayMode = ETA_CONTENT_SECTIONS.filter((value) => sections.has(value)).join(",");
      return {
        ...current,
        storefrontEtaDisplayMode,
        storefrontShowJourney: sections.has("journey"),
      };
    });
  };
  const shopHandle = shop.replace(/\.myshopify\.com$/i, "");
  const themeEditorUrl = (template: string) => {
    const blockHandle = "delivery-checker";
    return `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=${template}&addAppBlockId=${apiKey}/${blockHandle}&target=mainSection`;
  };
  const placementEditorUrl = (template: string) => themeEditorUrl(template);
  const placementButtonLabel = () => "Add delivery availability";

  return (
      <Page title="Storefront style" subtitle="Match the delivery block to your store.">
      <fetcher.Form method="post">
        <BlockStack gap="500">
          {fetcher.data ? <Banner tone={fetcher.data.ok ? "success" : "critical"}>{fetcher.data.message}</Banner> : null}
          <Layout>
            <Layout.Section>
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Add the block</Text>
                      <Text as="p" tone="subdued">Add it to product or cart pages.</Text>
                    </BlockStack>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">Placement</Text>
                      <div className="incode-placement-grid">
                        {([
                          ["product", "Product page", "Near Add to Cart"],
                          ["cart", "Cart page", "Before checkout"],
                        ] as const).map(([template, label, description]) => (
                          <div key={template} className={`incode-placement-card${previewSurface === template ? " is-selected" : ""}`}>
                            <button type="button" onClick={() => { setPreviewSurface(template); setPreviewChecked(false); }}>
                              <strong>{label}</strong>
                              <small>{description}</small>
                            </button>
                            <Button url={placementEditorUrl(template)} target="_blank" variant={previewSurface === template ? "primary" : "secondary"} onClick={() => { setPreviewSurface(template); setPreviewChecked(false); }}>
                              {placementButtonLabel()}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </BlockStack>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Design</Text>
                    </BlockStack>
                    <Select label="Storefront template" name="storefrontTemplate" options={TEMPLATE_OPTIONS} value={form.storefrontTemplate} onChange={applyTemplate} />
                    <InlineStack align="end">
                      <Button submit variant="primary" loading={fetcher.state !== "idle"}>Save changes</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Text</Text>
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
                      <Text as="h2" variant="headingLg">Checker</Text>
                    </BlockStack>
                    <div className="incode-color-grid">
                      {([
                        ["storefrontTextColor", "Text color"],
                        ["storefrontMutedColor", "Supporting text"],
                        ["storefrontAccentColor", "Focus and accent"],
                        ["storefrontButtonColor", "Check button"],
                        ["storefrontButtonTextColor", "Button text"],
                        ["storefrontCardBackground", "Checker background"],
                        ["storefrontFieldBackground", "Input and selector background"],
                        ["storefrontFieldBorderColor", "Input and selector border"],
                      ] as Array<[keyof Customization, string]>).map(([key, label]) => (
                        <div key={key} className="incode-color-field">
                          <input className="incode-color-input" type="color" value={String(form[key])} onChange={(event) => update(key, event.currentTarget.value)} aria-label={label} />
                          <TextField label={label} name={key} value={String(form[key])} onChange={(value) => update(key, value)} autoComplete="off" />
                        </div>
                      ))}
                    </div>
                    <TextField label="Corner radius" name="storefrontBorderRadius" type="number" min={0} max={28} suffix="px" value={String(form.storefrontBorderRadius)} onChange={(value) => update("storefrontBorderRadius", Number(value))} autoComplete="off" />
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Delivery result</Text>
                    </BlockStack>
                    <div className="incode-color-grid">
                      {([
                        ["storefrontResultBackground", "Result strip background"],
                        ["storefrontResultTextColor", "Result strip text"],
                        ["storefrontJourneyBackground", "Journey panel background"],
                        ["storefrontJourneyActiveColor", "Active step background"],
                        ["storefrontJourneyLineColor", "Connector line"],
                      ] as Array<[keyof Customization, string]>).map(([key, label]) => (
                        <div key={key} className="incode-color-field">
                          <input className="incode-color-input" type="color" value={String(form[key])} onChange={(event) => update(key, event.currentTarget.value)} aria-label={label} />
                          <TextField label={label} name={key} value={String(form[key])} onChange={(value) => update(key, value)} autoComplete="off" />
                        </div>
                      ))}
                    </div>
                    <FormLayout.Group condensed>
                      <Select label="Icons" name="storefrontIconStyle" options={ICON_OPTIONS} value={form.storefrontIconStyle} onChange={(value) => update("storefrontIconStyle", value)} />
                      <Select label="Animation" name="storefrontAnimation" options={ANIMATION_OPTIONS} value={form.storefrontAnimation} onChange={(value) => update("storefrontAnimation", value)} />
                      <Select label="Icon connector" name="storefrontJourneyLineStyle" options={LINE_OPTIONS} value={form.storefrontJourneyLineStyle} onChange={(value) => update("storefrontJourneyLineStyle", value)} />
                    </FormLayout.Group>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Show</Text>
                       <Text as="p" tone="subdued">Select at least one option.</Text>
                      <InlineStack gap="400" wrap>
                        <Checkbox label="Delivery date" checked={selectedEtaSections.includes("date")} onChange={(checked) => toggleEtaSection("date", checked)} />
                        <Checkbox label="Delivery journey" checked={selectedEtaSections.includes("journey")} onChange={(checked) => toggleEtaSection("journey", checked)} />
                      </InlineStack>
                      <input type="hidden" name="storefrontEtaDisplayMode" value={form.storefrontEtaDisplayMode} readOnly />
                    </BlockStack>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Countdown</Text>
                      <Text as="p" tone="subdued">Style the cutoff countdown.</Text>
                    </BlockStack>
                     <Banner tone="info" action={{ content: "Manage visibility", url: "/app/delivery-settings?tab=optional#countdown" }}>Visibility is managed in Delivery settings.</Banner>
                      <TextField label="Countdown heading" name="storefrontCountdownTitle" value={form.storefrontCountdownTitle} onChange={(value) => update("storefrontCountdownTitle", value)} maxLength={80} autoComplete="off" />
                    <div className="incode-color-grid">
                      {([
                        ["storefrontCountdownBackground", "Panel background"],
                        ["storefrontCountdownDigitColor", "Number tile background"],
                        ["storefrontCountdownTextColor", "Countdown text"],
                      ] as Array<[keyof Customization, string]>).map(([key, label]) => (
                        <div key={key} className="incode-color-field">
                          <input className="incode-color-input" type="color" value={String(form[key])} onChange={(event) => update(key, event.currentTarget.value)} aria-label={label} />
                          <TextField label={label} name={key} value={String(form[key])} onChange={(value) => update(key, value)} autoComplete="off" />
                        </div>
                      ))}
                    </div>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="300">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingLg">Advanced CSS</Text>
                      <Text as="p" tone="subdued">Optional CSS. External files and scripts are blocked.</Text>
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
                    <Text as="h2" variant="headingMd">Style preview</Text>
                    <span className="incode-preview-live">SIMULATED</span>
                  </InlineStack>
                  <InlineStack gap="200" wrap>
                    <Badge>{previewLabel}</Badge>
                  </InlineStack>
                  <div className="incode-preview-tabs" role="tablist" aria-label="Preview page type">
                    {STOREFRONT_SURFACES.map(([label, template]) => (
                      <button
                        key={template}
                        type="button"
                        role="tab"
                        aria-selected={previewSurface === template}
                        className={previewSurface === template ? "is-selected" : ""}
                        onClick={() => { setPreviewSurface(template); setPreviewChecked(false); }}
                      >
                        {label.replace(" page", "")}
                      </button>
                    ))}
                  </div>
                  <div className="incode-preview-surface" aria-live="polite" aria-atomic="true">
                    <div className="incode-preview-surface__context" data-surface={previewSurface}>
                      {previewSurface === "product" ? (
                        <>
                          <div className="incode-storefront-mock__bar"><span>Northstar Supply</span><span>⌕ &nbsp; ♡ &nbsp; 🛒</span></div>
                          <div className="incode-product-mock">
                            <div className="incode-product-mock__image">Canvas<br />tote</div>
                            <div className="incode-product-mock__details"><strong>Everyday canvas tote</strong><span>$39.00 · In stock</span><small>{previewExperienceMode === "checker" ? "Delivery check near Add to Cart" : "Automatic ETA below product details"}</small><button type="button">Add to cart</button></div>
                          </div>
                        </>
                      ) : previewSurface === "cart" ? (
                        <><div className="incode-storefront-mock__bar"><span>Your cart</span><span>2 items</span></div><div className="incode-cart-mock"><span className="incode-cart-mock__thumb">Tote</span><span><b>Everyday canvas tote × 2</b><small>$78.00</small><em>{previewExperienceMode === "checker" ? "Check delivery before checkout" : "Estimated delivery: Oct 8–10"}</em></span></div><div className="incode-cart-mock__total"><span>Total</span><b>$78.00</b></div></>
                      ) : null}
                    </div>
                  </div>
                  <div
                    key={`${previewSurface}-${experienceMode}`}
                    className={`incode-custom-preview incode-custom-preview--${form.storefrontAnimation}`}
                    data-surface={previewSurface}
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
                    <strong style={{ fontSize: `${form.storefrontHeadingSize}px` }}>{previewExperienceMode === "checker" ? "Check delivery to your address" : "Estimated delivery"}</strong>
                    <span className="incode-custom-preview__saved" style={{ color: form.storefrontMutedColor }}>Using saved address: <strong>{previewSavedPostal}</strong></span>
                    {previewExperienceMode === "checker" ? (
                      <>
                        <span style={{ color: form.storefrontMutedColor }}>Enter your ZIP or postal code to see delivery dates.</span>
                        <div className="incode-custom-preview__country" style={{ background: form.storefrontFieldBackground, borderColor: form.storefrontFieldBorderColor }}>🇺🇸 United States <span>⌄</span></div>
                        <div className="incode-custom-preview__checker">
                          <span style={{ background: form.storefrontFieldBackground, borderColor: form.storefrontFieldBorderColor }}>Enter ZIP code · 10001</span>
                          <button type="button" style={{ background: form.storefrontButtonColor, color: form.storefrontButtonTextColor }} onClick={() => setPreviewChecked(true)}>Check</button>
                        </div>
                        {previewChecked || Boolean(previewSavedPostal)
                          ? <div className="incode-custom-preview__result" style={{ background: form.storefrontResultBackground, color: form.storefrontResultTextColor }}>📦 Delivery between Oct 6th and Oct 8th</div>
                          : <div className="incode-custom-preview__locked" style={{ borderColor: form.storefrontFieldBorderColor, color: form.storefrontMutedColor }}>Delivery date appears here after a successful ZIP check</div>}
                      </>
                    ) : selectedEtaSections.includes("date") ? (
                      <div className="incode-custom-preview__result" style={{ background: form.storefrontResultBackground, color: form.storefrontResultTextColor }}>📦 Delivery between Oct 6th and Oct 8th</div>
                    ) : null}
                    {selectedEtaSections.includes("journey") && (previewExperienceMode === "automatic" || previewChecked || Boolean(previewSavedPostal)) ? (
                      <div className="incode-custom-preview__journey-shell" style={{ background: form.storefrontJourneyBackground, borderColor: form.storefrontFieldBorderColor }}>
                        <strong>🇺🇸 Estimated Delivery Date&nbsp; Oct 9th to Oct 10th</strong>
                        <div
                          className="incode-custom-preview__journey"
                          data-line-style={form.storefrontJourneyLineStyle}
                          style={{ "--incode-line-color": form.storefrontJourneyLineColor } as React.CSSProperties}
                        >
                          {[
                            ["Order confirmed", "Oct 5th"],
                            ["Shipped", "Oct 7th"],
                            ["At your doorstep", "Oct 10th"],
                          ].map(([label, date], index) => (
                            <div key={label} className={index === 0 ? "is-active" : ""}>
                              <span style={{ background: index === 0 ? form.storefrontJourneyActiveColor : form.storefrontCardBackground }}><JourneyIcon step={index} style={form.storefrontIconStyle} /></span>
                              <small>{label}</small>
                              <small>{date}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {form.countdownEnabled && (previewExperienceMode === "automatic" || previewChecked || Boolean(previewSavedPostal)) ? <div className="incode-custom-preview__countdown" style={{ background: form.storefrontCountdownBackground, color: form.storefrontCountdownTextColor }}>
                      <strong>🔥 {form.storefrontCountdownTitle} 🔥</strong>
                      <div>
                        {[["07", "Hours"], ["27", "Minutes"], ["46", "Seconds"]].map(([value, label]) => (
                          <span key={label}><b style={{ background: form.storefrontCountdownDigitColor }}>{value}</b><small>{label}</small></span>
                        ))}
                      </div>
                      <strong>Get it by Oct 6th - Oct 8th</strong>
                    </div> : null}
                  </div>
                  <Text as="p" tone="subdued" variant="bodySm">Sample preview only. Your theme may look different.</Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </BlockStack>
      </fetcher.Form>
    </Page>
  );
}
