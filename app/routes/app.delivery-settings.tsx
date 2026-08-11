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
import {
  fetchGoogleSheetCsv,
  importPostalCodesFromCsv,
} from "../services/postal-code-importer.server";
import { type BillingContext, getActiveBilling, requireFeature } from "../services/billing.server";
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
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const activeBilling = await getActiveBilling(shop, billing as unknown as BillingContext);

  const setting =
    (await prisma.deliverySetting.findUnique({ where: { shop } })) ??
    (await prisma.deliverySetting.findUnique({ where: { shop: "default" } }));

  const rows = await prisma.postalCode.findMany({
    where: { shop },
    orderBy: [{ country: "asc" }, { postalCode: "asc" }],
    take: 150,
  });

  const recentImports = await prisma.importJob.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 5,
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
      disableAddToCart: false,
      successMessage: "Delivery by {date}. {cod_message}{delivery_charge_message}",
      unavailableMessage: "Sorry, delivery is not available for this postal code.",
      codAvailableMessage: "COD available.",
      codUnavailableMessage: "Prepaid only.",
      deliveryChargeMessage: " Delivery charge: {currency}{delivery_charge}.",
      googleSheetCsvUrl: "",
      lastGoogleSheetSyncAt: null,
      lastGoogleSheetSyncStatus: null,
    },
    samplePostalCodes: rows,
    recentImports,
    activePlan: activeBilling.plan,
    features: activeBilling.features,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const activeBilling = await getActiveBilling(shop, billing as unknown as BillingContext);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save_settings") {
    const cutoffHour24 = Math.max(0, Math.min(23, Number(formData.get("cutoffHour24") ?? 14)));
    const courierEnabled = hasCourierIntegrationConfig()
      ? parseBool(formData.get("courierEnabled"))
      : false;
    const dbFallbackEnabled = parseBool(formData.get("dbFallbackEnabled"));
    const inventoryAwareEnabled = parseBool(formData.get("inventoryAwareEnabled"));
    const disableAddToCart = activeBilling.features.disableAddToCart ? parseBool(formData.get("disableAddToCart")) : false;
    const weekendDaysCsv = String(formData.get("weekendDaysCsv") ?? "0").trim() || "0";
    const courierTimeoutMs = Math.max(500, Number(formData.get("courierTimeoutMs") ?? 2000));
    const retryCount = Math.max(0, Math.min(3, Number(formData.get("retryCount") ?? 1)));
    const holidaysCsv = normalizeHolidayList(String(formData.get("holidaysCsv") ?? ""));
    const successMessage = activeBilling.features.customMessages ? String(formData.get("successMessage") ?? "").trim() : "Delivery by {date}. {cod_message}{delivery_charge_message}";
    const unavailableMessage = activeBilling.features.customMessages ? String(formData.get("unavailableMessage") ?? "").trim() : "Sorry, delivery is not available for this postal code.";
    const codAvailableMessage = activeBilling.features.customMessages ? String(formData.get("codAvailableMessage") ?? "").trim() : "COD available.";
    const codUnavailableMessage = activeBilling.features.customMessages ? String(formData.get("codUnavailableMessage") ?? "").trim() : "Prepaid only.";
    const deliveryChargeMessage = activeBilling.features.customMessages ? String(formData.get("deliveryChargeMessage") ?? "").trim() : " Delivery charge: {currency}{delivery_charge}.";

    await prisma.deliverySetting.upsert({
      where: { shop },
      create: {
        shop,
        cutoffHour24,
        courierEnabled,
        dbFallbackEnabled,
        inventoryAwareEnabled,
        disableAddToCart,
        weekendDaysCsv,
        courierTimeoutMs,
        retryCount,
        holidaysCsv,
        successMessage,
        unavailableMessage,
        codAvailableMessage,
        codUnavailableMessage,
        deliveryChargeMessage,
      },
      update: {
        cutoffHour24,
        courierEnabled,
        dbFallbackEnabled,
        inventoryAwareEnabled,
        disableAddToCart,
        weekendDaysCsv,
        courierTimeoutMs,
        retryCount,
        holidaysCsv,
        successMessage,
        unavailableMessage,
        codAvailableMessage,
        codUnavailableMessage,
        deliveryChargeMessage,
      },
    });

    return { ok: true, message: "Settings saved." } satisfies ActionData;
  }

  if (intent === "save_google_sheet") {
    requireFeature(activeBilling, "googleSheetSync");
    const googleSheetCsvUrl = String(formData.get("googleSheetCsvUrl") ?? "").trim() || null;
    if (googleSheetCsvUrl) {
      try {
        const url = new URL(googleSheetCsvUrl);
        if (url.protocol !== "https:" || !["docs.google.com", "drive.google.com"].includes(url.hostname)) {
          return { ok: false, message: "Use a published HTTPS Google Sheets CSV URL." } satisfies ActionData;
        }
      } catch {
        return { ok: false, message: "Enter a valid Google Sheets CSV URL." } satisfies ActionData;
      }
    }

    await prisma.deliverySetting.upsert({
      where: { shop },
      update: { googleSheetCsvUrl },
      create: { shop, googleSheetCsvUrl },
    });

    return { ok: true, message: "Google Sheet URL saved." } satisfies ActionData;
  }

  if (intent === "sync_google_sheet") {
    requireFeature(activeBilling, "googleSheetSync");
    const setting = await prisma.deliverySetting.findUnique({ where: { shop } });
    if (!setting?.googleSheetCsvUrl) {
      return { ok: false, message: "Save a Google Sheet CSV URL first." } satisfies ActionData;
    }

    try {
      const csv = await fetchGoogleSheetCsv(setting.googleSheetCsvUrl);
      const result = await importPostalCodesFromCsv(shop, csv, "google_sheet", {
        maxRows: activeBilling.features.maxPostalCodes,
        allowDeliveryCharges: activeBilling.features.deliveryCharges,
      });
      await prisma.deliverySetting.update({
        where: { shop },
        data: {
          lastGoogleSheetSyncAt: new Date(),
          lastGoogleSheetSyncStatus: result.status,
        },
      });
      return {
        ok: result.status !== "failed",
        message: `Google Sheet sync ${result.status}. Success: ${result.successRows}, Failed: ${result.failedRows}.`,
      } satisfies ActionData;
    } catch (error) {
      await prisma.deliverySetting.update({
        where: { shop },
        data: {
          lastGoogleSheetSyncAt: new Date(),
          lastGoogleSheetSyncStatus: "failed",
        },
      });
      return { ok: false, message: error instanceof Error ? error.message : "Google Sheet sync failed." } satisfies ActionData;
    }
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
    const deliveryChargeRaw = activeBilling.features.deliveryCharges ? String(formData.get("deliveryCharge") ?? "").trim() : "";
    const deliveryCharge = deliveryChargeRaw ? Number(deliveryChargeRaw) : null;
    const currency = activeBilling.features.deliveryCharges ? String(formData.get("currency") ?? "").trim().toUpperCase() || null : null;
    const sameDayAvailable = parseBool(formData.get("sameDayAvailable"));
    const nextDayAvailable = parseBool(formData.get("nextDayAvailable"));
    const expressAvailable = parseBool(formData.get("expressAvailable"));

    if (!validatePostalCode(country, postalCode)) {
      return { ok: false, message: "Please enter a valid postal code." } satisfies ActionData;
    }

    if (!Number.isInteger(deliveryDays) || deliveryDays < 0 || deliveryDays > 60) {
      return { ok: false, message: "Delivery days should be between 0 and 60." } satisfies ActionData;
    }

    if (deliveryCharge !== null && (!Number.isFinite(deliveryCharge) || deliveryCharge < 0 || !currency)) {
      return { ok: false, message: "Delivery charge requires a positive amount and 3-letter currency." } satisfies ActionData;
    }

    await prisma.postalCode.upsert({
      where: { shop_country_postalCode: { shop, country, postalCode } },
      create: {
        shop,
        country,
        postalCode,
        deliveryDays,
        serviceable,
        codAvailable,
        deliveryCharge,
        currency,
        sameDayAvailable,
        nextDayAvailable,
        expressAvailable,
        city,
        state,
        zone,
      },
      update: {
        deliveryDays,
        serviceable,
        codAvailable,
        deliveryCharge,
        currency,
        sameDayAvailable,
        nextDayAvailable,
        expressAvailable,
        city,
        state,
        zone,
      },
    });

    return { ok: true, message: "Postal code saved." } satisfies ActionData;
  }

  if (intent === "bulk_import_csv") {
    const file = formData.get("postalCodeCsv") ?? formData.get("pincodeCsv");
    if (!(file instanceof File)) {
      return { ok: false, message: "Please upload a CSV file." } satisfies ActionData;
    }

    if (file.size > 8 * 1024 * 1024) {
      return { ok: false, message: "CSV should be smaller than 8MB." } satisfies ActionData;
    }

    const text = await file.text();
    const result = await importPostalCodesFromCsv(shop, text, "csv", {
      maxRows: activeBilling.features.maxPostalCodes,
      allowDeliveryCharges: activeBilling.features.deliveryCharges,
    });

    return {
      ok: result.status !== "failed",
      message: `CSV import ${result.status}. Success: ${result.successRows}, Failed: ${result.failedRows}.`,
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
    const csv = [
      "country,postal_code,delivery_days,serviceable,cod_available,city,state,zone,delivery_charge,currency,same_day,next_day,express",
      ...lines,
    ].join("\n");
    const result = await importPostalCodesFromCsv(shop, csv, "csv", {
      maxRows: activeBilling.features.maxPostalCodes,
      allowDeliveryCharges: activeBilling.features.deliveryCharges,
    });

    return {
      ok: result.status !== "failed",
      message: `Manual import ${result.status}. Success: ${result.successRows}, Failed: ${result.failedRows}.`,
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
    disableAddToCart: data.setting.disableAddToCart,
    successMessage: data.setting.successMessage,
    unavailableMessage: data.setting.unavailableMessage,
    codAvailableMessage: data.setting.codAvailableMessage,
    codUnavailableMessage: data.setting.codUnavailableMessage,
    deliveryChargeMessage: data.setting.deliveryChargeMessage,
  });
  const [googleSheetCsvUrl, setGoogleSheetCsvUrl] = useState(data.setting.googleSheetCsvUrl ?? "");
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
    deliveryCharge: "",
    currency: "",
    serviceable: true,
    codAvailable: false,
    sameDayAvailable: false,
    nextDayAvailable: false,
    expressAvailable: false,
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
    row.serviceable ? <Badge key={`${row.id}-serviceable`} tone="success">Yes</Badge> : <Badge key={`${row.id}-serviceable`} tone="critical">No</Badge>,
    row.codAvailable ? <Badge key={`${row.id}-cod`} tone="success">Yes</Badge> : <Badge key={`${row.id}-cod`}>No</Badge>,
    row.deliveryCharge !== null && row.deliveryCharge !== undefined ? `${row.currency ?? ""} ${row.deliveryCharge}`.trim() : "-",
    row.city ?? "-",
    row.state ?? "-",
  ]);
  const importRows = data.recentImports.map((job) => [
    new Date(job.createdAt).toLocaleString(),
    job.source === "google_sheet" ? "Google Sheet" : "CSV",
    <Badge key={`${job.id}-status`} tone={job.status === "completed" ? "success" : job.status === "partial" ? "attention" : "critical"}>{job.status}</Badge>,
    job.totalRows,
    job.successRows,
    job.failedRows > 0 ? <Button key={`${job.id}-download`} url={`/app/import-errors/${job.id}`} size="slim">Download</Button> : "-",
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
      titleMetadata={<Badge tone="info">{data.activePlan ? `${data.activePlan} plan` : "No plan"}</Badge>}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {fetcher.data ? (
              <Banner tone={fetcher.data.ok ? "success" : "critical"}>
                {fetcher.data.message}
              </Banner>
            ) : null}

            {!data.features.googleSheetSync || !data.features.analytics || !data.features.csvExport ? (
              <Banner tone="info">
                Some features are plan-gated. Open Plans to upgrade or change your subscription.
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
                    <Checkbox
                      label="Disable Add to Cart when delivery is unavailable"
                      name="disableAddToCart"
                      checked={settings.disableAddToCart}
                      helpText="The storefront widget disables common product form buttons after an unavailable lookup."
                      onChange={(checked) =>
                        setSettings((current) => ({ ...current, disableAddToCart: checked }))
                      }
                    />

                    <TextField
                      label="Success message template"
                      name="successMessage"
                      value={settings.successMessage}
                      disabled={!data.features.customMessages}
                      onChange={(value) =>
                        setSettings((current) => ({ ...current, successMessage: value }))
                      }
                      autoComplete="off"
                      helpText="Variables: {date}, {days}, {cod_message}, {delivery_charge_message}, {country}, {postal_code}."
                    />
                    <TextField
                      label="Unavailable message"
                      name="unavailableMessage"
                      value={settings.unavailableMessage}
                      disabled={!data.features.customMessages}
                      onChange={(value) =>
                        setSettings((current) => ({ ...current, unavailableMessage: value }))
                      }
                      autoComplete="off"
                    />
                    <FormLayout.Group condensed>
                      <TextField
                        label="COD available message"
                        name="codAvailableMessage"
                        value={settings.codAvailableMessage}
                        disabled={!data.features.customMessages}
                        onChange={(value) =>
                          setSettings((current) => ({ ...current, codAvailableMessage: value }))
                        }
                        autoComplete="off"
                      />
                      <TextField
                        label="COD unavailable message"
                        name="codUnavailableMessage"
                        value={settings.codUnavailableMessage}
                        disabled={!data.features.customMessages}
                        onChange={(value) =>
                          setSettings((current) => ({ ...current, codUnavailableMessage: value }))
                        }
                        autoComplete="off"
                      />
                    </FormLayout.Group>
                    <TextField
                      label="Delivery charge message"
                      name="deliveryChargeMessage"
                      value={settings.deliveryChargeMessage}
                      disabled={!data.features.customMessages}
                      onChange={(value) =>
                        setSettings((current) => ({ ...current, deliveryChargeMessage: value }))
                      }
                      autoComplete="off"
                      helpText="Shown only when a delivery charge exists. Variables: {currency}, {delivery_charge}."
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
                  serviceable, cod_available, delivery_charge, currency, city,
                  state, zone, same_day, next_day, express.
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
                  <Button url={data.features.csvExport ? "/app/delivery-export" : undefined} disabled={!data.features.csvExport}>Export CSV</Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Google Sheet sync
                </Text>
                  <Text as="p" tone="subdued">
                  Paste a published Google Sheets CSV URL, then sync rows using the same import validation as CSV upload. Requires Starter or Advanced.
                </Text>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="save_google_sheet" />
                  <FormLayout>
                    <TextField
                      label="Google Sheet CSV URL"
                      name="googleSheetCsvUrl"
                      value={googleSheetCsvUrl}
                      disabled={!data.features.googleSheetSync}
                      onChange={setGoogleSheetCsvUrl}
                      autoComplete="off"
                      placeholder="https://docs.google.com/spreadsheets/d/.../pub?output=csv"
                    />
                    <InlineStack gap="300">
                      <Button submit loading={isSaving} disabled={!data.features.googleSheetSync}>Save URL</Button>
                    </InlineStack>
                  </FormLayout>
                </fetcher.Form>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="sync_google_sheet" />
                  <Button submit variant="primary" loading={isSaving} disabled={!data.features.googleSheetSync}>Sync now</Button>
                </fetcher.Form>
                <Text as="p" tone="subdued">
                  Last sync: {data.setting.lastGoogleSheetSyncAt ? new Date(data.setting.lastGoogleSheetSyncAt).toLocaleString() : "Never"}
                  {data.setting.lastGoogleSheetSyncStatus ? ` (${data.setting.lastGoogleSheetSyncStatus})` : ""}
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Import history
                </Text>
                {!data.features.importReports ? (
                  <Text as="p" tone="subdued">Import reports require Starter or Advanced.</Text>
                ) : importRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "numeric", "text"]}
                    headings={["Date", "Source", "Status", "Rows", "Success", "Failed rows"]}
                    rows={importRows}
                    increasedTableDensity
                  />
                ) : (
                  <Text as="p" tone="subdued">No imports yet.</Text>
                )}
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

                    <FormLayout.Group condensed>
                      <TextField
                        label="Delivery charge"
                        name="deliveryCharge"
                        type="number"
                        min={0}
                        value={postalCodeForm.deliveryCharge}
                        disabled={!data.features.deliveryCharges}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, deliveryCharge: value }))
                        }
                        placeholder="50"
                        autoComplete="off"
                      />
                      <TextField
                        label="Currency"
                        name="currency"
                        value={postalCodeForm.currency}
                        disabled={!data.features.deliveryCharges}
                        onChange={(value) =>
                          setPostalCodeForm((current) => ({ ...current, currency: value.toUpperCase() }))
                        }
                        placeholder="INR"
                        maxLength={3}
                        autoComplete="off"
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
                    <Checkbox
                      label="Same-day delivery available"
                      name="sameDayAvailable"
                      checked={postalCodeForm.sameDayAvailable}
                      onChange={(checked) =>
                        setPostalCodeForm((current) => ({ ...current, sameDayAvailable: checked }))
                      }
                    />
                    <Checkbox
                      label="Next-day delivery available"
                      name="nextDayAvailable"
                      checked={postalCodeForm.nextDayAvailable}
                      onChange={(checked) =>
                        setPostalCodeForm((current) => ({ ...current, nextDayAvailable: checked }))
                      }
                    />
                    <Checkbox
                      label="Express delivery available"
                      name="expressAvailable"
                      checked={postalCodeForm.expressAvailable}
                      onChange={(checked) =>
                        setPostalCodeForm((current) => ({ ...current, expressAvailable: checked }))
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
                        "US,10001,2,true,true,New York,New York,metro,8,USD,false,true,true\nGB,SW1A 1AA,3,true,false,London,England,metro,5,GBP,false,false,true"
                      }
                      helpText="One row per line: country, postal_code, delivery_days, serviceable, cod_available, city, state, zone, delivery_charge, currency, same_day, next_day, express."
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
                  columnContentTypes={["text", "text", "numeric", "text", "text", "text", "text", "text"]}
                  headings={["Country", "Postal code", "Days", "Serviceable", "COD", "Charge", "City", "State"]}
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
