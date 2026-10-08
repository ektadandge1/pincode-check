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

export default function AdditionalPage() {
  const { shop, apiKey, supportEmail } = useLoaderData<typeof loader>();
  const shopHandle = shop.replace(/\.myshopify\.com$/i, "");
  const themeEditorUrl = `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=product&addAppBlockId=${apiKey}/delivery-checker&target=mainSection`;

  return (
    <Page title="Setup guide" subtitle="Launch, test, and troubleshoot your delivery experience.">
      <BlockStack gap="500">
        <Banner title="Recommended launch sequence" tone="info">
          Configure behavior first, add coverage second, then publish and test the theme block. This prevents shoppers from seeing incomplete results.
        </Banner>
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingLg">Launch in four steps</Text>
                    <Badge tone="info">About 10 minutes</Badge>
                  </InlineStack>
                  {[
                    ["1", "Set delivery behavior", "Choose weekends and cutoff time in Delivery Timing. Messages and Optional features can be configured later.", "/app/delivery-settings?tab=timing", "Configure"],
                    ["2", "Add coverage", "Upload a CSV or create exact codes, ranges, and wildcard rules. Group them into zones when priorities overlap.", "/app/delivery-settings?tab=coverage", "Add coverage"],
                    ["3", "Set product targeting", "Add product, collection, vendor, or tag overrides when needed. Shop-wide cart protection is available under Optional.", "/app/delivery-settings?tab=products", "Set targets"],
                    ["4", "Publish and test", "Add the app block to the product template. Test one serviceable and one unavailable postal code before publishing.", themeEditorUrl, "Open editor"],
                  ].map(([number, title, description, url, action]) => (
                    <div className="incode-step" key={number}>
                      <span className="incode-step__number">{number}</span>
                      <BlockStack gap="050">
                        <Text as="h3" fontWeight="semibold">{title}</Text>
                        <Text as="p" tone="subdued">{description}</Text>
                      </BlockStack>
                      <Button url={url} external={url.startsWith("https://")} size="slim">{action}</Button>
                    </div>
                  ))}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingLg">CSV reference</Text>
                  <Text as="p" tone="subdued">
                    Required columns: <strong>country</strong>, <strong>postal_code</strong>, and <strong>delivery_days</strong>. Imports accept up to 100,000 rows.
                  </Text>
                  <code className="incode-code">country,postal_code,delivery_days,serviceable,cod_available,delivery_charge,currency,city,state,zone,same_day,next_day,express{"\n"}US,10001,2,true,true,8,USD,New York,New York,metro,true,true,true{"\n"}US,10000-10999,3,true,false,10,USD,,,metro,false,false,false{"\n"}GB,SW1A*,3,true,false,5,GBP,London,,london,false,false,true</code>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Postal patterns can be exact, a numeric range such as 10000-10999, or a prefix wildcard such as SW1A*.
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingLg">Order confirmation email</Text>
                  <Text as="p" tone="subdued">Add this Liquid snippet in Shopify Admin → Settings → Notifications → Order confirmation. It displays the validated delivery range saved with the cart.</Text>
                  <code className="incode-code">{"{% for attribute in attributes %}\n  {% if attribute.first == '_incode_delivery_date_range' and attribute.last != blank %}\n    <p><strong>Estimated delivery:</strong> {{ attribute.last }}</p>\n  {% endif %}\n{% endfor %}"}</code>
                  <Banner tone="warning">The email estimate is shown only when a successful ZIP check saved a current delivery range. Test the notification before publishing it.</Banner>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Widget not visible?</Text>
                  <Text as="p" tone="subdued">Confirm the app block is added to the published product template, not only a draft template.</Text>
                  <Button url={themeEditorUrl} external fullWidth>Open Theme Editor</Button>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Every code unavailable?</Text>
                  <Text as="p" tone="subdued">Check the country, ensure DB fallback is enabled, and confirm an enabled rule or zone matches the code.</Text>
                  <Button url="/app/delivery-settings?tab=coverage" fullWidth>Review coverage</Button>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Support</Text>
                  <Text as="p" tone="subdued">
                    {supportEmail ? "Include your shop domain, affected product, and a sample postal code." : "Use the support contact in the Shopify App Store listing."}
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
