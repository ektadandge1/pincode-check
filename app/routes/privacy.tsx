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
import { privacyContact } from "../utils/public-contact.server";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy | ETADeliverPickup" },
  {
    name: "description",
    content:
      "Privacy policy for ETADeliverPickup, a Shopify app for postal code delivery availability checks.",
  },
];

export const loader = async () => privacyContact();

export default function PrivacyPolicy() {
  const { contactEmail, legalBusinessName } = useLoaderData<typeof loader>();

  return (
    <PolarisProvider i18n={enTranslations}>
      <div className="incode-public">
       <Page title="Privacy Policy" subtitle="Last updated: October 6, 2026" narrowWidth backAction={{ content: "ETADeliverPickup", url: "/" }}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Data we process
                  </Text>
                  <Text as="p">
                     ETADeliverPickup stores merchant configuration needed to provide
                    delivery availability checks, including shop domain, country and postal code
                    coverage, delivery-day rules, COD availability, cutoff time,
                    weekend settings, and holiday dates.
                  </Text>
                   <Text as="p">
                      Shoppers provide a country and postal code for delivery checks.
                     Lookup analytics store a shortened postal-code region, product and
                     variant identifiers, availability results, and timestamps. They are
                     not linked to a customer identifier. The app database does not store
                     shopper names, full delivery addresses, emails, payments, or orders.
                      Shopify authentication sessions can contain merchant account identity
                      and access credentials needed to operate the app.
                    </Text>
                    <Text as="p">
                      Import processing can retain failed CSV row values and error details.
                      Merchant-created delivery messages, pickup instructions, targeting values,
                      and other free-text settings are stored as configured. Headless API tokens
                      are stored only as hashes with a safe prefix; token scopes, origins, status,
                      expiry and usage metadata are stored, together with shop- and token-scoped
                      rate-limit counters. Do not upload customer lists or put personal data in
                      imports or custom messages.
                    </Text>
                   <Text as="p">
                     When enabled, storefront blocks read a logged-in shopper&apos;s saved
                     address from Shopify. The full delivery postal code and estimate can
                     be written to Shopify cart attributes and carried to order attributes
                     for post-purchase displays. These records remain in Shopify and are
                     managed under the merchant&apos;s Shopify data policies.
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
                     requests. There is no customer-linked dataset in the app database
                     to export or delete for an individual shopper. Customer requests
                     concerning Shopify cart or order records should be handled by the
                     merchant in Shopify. Analytics cleanup targets records older than
                     90 days during lookup activity; inactive shops may retain older
                     records until cleanup or shop deletion occurs.
                  </Text>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Security
                  </Text>
                  <Text as="p">
                    The app uses Shopify OAuth, session-token based embedded app
                    authentication, App Bridge, HTTPS in production, and Shopify
                     webhook verification. Headless API tokens are stored as hashes;
                     private tokens should never be exposed in a shopper browser.
                      Hosting access controls, backup retention, and restoration policies
                      must be maintained by the app operator.
                  </Text>
                  <Text as="p">
                    Hosting and database providers may retain operational error logs, backups,
                    and request metadata under their configured policies. The app does not
                    intentionally log request bodies, raw API tokens, or credentials. Shop
                    deletion webhooks do not erase provider backups or third-party logs; the
                    operator must maintain separate retention and redaction procedures.
                  </Text>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Contact
                  </Text>
                  <Text as="p">Data controller: {legalBusinessName}.</Text>
                  <Text as="p">
                     {contactEmail ? <>For privacy or support requests, contact <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</> : "For privacy or support requests, use the support contact listed in the Shopify App Store listing for ETADeliverPickup."}
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
