import { useMemo, useState } from "react";
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
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import prisma from "../db.server";
import { requireActiveBilling } from "../services/billing.server";
import { resolvePlanAccess } from "../services/plan-access.server";

function topCounts<T extends string>(values: T[], limit = 8) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => [label, String(count)]);
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
  const { admin, session } = await requireActiveBilling(request);
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
      <div className="incode-metric analytics-metric">
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
  const [query, setQuery] = useState("");
  const [result, setResult] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.recent.filter((event) => {
      if (result === "available" && !event.available) return false;
      if (result === "unavailable" && event.available) return false;
      if (!q) return true;
      return `${event.country} ${event.postalCode} ${event.source ?? ""}`.toLowerCase().includes(q);
    });
  }, [data.recent, query, result]);

  const recentRows = filtered.map((event) => [
    formatDate(event.createdAt),
    event.country,
    event.postalCode,
    event.available ? <Badge key={`${event.id}-result`} tone="success">Available</Badge> : <Badge key={`${event.id}-result`} tone="critical">Unavailable</Badge>,
    event.deliveryDays == null ? "-" : String(event.deliveryDays),
    event.source === "db_fallback" ? "Coverage rule" : event.source === "courier_api" ? "Courier API" : "No match",
  ]);

  const exportCsv = () => {
    const header = "date_utc,country,postal_region,result,delivery_days,source";
    const lines = filtered.map((event) => [
      new Date(event.createdAt).toISOString(),
      event.country,
      `"${String(event.postalCode).replace(/"/g, '""')}"`,
      event.available ? "available" : "unavailable",
      event.deliveryDays ?? "",
      event.source ?? "",
    ].join(","));
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "etadeliverpickup-analytics.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Page
      title="Delivery analytics"
      subtitle="ETADeliverPickup privacy-safe insights from real storefront delivery checks."
      primaryAction={<Button url="/app/delivery-settings?tab=coverage" variant="primary">Improve coverage</Button>}
    >
      <BlockStack gap="500">
        {data.total === 0 ? (
          <Banner title="Analytics will appear after your first delivery check" tone="info">
            Add the app block to a product page, publish the theme, and run one serviceable and one unavailable test lookup.
          </Banner>
        ) : null}

        <div className="incode-metrics">
          <MetricCard label="All-time checks" value={data.total} detail="Masked postal regions only" tone="info" />
          <MetricCard label="Serviceable" value={data.available} detail="Successful delivery matches" tone="success" />
          <MetricCard label="Unavailable" value={data.unavailable} detail="Coverage opportunities" tone={data.unavailable > 0 ? "critical" : "success"} />
          <MetricCard label="Availability rate" value={data.total ? `${data.availabilityRate}%` : "No data"} detail={data.total ? "Across all recorded checks" : "Waiting for the first check"} tone={data.total === 0 ? "info" : data.availabilityRate >= 80 ? "success" : "critical"} />
        </div>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingLg">Recent delivery checks</Text>
                    <Text as="p" tone="subdued">Newest 25 checks. Shopper postal codes remain masked, never full addresses.</Text>
                  </BlockStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge>{`${filtered.length} shown`}</Badge>
                    <Button size="slim" onClick={exportCsv} disabled={!filtered.length}>Export CSV</Button>
                  </InlineStack>
                </InlineStack>
                <div className="analytics-filters">
                  <TextField label="Search region" labelHidden value={query} onChange={setQuery} autoComplete="off" placeholder="Search country, region or source — e.g. IN 400" />
                  <Select label="Result" labelHidden value={result} onChange={setResult} options={[{ label: "All results", value: "all" }, { label: "Available only", value: "available" }, { label: "Unavailable only", value: "unavailable" }]} />
                </div>
                {recentRows.length > 0 ? (
                  <div className="analytics-table__scroll">
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "numeric", "text"]}
                      headings={["Date (UTC)", "Country", "Postal region", "Result", "Days", "Source"]}
                      rows={recentRows}
                      increasedTableDensity
                    />
                  </div>
                ) : (
                  <Box paddingBlock="800">
                    <BlockStack gap="200" inlineAlign="center">
                      <Text as="h3" variant="headingMd">{data.total === 0 ? "No checks recorded yet" : "No checks match filters"}</Text>
                      <Text as="p" tone="subdued">{data.total === 0 ? "Storefront activity will appear here automatically." : "Clear search or choose All results."}</Text>
                      {data.total === 0 ? <Button url="/app/additional" variant="primary">Open setup guide</Button> : <Button onClick={() => { setQuery(""); setResult("all"); }}>Clear filters</Button>}
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
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Coverage health</Text>
                    <Badge tone={data.total === 0 ? undefined : data.availabilityRate >= 80 ? "success" : "critical"}>{data.total === 0 ? "No data" : `${data.availabilityRate}%`}</Badge>
                  </InlineStack>
                  <ProgressBar progress={data.availabilityRate} size="small" tone={data.total === 0 ? "primary" : data.availabilityRate >= 80 ? "success" : "critical"} />
                  <Text as="p" tone="subdued">
                    {data.total === 0
                      ? "Coverage health will appear after shoppers begin checking delivery."
                      : data.availabilityRate >= 80
                      ? "Most shopper locations receive a serviceable response."
                      : "Review unavailable regions and add targeted coverage rules."}
                  </Text>
                  <Button url="/app/delivery-settings?tab=coverage" fullWidth variant="primary">Fix coverage now</Button>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Top unavailable regions</Text>
                    <Badge tone="critical">{`${data.topUnavailable.length} groups`}</Badge>
                  </InlineStack>
                  {data.topUnavailable.length > 0 ? (
                    <>
                      <div className="analytics-table__scroll">
                        <DataTable columnContentTypes={["text", "numeric"]} headings={["Region", "Checks"]} rows={data.topUnavailable} increasedTableDensity />
                      </div>
                      <Button url="/app/delivery-settings?tab=coverage" fullWidth>Add missing rules</Button>
                    </>
                  ) : <Text as="p" tone="subdued">No unavailable regions in the recent sample.</Text>}
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Top checked regions</Text>
                  {data.topPostalCodes.length > 0 ? (
                    <div className="analytics-table__scroll">
                      <DataTable columnContentTypes={["text", "numeric"]} headings={["Region", "Checks"]} rows={data.topPostalCodes} increasedTableDensity />
                    </div>
                  ) : <Text as="p" tone="subdued">No postal-region data yet.</Text>}
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Top countries</Text>
                  {data.topCountries.length > 0 ? (
                    <div className="analytics-table__scroll">
                      <DataTable columnContentTypes={["text", "numeric"]} headings={["Country", "Checks"]} rows={data.topCountries} increasedTableDensity />
                    </div>
                  ) : <Text as="p" tone="subdued">No country data yet.</Text>}
                  <Text as="p" tone="subdued" variant="bodySm">Rankings use the latest {data.sampleSize} checks. Regions are masked, e.g. 400***.</Text>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
