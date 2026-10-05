import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
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
  hasActiveBilling,
  isBillingRequired,
  isBillingTestMode,
} from "../services/billing.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { billing } = await authenticate.admin(request);
  const subscriptions = await getActiveAppSubscriptions(billing);
  const subscription = subscriptions[0] ?? null;

  return {
    planName: STANDARD_PLAN,
    price: STANDARD_PLAN_PRICE,
    currency: STANDARD_PLAN_CURRENCY,
    interval: "EVERY_30_DAYS" as const,
    trialDays: STANDARD_PLAN_TRIAL_DAYS,
    subscriptionStatus: subscription?.status ?? "NONE",
    hasActiveSubscription: Boolean(subscription),
    testMode: isBillingTestMode(),
    billingRequired: isBillingRequired(),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { billing } = await authenticate.admin(request);
  if (await hasActiveBilling(billing)) {
    return { ok: true, alreadyActive: true };
  }

  return billing.request({
    plan: STANDARD_PLAN,
    isTest: isBillingTestMode(),
    returnUrl: new URL("/app/plans?billing=approved", request.url).toString(),
  });
}

export default function PlansPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <Page title="Plans and billing" subtitle="Simple Shopify billing with one complete plan.">
      <BlockStack gap="500">
        {data.hasActiveSubscription ? (
          <Banner title="Your Standard plan is active" tone="success">
            All delivery tools are available. Charges are managed through your Shopify invoice.
          </Banner>
        ) : (
          <Banner title="Activate Incode Track" tone="info">
            Start your 7-day trial, then pay $9 USD every 30 days through Shopify.
          </Banner>
        )}
        {actionData?.alreadyActive ? (
          <Banner title="No new charge was created" tone="success">
            This store already has an active Standard subscription.
          </Banner>
        ) : null}
        {data.testMode ? (
          <Banner title="Test billing is enabled" tone="warning">
            Shopify will create a test subscription and will not charge the store.
          </Banner>
        ) : null}
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
                  <Text as="p" tone="subdued">Subscription status: {data.subscriptionStatus}</Text>
                ) : (
                  <Form method="post">
                    <Button submit variant="primary" loading={isSubmitting} disabled={isSubmitting} fullWidth>
                      Start 7-day free trial
                    </Button>
                  </Form>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Billing transparency</Text>
            <Text as="p" tone="subdued">
              Shopify securely approves the subscription and adds recurring charges to your Shopify invoice. No external payment provider is used.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
