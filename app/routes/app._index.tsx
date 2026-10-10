import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
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
import { isPublishedThemeEmbedEnabled } from "../services/theme-embed.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await requireActiveBilling(request);
  const shop = session.shop;
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "incode-track";

  const [rules, zones, targets, settings, embedEnabled] = await Promise.all([
    prisma.postalCode.count({ where: { shop } }),
    prisma.zone.count({ where: { shop, enabled: true } }),
    prisma.deliveryTarget.count({ where: { shop, enabled: true } }),
    prisma.deliverySetting.findUnique({ where: { shop } }),
    isPublishedThemeEmbedEnabled(admin, appHandle, "delivery-checker-embed"),
  ]);

  return {
    rules,
    zones,
    targets,
    settingsConfigured: Boolean(settings),
    cartProtectionEnabled: Boolean(settings?.requireValidPin || settings?.disableAddToCart),
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop,
    embedEnabled,
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
  const revalidator = useRevalidator();
  const completedSteps = Number(data.settingsConfigured) + Number(data.rules > 0);
  const progress = Math.round((completedSteps / 2) * 100);
  const shopHandle = data.shop.replace(/\.myshopify\.com$/i, "");
  const appEmbedId = encodeURIComponent(`${data.apiKey}/delivery-checker-embed`);
  const appEmbedUrl = `https://admin.shopify.com/store/${shopHandle}/themes/current/editor?context=apps&activateAppId=${appEmbedId}`;

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const queueRefresh = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (revalidator.state === "idle") revalidator.revalidate();
      }, 100);
    };
    window.addEventListener("focus", queueRefresh);
    document.addEventListener("visibilitychange", queueRefresh);
    return () => {
      clearTimeout(refreshTimer);
      window.removeEventListener("focus", queueRefresh);
      document.removeEventListener("visibilitychange", queueRefresh);
    };
  }, [revalidator]);

  return (
    <Page title="Overview" subtitle="Manage delivery availability and dates.">
      <BlockStack gap="500">
        <div className="incode-hero">
          <BlockStack gap="400">
            <BlockStack gap="200">
              <Text as="h1" variant="heading2xl">Set up delivery checks for your store.</Text>
              <div className="incode-hero__copy">
                <Text as="p" variant="bodyLg">
                  Show availability and delivery dates before checkout.
                </Text>
              </div>
            </BlockStack>
            <InlineStack gap="300" blockAlign="center">
              {data.embedEnabled
                ? <Badge tone="success">Active</Badge>
                : <Button url={appEmbedUrl} external target="_blank" variant="primary">Enable app</Button>}
            </InlineStack>
          </BlockStack>
        </div>

        <div className="incode-metrics incode-metrics--overview">
          <MetricCard label="Coverage rules" value={data.rules} detail="Postal codes and ranges" />
          <MetricCard label="Active zones" value={data.zones} detail="Enabled delivery zones" />
          <MetricCard label="Product rules" value={data.targets} detail="Active product rules" />
        </div>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingLg">Launch checklist</Text>
                  </BlockStack>
                    <Badge tone={progress === 100 ? "success" : "attention"}>{`${completedSteps} of 2 complete`}</Badge>
                </InlineStack>
                <ProgressBar progress={progress} size="small" tone={progress === 100 ? "success" : "primary"} />
                <Divider />
                <div className="incode-step">
                  <span className="incode-step__number">1</span>
                  <BlockStack gap="050">
                    <Text as="h3" fontWeight="semibold">Configure delivery behavior</Text>
                    <Text as="p" tone="subdued">Set timing, messages, and cart rules.</Text>
                  </BlockStack>
                  <Button url="/app/delivery-settings?tab=timing" size="slim">{data.settingsConfigured ? "Review" : "Configure"}</Button>
                </div>
                <div className="incode-step">
                  <span className="incode-step__number">2</span>
                  <BlockStack gap="050">
                    <Text as="h3" fontWeight="semibold">Add delivery coverage</Text>
                    <Text as="p" tone="subdued">Add postal codes or import a CSV.</Text>
                  </BlockStack>
                  <Button url="/app/delivery-settings?tab=coverage" size="slim">{data.rules > 0 ? "Manage" : "Add rules"}</Button>
                </div>
                <div className="incode-step">
                  <span className="incode-step__number">3</span>
                  <BlockStack gap="050">
                    <Text as="h3" fontWeight="semibold">Publish the storefront block</Text>
                    <Text as="p" tone="subdued">Add the block to your product template and test it.</Text>
                  </BlockStack>
                  <Button url={appEmbedUrl} external target="_blank" size="slim">Enable app</Button>
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
                      {data.cartProtectionEnabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    Require a valid postal code before Add to Cart.
                  </Text>
                  <Button url="/app/delivery-settings?tab=products" fullWidth>Review targeting</Button>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Need a hand?</Text>
                  <Text as="p" tone="subdued">View setup and troubleshooting steps.</Text>
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
