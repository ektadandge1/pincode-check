import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { resolvePlanAccess } from "../services/partner-api.server";

function topCounts<T extends string>(values: T[], limit = 8) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => [label, count]);
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const access = await resolvePlanAccess({ shop: session.shop, admin });
  if (!access.features.analytics) throw redirect("/app/plans?upgrade=analytics");
  const where = { shop: session.shop };
  const [events, total, available] = await Promise.all([
    prisma.postalCodeSearchEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.postalCodeSearchEvent.count({ where }),
    prisma.postalCodeSearchEvent.count({ where: { ...where, available: true } }),
  ]);

  const unavailable = total - available;
  return {
    total,
    available,
    unavailable,
    availabilityRate: total > 0 ? Math.round((available / total) * 100) : 0,
    topPostalCodes: topCounts(events.map((event) => `${event.country} ${event.postalCode}`)),
    topUnavailable: topCounts(
      events.filter((event) => !event.available).map((event) => `${event.country} ${event.postalCode}`),
    ),
    topCountries: topCounts(events.map((event) => event.country)),
    recent: events.slice(0, 25),
    sampleSize: events.length,
  };
}

function MetricCard({ label, value, detail, tone }: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "success" | "critical" | "info";
}) {
  return (
    <Card>
      <div className="incode-metric">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="p" tone="subdued" variant="bodySm">{label}</Text>
            {tone ? <Badge tone={tone}>{tone === "success" ? "Healthy" : tone === "critical" ? "Needs review" : "Tracked"}</Badge> : null}
          </InlineStack>
          <Text as="p" variant="heading2xl" fontWeight="bold">
            <span className="incode-metric__value">{value}</span>
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">{detail}</Text>
        </BlockStack>
      </div>
    </Card>
  );
}

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>();
  const recentRows = data.recent.map((event) => [
    formatDate(event.createdAt),
    event.country,
    event.postalCode,
    event.available ? <Badge key={`${event.id}-result`} tone="success">Available</Badge> : <Badge key={`${event.id}-result`} tone="critical">Unavailable</Badge>,
    event.deliveryDays ?? "-",
    event.source === "db_fallback" ? "Coverage rule" : event.source === "courier_api" ? "Courier API" : "No match",
  ]);

  return (
    <Page
      title="Delivery analytics"
      subtitle="Privacy-safe insights from storefront delivery checks."
      primaryAction={<Button url="/app/delivery-settings#coverage" variant="primary">Improve coverage</Button>}
    >
      <BlockStack gap="500">
        {data.total === 0 ? (
          <Banner title="Analytics will appear after your first delivery check" tone="info">
            Add the app block to a product page, publish the theme, and run a serviceable and unavailable test lookup.
          </Banner>
        ) : null}

        <div className="incode-metrics">
          <MetricCard label="All-time checks" value={data.total} detail="Masked postal regions only" tone="info" />
          <MetricCard label="Serviceable" value={data.available} detail="Successful delivery matches" tone="success" />
          <MetricCard label="Unavailable" value={data.unavailable} detail="Coverage opportunities" tone={data.unavailable > 0 ? "critical" : "success"} />
          <MetricCard label="Availability rate" value={`${data.availabilityRate}%`} detail="Across all recorded checks" tone={data.availabilityRate >= 80 ? "success" : "critical"} />
        </div>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingLg">Recent delivery checks</Text>
                    <Text as="p" tone="subdued">Newest 25 checks. Shopper postal codes remain masked.</Text>
                  </BlockStack>
                  <Badge>{`${data.recent.length} shown`}</Badge>
                </InlineStack>
                {recentRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "numeric", "text"]}
                    headings={["Date (UTC)", "Country", "Postal region", "Result", "Days", "Source"]}
                    rows={recentRows}
                    increasedTableDensity
                  />
                ) : (
                  <Box paddingBlock="800">
                    <BlockStack gap="200" inlineAlign="center">
                      <Text as="h3" variant="headingMd">No checks recorded yet</Text>
                      <Text as="p" tone="subdued">Storefront activity will appear here automatically.</Text>
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Coverage health</Text>
                  <ProgressBar progress={data.availabilityRate} size="small" tone={data.availabilityRate >= 80 ? "success" : "critical"} />
                  <Text as="p" tone="subdued">
                    {data.availabilityRate >= 80
                      ? "Most shopper locations receive a serviceable response."
                      : "Review unavailable regions and add targeted coverage rules."}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Top unavailable regions</Text>
                  {data.topUnavailable.length > 0 ? (
                    <DataTable columnContentTypes={["text", "numeric"]} headings={["Region", "Checks"]} rows={data.topUnavailable} increasedTableDensity />
                  ) : <Text as="p" tone="subdued">No unavailable regions in the recent sample.</Text>}
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Top countries</Text>
                  {data.topCountries.length > 0 ? (
                    <DataTable columnContentTypes={["text", "numeric"]} headings={["Country", "Checks"]} rows={data.topCountries} increasedTableDensity />
                  ) : <Text as="p" tone="subdued">No country data yet.</Text>}
                  <Text as="p" tone="subdued" variant="bodySm">Rankings use the latest {data.sampleSize} checks.</Text>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
