import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  DataTable,
  DropZone,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { parseCsv } from "../utils/csv.server";
import {
  normalizeCountryCode,
  normalizePostalCode,
  validatePostalCode,
} from "../utils/delivery.server";

type ActionData = {
  ok: boolean;
  message: string;
};

const COUNTRY_OPTIONS = [
  { label: "Australia", value: "AU" },
  { label: "Canada", value: "CA" },
  { label: "France", value: "FR" },
  { label: "Germany", value: "DE" },
  { label: "India", value: "IN" },
  { label: "Italy", value: "IT" },
  { label: "Japan", value: "JP" },
  { label: "Netherlands", value: "NL" },
  { label: "New Zealand", value: "NZ" },
  { label: "Spain", value: "ES" },
  { label: "United Kingdom", value: "GB" },
  { label: "United States", value: "US" },
];

function parseBool(value: FormDataEntryValue | null): boolean {
  const normalized = String(value ?? "").toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
}

function normalizeHolidayList(csv: string): string {
  const values = csv
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));

  return [...new Set(values)].join(",");
}

function hasCourierIntegrationConfig() {
  return Boolean(
    process.env.SHIPROCKET_EMAIL &&
      process.env.SHIPROCKET_PASSWORD &&
      process.env.SHIPROCKET_PICKUP_PINCODE,
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const setting =
    (await prisma.deliverySetting.findUnique({ where: { shop } })) ??
    (await prisma.deliverySetting.findUnique({ where: { shop: "default" } }));

  const rows = await prisma.postalCode.findMany({
    where: { shop },
    orderBy: [{ country: "asc" }, { postalCode: "asc" }],
    take: 150,
  });

  return {
    shop,
    courierIntegrationAvailable: hasCourierIntegrationConfig(),
    setting: setting ?? {
      cutoffHour24: 14,
      holidaysCsv: "",
      courierEnabled: false,
      dbFallbackEnabled: true,
      inventoryAwareEnabled: false,
      weekendDaysCsv: "0",
      courierTimeoutMs: 2000,
      retryCount: 1,
    },
    samplePostalCodes: rows,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save_settings") {
    const cutoffHour24 = Math.max(0, Math.min(23, Number(formData.get("cutoffHour24") ?? 14)));
    const courierEnabled = hasCourierIntegrationConfig()
      ? parseBool(formData.get("courierEnabled"))
      : false;
    const dbFallbackEnabled = parseBool(formData.get("dbFallbackEnabled"));
    const inventoryAwareEnabled = parseBool(formData.get("inventoryAwareEnabled"));
    const weekendDaysCsv = String(formData.get("weekendDaysCsv") ?? "0").trim() || "0";
    const courierTimeoutMs = Math.max(500, Number(formData.get("courierTimeoutMs") ?? 2000));
    const retryCount = Math.max(0, Math.min(3, Number(formData.get("retryCount") ?? 1)));
    const holidaysCsv = normalizeHolidayList(String(formData.get("holidaysCsv") ?? ""));

    await prisma.deliverySetting.upsert({
      where: { shop },
      create: {
        shop,
        cutoffHour24,
        courierEnabled,
        dbFallbackEnabled,
        inventoryAwareEnabled,
        weekendDaysCsv,
        courierTimeoutMs,
        retryCount,
        holidaysCsv,
      },
      update: {
        cutoffHour24,
        courierEnabled,
        dbFallbackEnabled,
        inventoryAwareEnabled,
        weekendDaysCsv,
        courierTimeoutMs,
        retryCount,
        holidaysCsv,
      },
    });

    return { ok: true, message: "Settings saved." } satisfies ActionData;
  }

  if (intent === "add_holiday") {
    const holiday = String(formData.get("holidayDate") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday)) {
      return { ok: false, message: "Use holiday date format YYYY-MM-DD." } satisfies ActionData;
    }

    const setting =
      (await prisma.deliverySetting.findUnique({ where: { shop } })) ??
      (await prisma.deliverySetting.upsert({
        where: { shop },
        update: {},
        create: { shop, holidaysCsv: "" },
      }));

    const set = new Set(setting.holidaysCsv.split(",").map((x) => x.trim()).filter(Boolean));
    set.add(holiday);

    await prisma.deliverySetting.update({
      where: { shop },
      data: { holidaysCsv: [...set].sort().join(",") },
    });

    return { ok: true, message: "Holiday added." } satisfies ActionData;
  }

  if (intent === "remove_holiday") {
    const holiday = String(formData.get("holidayDate") ?? "").trim();
    const setting = await prisma.deliverySetting.findUnique({ where: { shop } });
    if (!setting) {
      return { ok: false, message: "No settings found for this shop." } satisfies ActionData;
    }

    const set = new Set(setting.holidaysCsv.split(",").map((x) => x.trim()).filter(Boolean));
    set.delete(holiday);

    await prisma.deliverySetting.update({
      where: { shop },
      data: { holidaysCsv: [...set].sort().join(",") },
    });

    return { ok: true, message: "Holiday removed." } satisfies ActionData;
  }

  if (intent === "upsert_single_postal_code") {
    const country = normalizeCountryCode(formData.get("country")?.toString());
    const postalCode = normalizePostalCode(
      country,
      String(formData.get("postalCode") ?? formData.get("pincode") ?? ""),
    );
    const deliveryDays = Number(formData.get("deliveryDays") ?? 0);
    const serviceable = parseBool(formData.get("serviceable"));
    const codAvailable = parseBool(formData.get("codAvailable"));
    const city = String(formData.get("city") ?? "").trim() || null;
    const state = String(formData.get("state") ?? "").trim() || null;
    const zone = String(formData.get("zone") ?? "").trim() || null;

    if (!validatePostalCode(country, postalCode)) {
      return { ok: false, message: "Please enter a valid postal code." } satisfies ActionData;
    }

    if (!Number.isInteger(deliveryDays) || deliveryDays < 0 || deliveryDays > 30) {
      return { ok: false, message: "Delivery days should be between 0 and 30." } satisfies ActionData;
    }

    await prisma.postalCode.upsert({
      where: { shop_country_postalCode: { shop, country, postalCode } },
      create: { shop, country, postalCode, deliveryDays, serviceable, codAvailable, city, state, zone },
      update: { deliveryDays, serviceable, codAvailable, city, state, zone },
    });

    return { ok: true, message: "Postal code saved." } satisfies ActionData;
  }

  if (intent === "bulk_import_csv") {
    const file = formData.get("postalCodeCsv") ?? formData.get("pincodeCsv");
    if (!(file instanceof File)) {
      return { ok: false, message: "Please upload a CSV file." } satisfies ActionData;
    }

    if (file.size > 2 * 1024 * 1024) {
      return { ok: false, message: "CSV should be smaller than 2MB." } satisfies ActionData;
    }

    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      return { ok: false, message: "CSV has no data rows." } satisfies ActionData;
    }

    let success = 0;
    let failed = 0;

    for (const row of rows.slice(0, 10000)) {
      const hasLegacyPincodeColumn = typeof row.pincode === "string" && !row.country;
      const country = normalizeCountryCode(row.country ?? (hasLegacyPincodeColumn ? "IN" : "US"));
      const postalCode = normalizePostalCode(country, String(row.postal_code ?? row.postalcode ?? row.pincode ?? ""));
      const deliveryDays = Number(row.delivery_days ?? row.deliverydays ?? "");
      const serviceable = String(row.serviceable ?? "true").toLowerCase() !== "false";
      const codAvailable = String(row.cod_available ?? row.codavailable ?? "false").toLowerCase() === "true";
      const city = String(row.city ?? "").trim() || null;
      const state = String(row.state ?? "").trim() || null;
      const zone = String(row.zone ?? "").trim() || null;

      if (!validatePostalCode(country, postalCode) || !Number.isInteger(deliveryDays) || deliveryDays < 0 || deliveryDays > 30) {
        failed += 1;
        continue;
      }

      await prisma.postalCode.upsert({
        where: { shop_country_postalCode: { shop, country, postalCode } },
        create: { shop, country, postalCode, deliveryDays, serviceable, codAvailable, city, state, zone },
        update: { deliveryDays, serviceable, codAvailable, city, state, zone },
      });
      success += 1;
    }

    return {
      ok: true,
      message: `CSV import completed. Success: ${success}, Failed: ${failed}.`,
    } satisfies ActionData;
  }

  if (intent === "bulk_manual_rows") {
    const raw = String(formData.get("manualRows") ?? "").trim();
    if (!raw) {
      return { ok: false, message: "Please paste at least one row." } satisfies ActionData;
    }

    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 1000);

    let success = 0;
    let failed = 0;

    for (const line of lines) {
      const parts = line.split(",").map((x) => x.trim());
      const isLegacyRow = parts.length === 7;
      const [countryRaw, postalCodeRaw, daysRaw, serviceableRaw, codRaw, cityRaw, stateRaw, zoneRaw] = isLegacyRow
        ? ["IN", ...parts]
        : parts;

      const country = normalizeCountryCode(countryRaw);
      const postalCode = normalizePostalCode(country, postalCodeRaw ?? "");
      const deliveryDays = Number(daysRaw ?? "");
      const serviceable = String(serviceableRaw ?? "true").toLowerCase() !== "false";
      const codAvailable = String(codRaw ?? "false").toLowerCase() === "true";
      const city = cityRaw || null;
      const state = stateRaw || null;
      const zone = zoneRaw || null;

      if (!validatePostalCode(country, postalCode) || !Number.isInteger(deliveryDays) || deliveryDays < 0 || deliveryDays > 30) {
        failed += 1;
        continue;
      }

      await prisma.postalCode.upsert({
        where: { shop_country_postalCode: { shop, country, postalCode } },
        create: { shop, country, postalCode, deliveryDays, serviceable, codAvailable, city, state, zone },
        update: { deliveryDays, serviceable, codAvailable, city, state, zone },
      });
      success += 1;
    }

    return {
      ok: true,
      message: `Manual import completed. Success: ${success}, Failed: ${failed}.`,
    } satisfies ActionData;
  }

  return { ok: false, message: "Unsupported action." } satisfies ActionData;
}

export default function DeliverySettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isSaving = fetcher.state !== "idle";
  const [settings, setSettings] = useState({
    cutoffHour24: String(data.setting.cutoffHour24),
    weekendDaysCsv: data.setting.weekendDaysCsv,
    courierTimeoutMs: String(data.setting.courierTimeoutMs),
    retryCount: String(data.setting.retryCount),
    holidaysCsv: data.setting.holidaysCsv,
    courierEnabled: data.courierIntegrationAvailable && data.setting.courierEnabled,
    dbFallbackEnabled: data.setting.dbFallbackEnabled,
    inventoryAwareEnabled: data.setting.inventoryAwareEnabled,
  });
  const [holidayDate, setHolidayDate] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvRejected, setCsvRejected] = useState(false);
  const [postalCodeForm, setPostalCodeForm] = useState({
    country: "US",
    postalCode: "",
    deliveryDays: "",
    zone: "",
    city: "",
    state: "",
    serviceable: true,
    codAvailable: false,
  });
  const [manualRows, setManualRows] = useState("");
  const holidays = data.setting.holidaysCsv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  const tableRows = data.samplePostalCodes.map((row) => [
    row.country,
    row.postalCode,
    row.deliveryDays,
    row.serviceable ? <Badge tone="success">Yes</Badge> : <Badge tone="critical">No</Badge>,
    row.codAvailable ? <Badge tone="success">Yes</Badge> : <Badge>No</Badge>,
    row.city ?? "-",
    row.state ?? "-",
  ]);

  const submitCsvImport = () => {
    if (!csvFile) return;

    const formData = new FormData();
    formData.append("intent", "bulk_import_csv");
    formData.append("postalCodeCsv", csvFile);
    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  return (
    <Page
      title="Delivery settings"
      subtitle="Manage delivery rules, postal code coverage, and storefront estimates."
      titleMetadata={<Badge tone="info">{`${data.samplePostalCodes.length} records`}</Badge>}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {fetcher.data ? (
              <Banner tone={fetcher.data.ok ? "success" : "critical"}>
                {fetcher.data.message}
              </Banner>
            ) : null}

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" gap="300" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      Quick settings
                    </Text>
                    <Text as="p" tone="subdued">
                      Active shop: {data.shop}
                    </Text>
                  </BlockStack>
                  <Badge tone={settings.courierEnabled ? "success" : "attention"}>
                    {settings.courierEnabled ? "Courier enabled" : "DB fallback"}
                  </Badge>
                </InlineStack>

                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="save_settings" />
                  <FormLayout>
                    <FormLayout.Group condensed>
                      <TextField
                        label="Cutoff hour"
                        name="cutoffHour24"
                        type="number"
                        min={0}
                        max={23}
                        value={settings.cutoffHour24}
                        onChange={(value) =>
                          setSettings((current) => ({ ...current, cutoffHour24: value }))
                        }
                        autoComplete="off"
                        helpText="Use 24-hour format, from 0 to 23."
                      />
                      <TextField
                        label="Weekend days"
                        name="weekendDaysCsv"
                        value={settings.weekendDaysCsv}
                        onChange={(value) =>
                          setSettings((current) => ({ ...current, weekendDaysCsv: value }))
                        }
                        autoComplete="off"
                        placeholder="0 or 0,6"
                        helpText="0 is Sunday and 6 is Saturday."
                      />
                    </FormLayout.Group>

                    <FormLayout.Group condensed>
                      <TextField
                        label="Courier timeout"
                        name="courierTimeoutMs"
                        type="number"
                        min={500}
                        suffix="ms"
                        value={settings.courierTimeoutMs}
                        onChange={(value) =>
                          setSettings((current) => ({ ...current, courierTimeoutMs: value }))
                        }
                        autoComplete="off"
                      />
                      <TextField
                        label="Retry count"
                        name="retryCount"
                        type="number"
                        min={0}
                        max={3}
                        value={settings.retryCount}
                        onChange={(value) =>
                          setSettings((current) => ({ ...current, retryCount: value }))
                        }
                        autoComplete="off"
                      />
                    </FormLayout.Group>

                    <TextField
                      label="Holidays CSV"
                      name="holidaysCsv"
                      value={settings.holidaysCsv}
                      onChange={(value) =>
                        setSettings((current) => ({ ...current, holidaysCsv: value }))
                      }
                      autoComplete="off"
                      placeholder="2026-01-26,2026-08-15"
                      helpText="Use YYYY-MM-DD dates separated by commas."
                    />

                    <Checkbox
                      label="Enable courier API as primary source"
                      name="courierEnabled"
                      checked={settings.courierEnabled}
                      disabled={!data.courierIntegrationAvailable}
                      helpText={
                        data.courierIntegrationAvailable
                          ? "Use the configured courier provider before falling back to uploaded postal code records. India-only courier checks use Shiprocket."
                          : "Courier provider credentials are not configured. Uploaded postal code records will be used."
                      }
                      onChange={(checked) =>
                        setSettings((current) => ({ ...current, courierEnabled: checked }))
                      }
                    />
                    <Checkbox
                      label="Enable DB fallback"
                      name="dbFallbackEnabled"
                      checked={settings.dbFallbackEnabled}
                      onChange={(checked) =>
                        setSettings((current) => ({ ...current, dbFallbackEnabled: checked }))
                      }
                    />
                    <Checkbox
                      label="Enable inventory-aware delivery estimates"
                      name="inventoryAwareEnabled"
                      checked={settings.inventoryAwareEnabled}
                      helpText="The storefront estimate uses the selected variant only when it is in stock."
                      onChange={(checked) =>
                        setSettings((current) => ({
                          ...current,
                          inventoryAwareEnabled: checked,
                        }))
                      }
                    />

                    <Button submit variant="primary" loading={isSaving}>
                      Save settings
                    </Button>
                  </FormLayout>
                </fetcher.Form>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Bulk postal code upload
                </Text>
                <Text as="p" tone="subdued">
                  CSV columns: country, postal_code, delivery_days,
                  serviceable, cod_available, city, state, zone.
                </Text>
                <DropZone
                  accept=".csv,text/csv"
                  allowMultiple={false}
                  error={csvRejected}
                  onDropAccepted={(files) => {
                    setCsvRejected(false);
                    setCsvFile(files[0] ?? null);
                  }}
                  onDropRejected={() => {
                    setCsvRejected(true);
                    setCsvFile(null);
                  }}
                >
                  <DropZone.FileUpload actionHint="Accepts one CSV file up to 2MB" />
                </DropZone>
                {csvFile ? (
                  <Text as="p" tone="subdued">
                    Selected file: {csvFile.name}
                  </Text>
                ) : null}
                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    disabled={!csvFile || isSaving}
                    loading={isSaving && Boolean(csvFile)}
                    onClick={submitCsvImport}
                  >
                    Import CSV
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Add one postal code
                </Text>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="upsert_single_postal_code" />
                  <FormLayout>
                    <FormLayout.Group condensed>
                      <Select
                        label="Country"
                        name="country"
                        options={COUNTRY_OPTIONS}
                        value={postalCodeForm.country}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, country: value }))
                        }
                      />
                      <TextField
                        label="Postal / ZIP code"
                        name="postalCode"
                        value={postalCodeForm.postalCode}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, postalCode: value }))
                        }
                        placeholder="10001 or SW1A 1AA"
                        autoComplete="postal-code"
                        requiredIndicator
                      />
                      <TextField
                        label="Delivery days"
                        name="deliveryDays"
                        type="number"
                        min={0}
                        max={30}
                        value={postalCodeForm.deliveryDays}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, deliveryDays: value }))
                        }
                        placeholder="2"
                        autoComplete="off"
                        requiredIndicator
                      />
                      <TextField
                        label="Zone"
                        name="zone"
                        value={postalCodeForm.zone}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, zone: value }))
                        }
                        placeholder="metro"
                        autoComplete="off"
                      />
                    </FormLayout.Group>

                    <FormLayout.Group condensed>
                      <TextField
                        label="City"
                        name="city"
                        value={postalCodeForm.city}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, city: value }))
                        }
                        placeholder="Mumbai"
                        autoComplete="address-level2"
                      />
                      <TextField
                        label="State"
                        name="state"
                        value={postalCodeForm.state}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, state: value }))
                        }
                        placeholder="Maharashtra"
                        autoComplete="address-level1"
                      />
                    </FormLayout.Group>

                    <Checkbox
                      label="Serviceable"
                      name="serviceable"
                      checked={postalCodeForm.serviceable}
                      onChange={(checked) =>
                        setPostalCodeForm((current) => ({ ...current, serviceable: checked }))
                      }
                    />
                    <Checkbox
                      label="COD available"
                      name="codAvailable"
                      checked={postalCodeForm.codAvailable}
                      onChange={(checked) =>
                        setPostalCodeForm((current) => ({ ...current, codAvailable: checked }))
                      }
                    />

                    <Button submit variant="primary" loading={isSaving}>
                      Save postal code
                    </Button>
                  </FormLayout>
                </fetcher.Form>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Add multiple postal codes manually
                </Text>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="bulk_manual_rows" />
                  <FormLayout>
                    <TextField
                      label="Manual rows"
                      name="manualRows"
                      value={manualRows}
                      onChange={setManualRows}
                      multiline={7}
                      monospaced
                      autoComplete="off"
                      placeholder={
                        "US,10001,2,true,true,New York,New York,metro\nGB,SW1A 1AA,3,true,false,London,England,metro"
                      }
                      helpText="One row per line, comma separated: country, postal_code, delivery_days, serviceable, cod_available, city, state, zone."
                      requiredIndicator
                    />
                    <Button submit variant="primary" loading={isSaving}>
                      Save manual rows
                    </Button>
                  </FormLayout>
                </fetcher.Form>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Recent records
                </Text>
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "text", "text", "text", "text"]}
                  headings={["Country", "Postal code", "Days", "Serviceable", "COD", "City", "State"]}
                  rows={tableRows}
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
                <Text as="h2" variant="headingMd">
                  Holiday dates
                </Text>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="add_holiday" />
                  <FormLayout>
                    <TextField
                      label="Holiday date"
                      name="holidayDate"
                      type="date"
                      value={holidayDate}
                      onChange={setHolidayDate}
                      autoComplete="off"
                      requiredIndicator
                    />
                    <Button submit variant="primary" loading={isSaving}>
                      Add holiday
                    </Button>
                  </FormLayout>
                </fetcher.Form>

                {holidays.length === 0 ? (
                  <Text as="p" tone="subdued">
                    No holidays added yet.
                  </Text>
                ) : (
                  <InlineStack gap="200">
                    {holidays.map((holiday) => (
                      <fetcher.Form key={holiday} method="post">
                        <input type="hidden" name="intent" value="remove_holiday" />
                        <input type="hidden" name="holidayDate" value={holiday} />
                        <Button submit size="slim">
                          {holiday} x
                        </Button>
                      </fetcher.Form>
                    ))}
                  </InlineStack>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Review checklist
                </Text>
                <Text as="p" tone="subdued">
                  Keep delivery messages accurate, avoid test data in production,
                  and verify the storefront extension before Shopify App Store
                  submission.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
