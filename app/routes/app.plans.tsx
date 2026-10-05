import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
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
import { authenticate } from "../shopify.server";
import { resolvePlanAccess } from "../services/partner-api.server";
import { PLAN_DETAILS, storefrontPlanUrl } from "../services/plans.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const access = await resolvePlanAccess({
    shop: session.shop,
    admin,
    forceRefresh: Boolean(url.searchParams.get("plan_handle")),
  });
  return {
    access,
    pricingUrl: storefrontPlanUrl(session.shop),
    selectedPlan: url.searchParams.get("plan_handle"),
    plans: PLAN_DETAILS,
  };
}

export default function PlansPage() {
  const { access, pricingUrl, selectedPlan, plans } = useLoaderData<typeof loader>();
  return (
    <Page title="Plans and billing" subtitle="Choose the delivery tools that fit your store.">
      <BlockStack gap="500">
        {selectedPlan && access.active ? (
          <Banner title={`Your ${access.planName} plan is active`} tone="success">
            Shopify confirmed your selection. Your plan features are ready to use.
          </Banner>
        ) : null}
        {!access.active ? (
          <Banner title="Select a plan to activate Incode Track" tone="info">
            Both plans include a 7-day free trial. Shopify handles approval, billing, upgrades, downgrades, and cancellation.
          </Banner>
        ) : null}
        {access.cancelAtEndOfCycle ? (
          <Banner title="Cancellation scheduled" tone="warning">
            Your current features remain available through the end of the billing cycle.
          </Banner>
        ) : null}

        <Layout>
          {(Object.keys(plans) as Array<keyof typeof plans>).map((key) => {
            const plan = plans[key];
            const current = access.plan === plan.key;
            return (
              <Layout.Section variant="oneHalf" key={plan.key}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingLg">{plan.name}</Text>
                      {current ? <Badge tone="success">Current plan</Badge> : plan.key === "advanced" ? <Badge tone="info">Full feature set</Badge> : null}
                    </InlineStack>
                    <BlockStack gap="100">
                      <InlineStack gap="100" blockAlign="baseline">
                        <Text as="p" variant="heading2xl" fontWeight="bold">{plan.price}</Text>
                        <Text as="p" tone="subdued">USD / month</Text>
                      </InlineStack>
                      <Text as="p" tone="subdued">7-day free trial, then recurring monthly billing.</Text>
                    </BlockStack>
                    <Text as="p">{plan.description}</Text>
                    <List>{plan.features.map((feature) => <List.Item key={feature}>{feature}</List.Item>)}</List>
                    <Button url={pricingUrl} target="_top" variant={plan.key === "advanced" ? "primary" : "secondary"} fullWidth>
                      {current ? "Manage plan in Shopify" : access.active ? `Switch to ${plan.name}` : `Start ${plan.name} trial`}
                    </Button>
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Billing transparency</Text>
            <Text as="p" tone="subdued">
              Charges appear on your Shopify invoice. You can upgrade or downgrade without reinstalling the app. Advanced configuration is retained but becomes dormant if you move to Basic.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
