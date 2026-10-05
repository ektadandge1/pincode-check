import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import enTranslations from "@shopify/polaris/locales/en.json";
import {
  AppProvider as PolarisProvider,
  BlockStack,
  Card,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy | Incode Track" },
  {
    name: "description",
    content:
      "Privacy policy for Incode Track, a Shopify app for postal code delivery availability checks.",
  },
];

export const loader = async () => ({
  contactEmail: process.env.PRIVACY_EMAIL || process.env.SUPPORT_EMAIL || "",
  legalBusinessName: process.env.LEGAL_BUSINESS_NAME || "Incode Track",
});

export default function PrivacyPolicy() {
  const { contactEmail, legalBusinessName } = useLoaderData<typeof loader>();

  return (
    <PolarisProvider i18n={enTranslations}>
      <div className="incode-public">
      <Page title="Privacy Policy" subtitle="Last updated: September 28, 2026" narrowWidth backAction={{ content: "Incode Track", url: "/" }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Data we process
                  </Text>
                  <Text as="p">
                    Incode Track stores merchant configuration needed to provide
                    delivery availability checks, including shop domain, country and postal code
                    coverage, delivery-day rules, COD availability, cutoff time,
                    weekend settings, and holiday dates.
                  </Text>
                  <Text as="p">
                    The app does not store customer names, addresses, emails,
                    phone numbers, orders, payments, or checkout information.
                    Storefront shoppers enter a country and postal code to receive an
                    immediate delivery availability response. Lookup analytics retain only
                    a shortened postal-code region, not the complete shopper entry.
                  </Text>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    How data is used
                  </Text>
                  <Text as="p">
                    Merchant configuration is used only to show delivery
                    availability, estimated delivery dates, COD availability, and
                    stock-aware messages through the storefront theme app
                    extension.
                  </Text>
                  <Text as="p">
                    If a merchant configures a courier provider integration,
                    postal codes can be sent to that provider to request delivery
                    serviceability. If no courier provider is configured, checks
                    use only the merchant&apos;s uploaded postal code records.
                  </Text>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Retention and deletion
                  </Text>
                  <Text as="p">
                    When a shop requests deletion or Shopify sends a shop redact
                    webhook, shop-owned app data is deleted from the app
                    database. The app also responds to Shopify mandatory privacy
                    webhooks for customer data requests and customer redaction
                    requests. Lookup analytics are retained for up to 90 days.
                  </Text>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Security
                  </Text>
                  <Text as="p">
                    The app uses Shopify OAuth, session-token based embedded app
                    authentication, App Bridge, HTTPS in production, and Shopify
                    webhook verification. Production hosting uses encrypted
                    transport, restricted database access, and encrypted backups.
                  </Text>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Contact
                  </Text>
                  <Text as="p">Data controller: {legalBusinessName}.</Text>
                  <Text as="p">
                    {contactEmail ? <>For privacy or support requests, contact <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</> : "For privacy or support requests, use the support contact listed in the Shopify App Store listing for Incode Track."}
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
      </div>
    </PolarisProvider>
  );
}
