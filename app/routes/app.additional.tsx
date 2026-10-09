import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { requireActiveBilling } from "../services/billing.server";
import { supportContact } from "../utils/public-contact.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await requireActiveBilling(request);
  const { contactEmail: supportEmail } = supportContact();
  return {
    shop: session.shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    supportEmail,
  };
};

type GuideStep = {
  title: string;
  desc: string;
  tip: string;
  url: string;
  action: string;
  external?: boolean;
};

function GuideCard({
  id,
  badge,
  title,
  subtitle,
  time,
  steps,
  checklistTitle,
  checklist,
}: {
  id: string;
  badge: string;
  title: string;
  subtitle: string;
  time: string;
  steps: GuideStep[];
  checklistTitle: string;
  checklist: string[];
}) {
  return (
    <Card>
      <BlockStack gap="400">
        <div className="guide-card__head">
          <span className="guide-card__badge">{badge}</span>
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingLg">{title}</Text>
              <Badge tone="info">{time}</Badge>
            </InlineStack>
            <Text as="p" tone="subdued">{subtitle}</Text>
          </BlockStack>
        </div>
        <div className="guide-steps" id={id}>
          {steps.map((step, index) => (
            <div className="guide-step" key={step.title}>
              <span className="guide-step__number">{index + 1}</span>
              <BlockStack gap="100">
                <Text as="h3" fontWeight="semibold">{step.title}</Text>
                <Text as="p" tone="subdued">{step.desc}</Text>
                <Text as="p" variant="bodySm" tone="subdued"><span className="guide-tip">Tip:</span> {step.tip}</Text>
              </BlockStack>
              <Button url={step.url} external={step.external} size="slim">{step.action}</Button>
            </div>
          ))}
        </div>
        <div className="guide-checklist">
          <Text as="h3" fontWeight="semibold">{checklistTitle}</Text>
          <List type="bullet">
            {checklist.map((item) => (
              <List.Item key={item}>{item}</List.Item>
            ))}
          </List>
        </div>
      </BlockStack>
    </Card>
  );
}

export default function AdditionalPage() {
  const { shop, apiKey, supportEmail } = useLoaderData<typeof loader>();
  const shopHandle = shop.replace(/\.myshopify\.com$/i, "");
  const themeEditorUrl = `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=product&addAppBlockId=${apiKey}/delivery-checker&target=mainSection`;
  const serviceTabsEditorUrl = `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=product&addAppBlockId=${apiKey}/delivery-service-options&target=mainSection`;
  const serviceTabsCartEditorUrl = `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=cart&addAppBlockId=${apiKey}/delivery-service-options&target=mainSection`;

  const dateCheckSteps: GuideStep[] = [
    { title: "Set delivery timing", desc: "Timezone, cutoff hour, processing days, delivery window, weekends and holidays.", tip: "Start with Asia/Kolkata + 2pm cutoff if you ship same-day.", url: "/app/delivery-settings?tab=timing", action: "Configure" },
    { title: "Add PIN / ZIP coverage", desc: "Create exact codes, ranges and wildcards, or upload CSV up to 100,000 rows.", tip: "Use 400001 exact first, then add 40000-40999 range later.", url: "/app/delivery-settings?tab=coverage", action: "Add coverage" },
    { title: "Style messages + ETA", desc: "Success, unavailable and COD messages, colors, button, ETA and journey display.", tip: "Keep unavailable message short and actionable.", url: "/app/storefront-customization", action: "Style" },
    { title: "Add theme block", desc: "Add Check delivery availability block to the published product template.", tip: "Publish the template, not only a draft, then test mobile.", url: themeEditorUrl, action: "Open editor", external: true },
    { title: "Test two pincodes", desc: "One serviceable code must show dates, one bad code must show unavailable.", tip: "Test 400001 and 999999 before telling shoppers.", url: "/app/analytics", action: "Verify" },
    { title: "Protect checkout (optional)", desc: "Require valid PIN or disable Add to Cart, add email snippet for order confirmation.", tip: "Enable PIN protection only after coverage is complete.", url: "/app/delivery-settings?tab=products", action: "Protect" },
  ];

  const serviceSteps: GuideStep[] = [
    { title: "Enable locations", desc: "Enable fulfillment location, set priority and processing / transit days.", tip: "Location must be Active and fulfil online orders in Shopify.", url: "/app/locations", action: "Enable" },
    { title: "Configure Local Delivery", desc: "Country + All zones / selected zones / postcode list. Details form shows only when available.", tip: "Outside zone = error only, no details form. That is correct.", url: "/app/locations", action: "Set delivery" },
    { title: "Configure Store Pickup", desc: "Phone, instructions, prep days, weekdays, blocked dates and advance window.", tip: "Dates come only from server — blocked dates never show.", url: "/app/locations", action: "Set pickup" },
    { title: "Configure Shipping estimate", desc: "Shipping tab reuses coverage for fallback estimate and delivery date.", tip: "If shipping shows unavailable, check coverage first.", url: "/app/delivery-settings?tab=coverage", action: "Check" },
    { title: "Add Product block", desc: "Add Local delivery & pickup to the published product template.", tip: "Shopify requires the merchant to activate theme app blocks.", url: serviceTabsEditorUrl, action: "Open product editor", external: true },
    { title: "Add Cart block", desc: "Add the same block to the published cart template. It moves above Checkout when the theme supports it.", tip: "Product and Cart are separate Shopify templates, so activate both.", url: serviceTabsCartEditorUrl, action: "Open cart editor", external: true },
    { title: "Test all 3 tabs + fulfillment", desc: "Test Shipping, Pickup with date + contact save, Delivery with address + contact save.", tip: "Check Delivery & pickup orders view for saved customer details.", url: "/app/locations?view=pickups", action: "Review orders" },
  ];

  return (
    <Page title="Setup guide" subtitle="Two guided setups for ETADeliverPickup. Launch fast without guesswork.">
      <BlockStack gap="500">
        <Banner title="Recommended order: A then B" tone="info">
          Delivery Date Check creates the coverage that Shipping and Local Delivery reuse. Do not publish the theme block until coverage is added.
        </Banner>

        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              <GuideCard
                id="guide-a"
                badge="A"
                title="Delivery Date Check Setup"
                subtitle="PIN / ZIP checker on product pages with accurate dates, COD and cart protection."
                time="About 10 minutes"
                steps={dateCheckSteps}
                checklistTitle="Guide A done when:"
                checklist={[
                  "Serviceable PIN shows date range, e.g. 400001 shows Oct 12 to Oct 14.",
                  "Bad PIN shows unavailable message and Add to Cart behaves as configured.",
                  "Block is on published product template on desktop and mobile.",
                  "Analytics shows masked region, no customer email stored.",
                ]}
              />
              <GuideCard
                id="guide-b"
                badge="B"
                title="Delivery, Pickup, Shipping Setup"
                subtitle="Service tabs with validated customer details saved to Shopify cart attributes."
                time="About 15 minutes"
                steps={serviceSteps}
                checklistTitle="Guide B done when:"
                checklist={[
                  "Shipping tab estimates correctly for covered PINs.",
                  "Pickup saves location + date + name + email + phone.",
                  "Delivery shows details form only when available, hides on outside-zone.",
                  "Switching tabs clears old service attributes, no stale selection.",
                ]}
              />
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingLg">CSV reference</Text>
                  <Text as="p" tone="subdued">
                    Required columns: <strong>country</strong>, <strong>postal_code</strong>, and <strong>delivery_days</strong>. Imports accept up to 100,000 rows.
                  </Text>
                  <code className="incode-code">country,postal_code,delivery_days,serviceable,cod_available,delivery_charge,currency,city,state,zone,same_day,next_day,express{"\n"}US,10001,2,true,true,8,USD,New York,New York,metro,true,true,true{"\n"}US,10000-10999,3,true,false,10,USD,,,metro,false,false,false{"\n"}GB,SW1A*,3,true,false,5,GBP,London,,london,false,false,true</code>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Exact like 400001, range like 10000-10999, wildcard like SW1A*.
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingLg">Order confirmation email</Text>
                  <Text as="p" tone="subdued">Shopify Admin → Settings → Notifications → Order confirmation. Shows validated delivery range saved with cart.</Text>
                  <code className="incode-code">{"{% for attribute in attributes %}\n  {% if attribute.first == '_incode_delivery_date_range' and attribute.last != blank %}\n    <p><strong>Estimated delivery:</strong> {{ attribute.last }}</p>\n  {% endif %}\n{% endfor %}"}</code>
                  <Banner tone="warning">Email shows only after a successful ZIP check saved a current delivery range. Test notification first.</Banner>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Widget not visible?</Text>
                  <Text as="p" tone="subdued">Confirm block is on published product template, not only draft. Reload Theme Editor after save.</Text>
                  <Button url={themeEditorUrl} external fullWidth>Open Theme Editor</Button>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Every code unavailable?</Text>
                  <Text as="p" tone="subdued">Check country, DB fallback ON, and an enabled rule or zone matches the code.</Text>
                  <Button url="/app/delivery-settings?tab=coverage" fullWidth>Review coverage</Button>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Delivery form hidden?</Text>
                  <Text as="p" tone="subdued">Correct behavior: outside-zone or unavailable hides First name, Email, Phone. Form appears only after availability succeeds.</Text>
                  <Button url="/app/locations" fullWidth>Check zones</Button>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Support</Text>
                  <Text as="p" tone="subdued">
                    {supportEmail ? "Include shop domain, product URL and sample PIN." : "Use support contact in App Store listing."}
                  </Text>
                  {supportEmail ? <Button url={`mailto:${supportEmail}`} fullWidth>Email {supportEmail}</Button> : null}
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
