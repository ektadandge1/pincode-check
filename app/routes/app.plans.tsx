import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { type BillingContext, getActiveBilling } from "../services/billing.server";
import {
  BILLING_PLANS,
  PLAN_DETAILS,
  getBillingTestMode,
  isBillingPlan,
} from "../services/plans.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);
  const activeBilling = await getActiveBilling(session.shop, billing as unknown as BillingContext);

  return {
    activePlan: activeBilling.plan,
    plans: BILLING_PLANS.map((plan) => ({ plan, ...PLAN_DETAILS[plan] })),
    testMode: getBillingTestMode(),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = String(formData.get("plan") ?? "");

  if (!isBillingPlan(plan)) {
    return new Response("Invalid plan.", { status: 400 });
  }

  const appUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  return billing.request({
    plan,
    isTest: getBillingTestMode(),
    trialDays: 14,
    returnUrl: `${appUrl}/app/plans?billing=approved`,
  });
}

export default function PlansPage() {
  const { activePlan, plans, testMode } = useLoaderData<typeof loader>();

  return (
    <Page title="Choose a plan" subtitle="All app charges are approved and managed through Shopify billing.">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {testMode ? (
              <Card>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p">Billing test mode is enabled for development stores.</Text>
                  <Badge tone="attention">Test mode</Badge>
                </InlineStack>
              </Card>
            ) : null}

            <InlineStack gap="400" align="start">
              {plans.map((item) => (
                <Card key={item.plan}>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingLg">{item.plan}</Text>
                      {activePlan === item.plan ? <Badge tone="success">Current</Badge> : null}
                    </InlineStack>
                    <Text as="p" variant="heading2xl">{item.price}</Text>
                    <Text as="p" tone="subdued">{item.description}</Text>
                    <List>
                      {item.features.map((feature) => <List.Item key={feature}>{feature}</List.Item>)}
                    </List>
                    <Form method="post">
                      <input type="hidden" name="plan" value={item.plan} />
                      <Button submit variant={activePlan === item.plan ? "secondary" : "primary"} disabled={activePlan === item.plan}>
                        {activePlan === item.plan ? "Current plan" : `Choose ${item.plan}`}
                      </Button>
                    </Form>
                  </BlockStack>
                </Card>
              ))}
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
