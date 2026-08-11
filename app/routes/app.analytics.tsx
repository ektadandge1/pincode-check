import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Badge,
  BlockStack,
  Card,
  DataTable,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { type BillingContext, getActiveBilling, requireFeature } from "../services/billing.server";

function topCounts<T extends string>(values: T[], limit = 10) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => [label, count]);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);
  const activeBilling = await getActiveBilling(session.shop, billing as unknown as BillingContext);
  requireFeature(activeBilling, "analytics");
  const events = await prisma.postalCodeSearchEvent.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  const available = events.filter((event) => event.available).length;
  const unavailable = events.length - available;
  const availabilityRate = events.length > 0 ? Math.round((available / events.length) * 100) : 0;

  return {
    total: events.length,
    available,
    unavailable,
    availabilityRate,
    topPostalCodes: topCounts(events.map((event) => `${event.country} ${event.postalCode}`)),
    topUnavailable: topCounts(events.filter((event) => !event.available).map((event) => `${event.country} ${event.postalCode}`)),
    topCountries: topCounts(events.map((event) => event.country)),
    recent: events.slice(0, 25),
  };
}

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>();
  const topPostalRows = data.topPostalCodes;
  const topUnavailableRows = data.topUnavailable;
  const countryRows = data.topCountries;
  const recentRows = data.recent.map((event) => [
    new Date(event.createdAt).toLocaleString(),
    event.country,
    event.postalCode,
    event.available ? <Badge tone="success">Available</Badge> : <Badge tone="critical">Unavailable</Badge>,
    event.deliveryDays ?? "-",
    event.source,
  ]);

  return (
    <Page title="Analytics" subtitle="Privacy-safe delivery lookup insights from recent storefront checks.">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <InlineStack gap="400">
              <Card>
                <Text as="h2" variant="headingMd">Total searches</Text>
                <Text as="p" variant="heading2xl">{data.total}</Text>
              </Card>
              <Card>
                <Text as="h2" variant="headingMd">Available</Text>
                <Text as="p" variant="heading2xl">{data.available}</Text>
              </Card>
              <Card>
                <Text as="h2" variant="headingMd">Unavailable</Text>
                <Text as="p" variant="heading2xl">{data.unavailable}</Text>
              </Card>
              <Card>
                <Text as="h2" variant="headingMd">Availability rate</Text>
                <Text as="p" variant="heading2xl">{data.availabilityRate}%</Text>
              </Card>
            </InlineStack>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Recent searches</Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "numeric", "text"]}
                  headings={["Date", "Country", "Postal code", "Result", "Days", "Source"]}
                  rows={recentRows}
                  increasedTableDensity
                />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Top searched</Text>
                <DataTable columnContentTypes={["text", "numeric"]} headings={["Postal code", "Searches"]} rows={topPostalRows} increasedTableDensity />
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Top unavailable</Text>
                <DataTable columnContentTypes={["text", "numeric"]} headings={["Postal code", "Searches"]} rows={topUnavailableRows} increasedTableDensity />
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Top countries</Text>
                <DataTable columnContentTypes={["text", "numeric"]} headings={["Country", "Searches"]} rows={countryRows} increasedTableDensity />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
