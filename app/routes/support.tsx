import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import enTranslations from "@shopify/polaris/locales/en.json";
import {
  AppProvider as PolarisProvider,
  Banner,
  BlockStack,
  Button,
  Card,
  Layout,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { supportContact } from "../utils/public-contact.server";

export const meta: MetaFunction = () => [
  { title: "Support | ETADeliverPickup" },
  {
    name: "description",
    content:
      "Support and setup guide for ETADeliverPickup.",
  },
];

export const loader = async () => supportContact();

export default function Support() {
  const { contactEmail } = useLoaderData<typeof loader>();

  return (
    <PolarisProvider i18n={enTranslations}>
      <div className="incode-public">
      <Page title="Support" subtitle="Setup and troubleshooting for ETADeliverPickup" narrowWidth backAction={{ content: "ETADeliverPickup", url: "/" }}>
        <BlockStack gap="500">
          <Banner title="Get useful help faster" tone="info">
            Include your shop domain, product URL, selected variant, and a sample postal code when contacting support.
          </Banner>
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
                      Add the Check delivery availability app block to the product template.
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
                    Required columns are country, postal_code, and delivery_days.
                    Optional columns include serviceable, cod_available, delivery_charge,
                    currency, city, state, zone, same_day, next_day, and express.
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
                  <Text as="p">{contactEmail ? "Our team can help with setup, imports, targeting, and storefront behavior." : "Use the support contact in the Shopify App Store listing for ETADeliverPickup."}</Text>
                  {contactEmail ? <Button url={`mailto:${contactEmail}`} variant="primary">Email {contactEmail}</Button> : null}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
        </BlockStack>
      </Page>
      </div>
    </PolarisProvider>
  );
}
