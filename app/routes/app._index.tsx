import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Layout,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <Page title="Delivery availability checker">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">
                      Configure accurate delivery estimates
                    </Text>
                    <Text as="p" tone="subdued">
                      Manage serviceable postal codes, delivery days, COD availability,
                      holidays, and fallback rules for your storefront widget.
                    </Text>
                  </BlockStack>
                  <Badge tone="success">Active</Badge>
                </InlineStack>

                <InlineStack gap="300">
                  <Button url="/app/delivery-settings" variant="primary">
                    Manage delivery settings
                  </Button>
                  <Button url="/app/additional">View setup help</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Layout>
              <Layout.Section variant="oneHalf">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Storefront experience
                    </Text>
                    <Text as="p" tone="subdued">
                      Customers can check delivery availability and estimated
                      delivery timelines before they buy.
                    </Text>
                    <List>
                      <List.Item>Country-aware postal and ZIP code validation</List.Item>
                      <List.Item>Serviceability and COD messaging</List.Item>
                      <List.Item>Inventory-aware delivery estimates</List.Item>
                    </List>
                  </BlockStack>
                </Card>
              </Layout.Section>

              <Layout.Section variant="oneHalf">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Merchant controls
                    </Text>
                    <Text as="p" tone="subdued">
                      Update postal code coverage from a CSV file or by adding rows
                      directly in the admin.
                    </Text>
                    <List>
                      <List.Item>Bulk CSV import</List.Item>
                      <List.Item>Manual postal code entry</List.Item>
                      <List.Item>Holiday and weekend configuration</List.Item>
                    </List>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                App Store readiness
              </Text>
              <Text as="p" tone="subdued">
                The admin UI now uses Shopify Polaris components and avoids
                development-only actions that are not part of the merchant workflow.
              </Text>
              <Box>
                <Link to="/app/delivery-settings">Open delivery settings</Link>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
