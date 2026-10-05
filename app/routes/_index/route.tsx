import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect } from "react-router";
import enTranslations from "@shopify/polaris/locales/en.json";
import {
  AppProvider as PolarisProvider,
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";

export const meta: MetaFunction = () => [
  { title: "Incode Track | Delivery certainty for Shopify" },
  { name: "description", content: "Advanced postal and ZIP code delivery availability, delivery dates, COD rules, and cart protection for Shopify." },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  return null;
};

export default function App() {
  return (
    <PolarisProvider i18n={enTranslations}>
      <div className="incode-public">
        <Page narrowWidth>
          <BlockStack gap="500">
            <div className="incode-hero">
              <BlockStack gap="400">
                <InlineStack gap="200">
                  <Badge tone="info">Built for Shopify</Badge>
                  <Badge tone="success">Theme app extension</Badge>
                </InlineStack>
                <BlockStack gap="200">
                  <Text as="h1" variant="heading3xl">Delivery certainty, before shoppers reach checkout.</Text>
                  <div className="incode-hero__copy">
                    <Text as="p" variant="bodyLg">
                      Incode Track combines postal-code coverage, accurate delivery dates, COD messaging,
                      product targeting, and Add-to-Cart protection in one Shopify-native experience.
                    </Text>
                  </div>
                </BlockStack>
                <InlineStack gap="300">
                  <Button url="/support" variant="primary">View setup guide</Button>
                  <Button url="/privacy" variant="secondary">Privacy policy</Button>
                </InlineStack>
              </BlockStack>
            </div>

            <Layout>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">Advanced coverage</Text>
                    <Text as="p" tone="subdued">Exact codes, ranges, wildcards, zones, delivery charges, and CSV imports up to 100,000 rows.</Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">Targeted protection</Text>
                    <Text as="p" tone="subdued">Require a valid delivery PIN globally or by product, collection, and product tag.</Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">Privacy-safe insight</Text>
                    <Text as="p" tone="subdued">Measure serviceability and coverage gaps using masked postal-region analytics.</Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingLg">Designed for a trustworthy storefront</Text>
                <Text as="p" tone="subdued">
                  The configurable product-page block inherits your storefront context, works on mobile,
                  validates country-specific formats, and clearly communicates serviceability without manual theme code.
                </Text>
                <InlineStack gap="300">
                  <Button url="/support">Support and troubleshooting</Button>
                  <Button url="/privacy" variant="plain">Read how data is handled</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Page>
      </div>
    </PolarisProvider>
  );
}
