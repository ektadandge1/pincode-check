import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect } from "react-router";
import enTranslations from "@shopify/polaris/locales/en.json";
import {
  AppProvider as PolarisProvider,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Link,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";

export const meta: MetaFunction = () => [
  { title: "Incode Track" },
  {
    name: "description",
    content:
      "Postal and ZIP code delivery availability checker for Shopify product pages.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <PolarisProvider i18n={enTranslations}>
      <Page title="Incode Track" subtitle="Postal and ZIP code delivery availability for Shopify product pages">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text as="h1" variant="heading2xl">
                    Delivery availability checker
                  </Text>
                  <Text as="p" tone="subdued">
                    Show delivery availability, estimated delivery dates, and COD
                    availability from a Shopify theme app extension.
                  </Text>
                </BlockStack>

                <List>
                  <List.Item>
                    Add the delivery checker to product pages without editing
                    theme code.
                  </List.Item>
                  <List.Item>
                    Manage country and postal code coverage, holidays, weekends, and delivery
                    cutoffs from Shopify admin.
                  </List.Item>
                  <List.Item>
                    Install and launch the app from Shopify-owned surfaces only.
                  </List.Item>
                </List>

                <InlineStack gap="300">
                  <Button url="/support" variant="primary">
                    View support
                  </Button>
                  <Link url="/privacy">Privacy Policy</Link>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </PolarisProvider>
  );
}
