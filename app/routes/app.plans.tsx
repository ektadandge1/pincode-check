import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useRouteError } from "react-router";
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
  STARTUP_PLAN,
  STARTUP_PLAN_NAME,
  STARTUP_PLAN_CURRENCY,
  STARTUP_PLAN_PRICE,
  STARTUP_PLAN_TRIAL_DAYS,
} from "../shopify.server";
import {
  getActiveAppSubscriptions,
  isBillingRequired,
} from "../services/billing.server";
import { isBillingTest } from "../services/billing-config.server";

export async function action({ request }: ActionFunctionArgs) {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") !== "subscribe") {
    return Response.json({ error: "Unsupported billing action." }, { status: 400 });
  }
  return billing.request({
    plan: STARTUP_PLAN,
    isTest: isBillingTest(),
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const billingRequired = isBillingRequired();
  const subscriptions = billingRequired ? await getActiveAppSubscriptions(admin) : [];
  const subscription = subscriptions[0] ?? null;

  return {
    planName: STARTUP_PLAN_NAME,
    price: STARTUP_PLAN_PRICE,
    currency: STARTUP_PLAN_CURRENCY,
    interval: "EVERY_30_DAYS" as const,
    trialDays: STARTUP_PLAN_TRIAL_DAYS,
    subscriptionStatus: subscription?.status ?? "NONE",
    hasActiveSubscription: Boolean(subscription),
    billingRequired,
    billingManagementUrl: `https://admin.shopify.com/store/${session.shop.replace(/\.myshopify\.com$/i, "")}/settings/billing/subscriptions`,
  };
}

export default function PlansPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <Page title="Plans and billing" subtitle="Manage your subscription.">
      <BlockStack gap="500">
        {data.hasActiveSubscription ? (
          <Banner title="Your Startup plan is active" tone="success">
            All features are available.
          </Banner>
        ) : (
          <Banner title="Activate ETADeliverPickup" tone="info">
            Start your 7-day trial, then pay $7 USD every 30 days through Shopify.
          </Banner>
        )}
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
                  <Button url={data.billingManagementUrl} external target="_blank" fullWidth>Manage subscription in Shopify</Button>
                  </BlockStack>
                ) : (
                  <Form method="post">
                    <input type="hidden" name="intent" value="subscribe" />
                    <Button submit variant="primary" fullWidth>Start 7-day free trial in Shopify</Button>
                  </Form>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Shopify billing</Text>
            <Text as="p" tone="subdued">Shopify manages your trial, charges, and cancellation.</Text>
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
