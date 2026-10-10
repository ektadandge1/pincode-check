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
    { title: "Set delivery timing", desc: "Set delivery timing and business days.", tip: "", url: "/app/delivery-settings?tab=timing", action: "Configure" },
    { title: "Add postal coverage", desc: "Add postal codes, ranges, or a CSV.", tip: "", url: "/app/delivery-settings?tab=coverage", action: "Add coverage" },
    { title: "Style the block", desc: "Edit shopper messages and styling.", tip: "", url: "/app/storefront-customization", action: "Style" },
    { title: "Add theme block", desc: "Add the block to your product template.", tip: "", url: themeEditorUrl, action: "Open editor", external: true },
    { title: "Test delivery", desc: "Test one available and one unavailable code.", tip: "", url: "/app/analytics", action: "Verify" },
    { title: "Protect checkout", desc: "Optionally require a valid postal code.", tip: "", url: "/app/delivery-settings?tab=products", action: "Protect" },
  ];

  const serviceSteps: GuideStep[] = [
    { title: "Enable locations", desc: "Choose a location and set delivery times.", tip: "", url: "/app/locations", action: "Enable" },
    { title: "Set local delivery", desc: "Choose local delivery coverage.", tip: "", url: "/app/locations", action: "Set delivery" },
    { title: "Set store pickup", desc: "Set pickup instructions and dates.", tip: "", url: "/app/locations", action: "Set pickup" },
    { title: "Check shipping", desc: "Confirm shipping coverage.", tip: "", url: "/app/delivery-settings?tab=coverage", action: "Check" },
    { title: "Add product block", desc: "Add the block to the product template.", tip: "", url: serviceTabsEditorUrl, action: "Open product editor", external: true },
    { title: "Add cart block", desc: "Add the block to the cart template.", tip: "", url: serviceTabsCartEditorUrl, action: "Open cart editor", external: true },
    { title: "Test services", desc: "Test shipping, pickup, and local delivery.", tip: "", url: "/app/locations?view=pickups", action: "Review orders" },
  ];

  return (
    <Page title="Setup guide" subtitle="Set up delivery checks, pickup, and local delivery.">
      <BlockStack gap="500">
        <Banner title="Start with delivery coverage" tone="info">
          Add coverage before publishing the storefront blocks.
        </Banner>

        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              <GuideCard
                id="guide-a"
                badge="A"
                title="Delivery check"
                subtitle="Show delivery dates and availability on product pages."
                time="About 10 minutes"
                steps={dateCheckSteps}
                checklistTitle="Guide A done when:"
                checklist={[
                  "Available and unavailable postal codes show the correct result.",
                  "The block is published and works on mobile.",
                ]}
              />
              <GuideCard
                id="guide-b"
                badge="B"
                title="Delivery and pickup"
                subtitle="Let shoppers choose shipping, pickup, or local delivery."
                time="About 15 minutes"
                steps={serviceSteps}
                checklistTitle="Guide B done when:"
                checklist={[
                  "Shipping, pickup, and delivery work as expected.",
                  "The selected service is saved with the order.",
                ]}
              />
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingLg">Order confirmation email</Text>
                  <Text as="p" tone="subdued">Add this snippet to Shopify&apos;s order confirmation template.</Text>
                  <code className="incode-code">{"{% for attribute in attributes %}\n  {% if attribute.first == '_incode_delivery_date_range' and attribute.last != blank %}\n    <p><strong>Estimated delivery:</strong> {{ attribute.last }}</p>\n  {% endif %}\n{% endfor %}"}</code>
                  <Banner tone="warning">Test the notification before using it.</Banner>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Widget not visible?</Text>
                   <Text as="p" tone="subdued">Check that the block is on the published template.</Text>
                  <Button url={themeEditorUrl} external fullWidth>Open Theme Editor</Button>
                </BlockStack>
              </Card>
              <Card><BlockStack gap="300"><Text as="h2" variant="headingMd">Troubleshooting</Text><Text as="p" tone="subdued">Review coverage if delivery is unavailable. The delivery form appears only after a successful check.</Text><Button url="/app/delivery-settings?tab=coverage" fullWidth>Review coverage</Button></BlockStack></Card>
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
