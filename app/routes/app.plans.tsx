import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
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
import {
  authenticate,
  STANDARD_PLAN,
  STANDARD_PLAN_CURRENCY,
  STANDARD_PLAN_PRICE,
  STANDARD_PLAN_TRIAL_DAYS,
} from "../shopify.server";
import {
  getActiveAppSubscriptions,
  isBillingRequired,
} from "../services/billing.server";
import { shopifyPricingUrl } from "../utils/shopify-pricing-url";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const billingRequired = isBillingRequired();
  const subscriptions = billingRequired ? await getActiveAppSubscriptions(admin) : [];
  const subscription = subscriptions[0] ?? null;
  const returnedPlanHandle = new URL(request.url).searchParams.get("plan_handle");
  const appHandle = process.env.SHOPIFY_APP_HANDLE?.trim() ?? "";

  return {
    planName: STANDARD_PLAN,
    price: STANDARD_PLAN_PRICE,
    currency: STANDARD_PLAN_CURRENCY,
    interval: "EVERY_30_DAYS" as const,
    trialDays: STANDARD_PLAN_TRIAL_DAYS,
    subscriptionStatus: subscription?.status ?? "NONE",
    hasActiveSubscription: Boolean(subscription),
    billingRequired,
    returnedPlanHandle,
    pricingUrl: appHandle ? shopifyPricingUrl({ shop: session.shop, appHandle }) : null,
    billingManagementUrl: `https://admin.shopify.com/store/${session.shop.replace(/\.myshopify\.com$/i, "")}/settings/billing/subscriptions`,
  };
}

export default function PlansPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <Page title="Plans and billing" subtitle="Simple Shopify billing with one complete plan.">
      <BlockStack gap="500">
        {data.hasActiveSubscription ? (
          <Banner title="Your Standard plan is active" tone="success">
            {data.returnedPlanHandle
              ? "Shopify approved the subscription. All delivery tools are now available."
              : "All delivery tools are available. Charges are managed through your Shopify invoice."}
          </Banner>
        ) : data.returnedPlanHandle ? (
          <Banner title="The subscription was not activated" tone="warning">
            Shopify did not return an active subscription. If you cancelled the approval, you can start again below. If you approved it, refresh once or review Shopify billing.
          </Banner>
        ) : (
          <Banner title="Activate ETADeliverPickup" tone="info">
            Start your 7-day trial, then pay $9 USD every 30 days through Shopify.
          </Banner>
        )}
        {!data.pricingUrl ? <Banner title="Billing is not configured" tone="critical">Add the Shopify App Pricing handle to SHOPIFY_APP_HANDLE.</Banner> : null}
        {!data.billingRequired ? (
          <Banner title="Billing enforcement is disabled" tone="warning">
            Paid routes are currently available without an active subscription.
          </Banner>
        ) : null}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingLg">{data.planName}</Text>
                  {data.hasActiveSubscription ? <Badge tone="success">Active</Badge> : <Badge>Available</Badge>}
                </InlineStack>
                <BlockStack gap="100">
                  <InlineStack gap="100" blockAlign="baseline">
                    <Text as="p" variant="heading2xl" fontWeight="bold">${data.price}</Text>
                    <Text as="p" tone="subdued">{data.currency} every 30 days</Text>
                  </InlineStack>
                  <Text as="p" tone="subdued">{data.trialDays}-day free trial before the first charge.</Text>
                </BlockStack>
                <List>
                  <List.Item>Unlimited postal and ZIP code coverage rules</List.Item>
                  <List.Item>Zones, product targeting, and cart protection</List.Item>
                  <List.Item>Inventory-aware estimates and delivery options</List.Item>
                  <List.Item>CSV tools, Google Sheets sync, and analytics</List.Item>
                </List>
                {data.hasActiveSubscription ? (
                  <BlockStack gap="200">
                    <Text as="p" tone="subdued">Subscription status: {data.subscriptionStatus}</Text>
                    <Button url={data.billingManagementUrl} external target="_blank" fullWidth>Manage subscription in Shopify</Button>
                    <Text as="p" tone="subdued" variant="bodySm">Review charges or cancel the subscription securely from Shopify billing.</Text>
                  </BlockStack>
                ) : (
                  <Button url={data.pricingUrl ?? undefined} external target="_top" variant="primary" disabled={!data.pricingUrl} fullWidth>
                    Start 7-day free trial in Shopify
                  </Button>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Billing transparency</Text>
            <Text as="p" tone="subdued">
              Shopify hosts plan selection and subscription approval, manages the free trial, and adds recurring charges to your Shopify invoice. No external payment provider is used.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

// Keep App Bridge mounted while it handles Shopify's billing redirect response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
