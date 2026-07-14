import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import enTranslations from "@shopify/polaris/locales/en.json";
import {
  AppProvider as PolarisProvider,
  BlockStack,
  Card,
  Layout,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";

export const meta: MetaFunction = () => [
  { title: "Support | Incode Track" },
  {
    name: "description",
    content:
      "Support and setup guide for Incode Track delivery availability checker.",
  },
];

export const loader = async () => ({
  contactEmail: process.env.SUPPORT_EMAIL || "",
});

export default function Support() {
  const { contactEmail } = useLoaderData<typeof loader>();

  return (
    <PolarisProvider i18n={enTranslations}>
      <Page title="Support" subtitle="Setup and troubleshooting for Incode Track">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Setup steps
                  </Text>
                  <List type="number">
                    <List.Item>Open the app in Shopify admin.</List.Item>
                    <List.Item>
                      Configure cutoff time, weekends, holidays, and fallback
                      rules.
                    </List.Item>
                    <List.Item>
                      Upload country and postal code coverage by CSV or add records manually.
                    </List.Item>
                    <List.Item>
                      Add the Delivery availability checker app block to the product template.
                    </List.Item>
                    <List.Item>
                      Test a valid postal code and an unavailable postal code on a product
                      page.
                    </List.Item>
                  </List>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    CSV format
                  </Text>
                  <Text as="p">
                    Supported columns are country, postal_code, delivery_days,
                    serviceable, cod_available, city, state, and zone. The
                    country, postal_code, and delivery_days columns are required.
                  </Text>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Troubleshooting
                  </Text>
                  <List>
                    <List.Item>
                      If the widget is not visible, confirm the app block was
                      added and saved in the Theme Editor.
                    </List.Item>
                    <List.Item>
                      If every postal code is unavailable, confirm postal code records
                      were added for the installed shop.
                    </List.Item>
                    <List.Item>
                      If inventory-aware checks are enabled, select a product
                      variant on the product page before checking delivery.
                    </List.Item>
                  </List>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Contact
                  </Text>
                  <Text as="p">
                    {contactEmail
                      ? `For support requests, contact ${contactEmail}.`
                      : "Use the support email and contact details configured in the Shopify App Store listing for Incode Track."}
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </PolarisProvider>
  );
}
