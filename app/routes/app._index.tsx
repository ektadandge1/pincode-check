import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { requireActiveBilling } from "../services/billing.server";
import { resolvePlanAccess } from "../services/plan-access.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await requireActiveBilling(request);
  const shop = session.shop;
  const access = await resolvePlanAccess({ shop, admin });
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  const [rules, zones, targets, settings, searches, available] = await Promise.all([
    prisma.postalCode.count({ where: { shop } }),
    prisma.zone.count({ where: { shop, enabled: true } }),
    prisma.deliveryTarget.count({ where: { shop, enabled: true } }),
    prisma.deliverySetting.findUnique({ where: { shop } }),
    access.features.analytics
      ? prisma.postalCodeSearchEvent.count({ where: { shop, createdAt: { gte: since } } })
      : Promise.resolve(0),
    access.features.analytics
      ? prisma.postalCodeSearchEvent.count({ where: { shop, createdAt: { gte: since }, available: true } })
      : Promise.resolve(0),
  ]);

  return {
    rules,
    zones,
    targets,
    searches,
    availabilityRate: searches > 0 ? Math.round((available / searches) * 100) : 0,
    settingsConfigured: Boolean(settings),
    cartProtectionEnabled: Boolean(settings?.requireValidPin || settings?.disableAddToCart),
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop,
    access,
  };
};

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <Card>
      <Box minHeight="84px">
        <BlockStack gap="200">
          <Text as="p" tone="subdued" variant="bodySm">{label}</Text>
          <Text as="p" variant="heading2xl" fontWeight="bold">
            <span className="incode-metric__value">{value}</span>
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">{detail}</Text>
        </BlockStack>
      </Box>
    </Card>
  );
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const completedSteps = Number(data.settingsConfigured) + Number(data.rules > 0);
  const progress = Math.round((completedSteps / 2) * 100);
  const shopHandle = data.shop.replace(/\.myshopify\.com$/i, "");
  const themeEditorUrl = `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?template=product&addAppBlockId=${data.apiKey}/delivery-checker&target=mainSection`;

  return (
    <Page title="Overview" subtitle="Control delivery promises shoppers can trust.">
      <BlockStack gap="500">
        <div className="incode-hero">
          <BlockStack gap="400">
            <span className="incode-hero__eyebrow">Incode Track</span>
            <BlockStack gap="200">
              <Text as="h1" variant="heading2xl">Turn delivery certainty into more completed carts.</Text>
              <div className="incode-hero__copy">
                <Text as="p" variant="bodyLg">
                  Give every shopper a precise serviceability answer, delivery date, COD status,
                  and product-specific purchase policy before checkout.
                </Text>
              </div>
            </BlockStack>
            <InlineStack gap="300">
              <Button url="/app/delivery-settings" variant="primary">Manage delivery coverage</Button>
              <Button url={themeEditorUrl} external variant="secondary">Open Theme Editor</Button>
            </InlineStack>
          </BlockStack>
        </div>

        <div className="incode-metrics">
          <MetricCard label="Coverage rules" value={data.rules} detail="Exact, range, and wildcard rules" />
          <MetricCard label="Active zones" value={data.zones} detail="Priority-based delivery regions" />
          <MetricCard label="Product targets" value={data.targets} detail="Active enforcement overrides" />
          <MetricCard
            label="30-day availability"
            value={data.access.features.analytics ? `${data.availabilityRate}%` : "Subscription required"}
            detail={data.access.features.analytics ? `${data.searches} shopper checks` : "Upgrade for delivery analytics"}
          />
        </div>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingLg">Launch checklist</Text>
                    <Text as="p" tone="subdued">Complete these steps before promoting the checker.</Text>
                  </BlockStack>
                   <Badge tone={progress === 100 ? "success" : "attention"}>{`${completedSteps} of 2 configuration checks complete`}</Badge>
                </InlineStack>
                <ProgressBar progress={progress} size="small" tone={progress === 100 ? "success" : "primary"} />
                <Divider />
                <div className="incode-step">
                  <span className="incode-step__number">1</span>
                  <BlockStack gap="050">
                    <Text as="h3" fontWeight="semibold">Configure delivery behavior</Text>
                    <Text as="p" tone="subdued">Set cutoff time, weekends, messaging, and cart protection.</Text>
                  </BlockStack>
                  <Button url="/app/delivery-settings?tab=timing" size="slim">{data.settingsConfigured ? "Review" : "Configure"}</Button>
                </div>
                <div className="incode-step">
                  <span className="incode-step__number">2</span>
                  <BlockStack gap="050">
                    <Text as="h3" fontWeight="semibold">Add delivery coverage</Text>
                    <Text as="p" tone="subdued">Import CSV data or create your first postal rule.</Text>
                  </BlockStack>
                  <Button url="/app/delivery-settings?tab=coverage" size="slim">{data.rules > 0 ? "Manage" : "Add rules"}</Button>
                </div>
                <div className="incode-step">
                  <span className="incode-step__number">3</span>
                  <BlockStack gap="050">
                    <Text as="h3" fontWeight="semibold">Publish the storefront block</Text>
                    <Text as="p" tone="subdued">Manual verification required, not included in the configuration count. Add the checker to your published product template and test a serviceable and an unavailable code.</Text>
                  </BlockStack>
                  <Button url={themeEditorUrl} external size="slim">Open editor</Button>
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Storefront protection</Text>
                    <Badge tone={data.cartProtectionEnabled ? "success" : "attention"}>
                      {data.cartProtectionEnabled ? "Shop-wide controls enabled" : "Shop-wide controls disabled"}
                    </Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    Require a serviceable postal code before Add to Cart globally or only for selected products, collections, and tags.
                  </Text>
                  <Button url="/app/delivery-settings?tab=products" fullWidth>Review targeting</Button>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Need a hand?</Text>
                  <Text as="p" tone="subdued">Follow the setup guide, CSV reference, and storefront troubleshooting checklist.</Text>
                  <Button url="/app/additional" fullWidth>Open setup guide</Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
