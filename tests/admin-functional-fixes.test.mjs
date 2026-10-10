import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { injectedServer } from "./helpers/injected-server.mjs";

const locationsSource = readFileSync(new URL("../app/routes/app.locations.tsx", import.meta.url), "utf8");
const deliverySource = readFileSync(new URL("../app/routes/app.delivery-settings.tsx", import.meta.url), "utf8");
const storefrontSource = readFileSync(new URL("../app/routes/app.storefront-customization.tsx", import.meta.url), "utf8");

test("countdown can be disabled and is owned by Delivery settings", () => {
  // Delivery settings allows empty audience when disabled.
  assert.match(deliverySource, /countdownEnabled && countdownTargetMode === "products"/);
  assert.match(deliverySource, /countdownEnabled && countdownTargetMode === "collections"/);
  assert.match(deliverySource, /countdownEnabled && countdownTargetMode === "zones"/);
  // Storefront style preserves enablement instead of overwriting it.
  assert.match(storefrontSource, /countdownEnabled: existing\?\.countdownEnabled/);
  assert.match(storefrontSource, /countdownEnabledForStyle/);
  // Title is required only when the countdown is enabled.
  assert.match(storefrontSource, /Countdown heading is required when the countdown is enabled/);
  assert.doesNotMatch(storefrontSource, /Countdown heading is required and must be 80 characters/);
});

test("location sections save independently", () => {
  assert.match(locationsSource, /name="section"/);
  assert.match(locationsSource, /value="status"/);
  assert.match(locationsSource, /value="routing"/);
  assert.match(locationsSource, /value="delivery"/);
  assert.match(locationsSource, /value="pickup"/);
  assert.match(locationsSource, /section !== "all"/);
  assert.match(locationsSource, /Save routing/);
  assert.match(locationsSource, /Save delivery/);
  assert.match(locationsSource, /Save pickup/);
  assert.match(locationsSource, /Save status/);
  assert.match(locationsSource, /localDeliveryTargetMode/);
  assert.match(locationsSource, /pickupTargetMode/);
  assert.doesNotMatch(locationsSource, /value="targeting"/);
  assert.match(locationsSource, /savedData\.values/);
  assert.doesNotMatch(locationsSource, /LOCATION_SECTION_FIELDS/);
  assert.match(locationsSource, /if \(!saved \|\| saved\.id !== location\.id\) return \[location\.id, existing\]/);
});

test("google sheet sync uses the unsaved field value", () => {
  assert.match(deliverySource, /submittedSheetUrl/);
  assert.match(deliverySource, /effectiveSheetUrl/);
  assert.match(deliverySource, /name="googleSheetCsvUrl" value=\{googleSheetCsvUrl\}/);
});

test("delivery settings disables conflicting actions while saving", () => {
  assert.match(deliverySource, /const pageBusy = isSaving \|\| countdownSaving/);
  assert.match(deliverySource, /disabled=\{!isAdvanced \|\| pageBusy\}/);
  assert.match(deliverySource, /disabled=\{pageBusy\}/);
});

test("deleting a zone also deletes its postal coverage rules", () => {
  const deleteZoneAction = deliverySource.slice(
    deliverySource.indexOf('if (intent === "delete_zone")'),
    deliverySource.indexOf('if (intent === "toggle_zone")'),
  );
  assert.match(deleteZoneAction, /tx\.postalCode\.deleteMany/);
  assert.match(deleteZoneAction, /\{ zoneId \}/);
  assert.match(deleteZoneAction, /\{ zoneId: null, zone: zone\.name \}/);
  assert.doesNotMatch(deleteZoneAction, /tx\.postalCode\.updateMany/);
  assert.match(deliverySource, /and its .* postal/);
  assert.doesNotMatch(deliverySource, /Deletion blocked to prevent reactivating rules/);
});

test("catalog failures are exposed instead of empty lists", () => {
  assert.match(deliverySource, /let catalogError = ""/);
  assert.match(deliverySource, /Product catalog unavailable/);
  assert.match(deliverySource, /Only the first 5,000 are shown/);
  assert.doesNotMatch(deliverySource, /if \(!response\.ok\) break;/);
});

test("shopify locations paginate beyond 100 with a warning", () => {
  assert.match(locationsSource, /DeliveryLocationsNext/);
  assert.match(locationsSource, /pageInfo \{ hasNextPage endCursor \}/);
  assert.match(locationsSource, /Only the first locations could be loaded|More than 100 Shopify locations/);
});

function locationFixture({ existing = null } = {}) {
  const writes = [];
  const source = locationsSource;
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: "app.locations.tsx",
  }).outputText;
  const load = injectedServer({});
  const shop = "scoped-test.myshopify.com";
  const id = "gid://shopify/Location/123";
  const location = {
    id,
    name: "Scoped Store",
    isActive: true,
    fulfillsOnlineOrders: true,
    address: null,
  };
  const admin = {
    graphql: async (query) => {
      if (query.includes("VerifyDeliveryLocation") || query.includes("location(id:")) {
        return Response.json({ data: { location } });
      }
      return Response.json({
        data: {
          locations: { nodes: [location], pageInfo: { hasNextPage: false, endCursor: null } },
          products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          collections: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      });
    },
  };
  const mocks = {
    "../db.server": {
      fulfillmentLocationRule: {
        findMany: async () => [],
        findUnique: async () => existing,
        upsert: async (args) => {
          writes.push(args);
          return args;
        },
      },
      deliverySetting: { findUnique: async () => null },
      zone: { findMany: async () => [], count: async () => 1 },
    },
    "../services/billing.server": { requireActiveBilling: async () => ({ admin, session: { shop, scope: "" } }) },
    "../services/plan-access.server": { resolvePlanAccess: async () => ({ active: true, features: { inventory: true } }) },
    "../services/plans.server": { NO_PLAN_ACCESS: {} },
    "../services/delivery-checker.server": { clearDeliveryCheckCaches: () => {} },
    "../services/shopify-target-suggestions.server": { loadShopifyTargetSuggestionsForKind: async () => [{ label: "Verified", value: "10" }] },
    "../utils/delivery.server": load("app/utils/delivery.server.ts"),
    "../utils/countries": load("app/utils/countries.ts"),
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier) => {
    if (specifier in mocks) return mocks[specifier];
    if (["react", "react-router", "react/jsx-runtime", "@shopify/polaris"].includes(specifier)) return {};
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  const submit = (params) => module.exports.action({
    request: new Request("https://fixture.test/app/locations", {
      method: "POST",
      body: new URLSearchParams({ intent: "save_location", shopifyLocationId: id, ...params }),
    }),
  });
  return { submit, writes };
}

test("scoped routing save ignores invalid pickup data", async () => {
  const f = locationFixture({ existing: null });
  const result = await f.submit({
    section: "routing",
    priority: "10",
    processingDays: "",
    transitDays: "",
    // Invalid pickup data that would block a whole-form save.
    pickupEnabled: "on",
    pickupPreparationDays: "bad",
    pickupAdvanceDays: "bad",
    pickupWeekdaysCsv: "",
    pickupBlockedDatesCsv: "",
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /routing saved/);
  assert.equal(f.writes.length, 1);
});

test("scoped pickup save ignores invalid routing data", async () => {
  const f = locationFixture({ existing: null });
  const result = await f.submit({
    section: "pickup",
    pickupEnabled: "on",
    pickupInstructions: "",
    pickupPhone: "",
    pickupPreparationDays: "2",
    pickupAdvanceDays: "30",
    pickupWeekdaysCsv: "1,2,3",
    pickupBlockedDatesCsv: "",
    // Invalid routing data that would block a whole-form save.
    priority: "99999",
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /pickup saved/);
});

test("scoped delivery save validates only its own section", async () => {
  const f = locationFixture({ existing: null });
  const bad = await f.submit({
    section: "delivery",
    localDeliveryEnabled: "on",
    localDeliveryCoverageMode: "postal",
    localDeliveryCountry: "",
    localDeliveryPostalCodesCsv: "",
    localDeliveryZoneIdsCsv: "",
  });
  assert.equal(bad.ok, false);

  const good = await f.submit({
    section: "delivery",
    localDeliveryEnabled: "on",
    localDeliveryCoverageMode: "postal",
    localDeliveryCountry: "US",
    localDeliveryPostalCodesCsv: "10001",
    localDeliveryZoneIdsCsv: "",
  });
  assert.equal(good.ok, true);
  assert.deepEqual(good.saved, {
    locationId: "gid://shopify/Location/123",
    section: "delivery",
    values: {
      enabled: true,
      localDeliveryEnabled: true,
      localDeliveryCountry: "US",
      localDeliveryPostalCodesCsv: "10001",
      localDeliveryCoverageMode: "postal",
      localDeliveryZoneIdsCsv: "",
      localDeliveryTargetMode: "all",
      localDeliveryTargetValuesCsv: "",
      localDeliveryServiceRuleId: "",
    },
  });
});

test("turning services off ignores stale hidden settings and preserves their configuration", async () => {
  const existing = { enabled: true, pickupEnabled: true, localDeliveryEnabled: true, priority: 100, processingDays: null, transitDays: null };
  const delivery = locationFixture({ existing });
  const deliveryResult = await delivery.submit({
    section: "delivery",
    localDeliveryEnabled: "",
    localDeliveryCoverageMode: "invalid",
    localDeliveryCountry: "XX",
    localDeliveryPostalCodesCsv: "invalid pattern",
    localDeliveryZoneIdsCsv: "foreign",
  });
  assert.equal(deliveryResult.ok, true);
  assert.equal(delivery.writes[0].update.localDeliveryEnabled, false);
  assert.equal("localDeliveryCountry" in delivery.writes[0].update, false);
  assert.equal(deliveryResult.saved.values.localDeliveryEnabled, false);

  const pickup = locationFixture({ existing });
  assert.equal((await pickup.submit({
    section: "pickup",
    pickupEnabled: "",
    pickupPreparationDays: "invalid",
    pickupAdvanceDays: "invalid",
    pickupWeekdaysCsv: "",
    pickupBlockedDatesCsv: "invalid",
  })).ok, true);
  assert.equal(pickup.writes[0].update.pickupEnabled, false);
  assert.equal("pickupPreparationDays" in pickup.writes[0].update, false);
});

test("location audience rejects forged Shopify targets", async () => {
  const f = locationFixture({ existing: null });
  const result = await f.submit({ section: "targeting", serviceTargetMode: "product", serviceTargetValuesCsv: "999" });
  assert.equal(result.ok, false);
  assert.equal(f.writes.length, 0);

  const valid = locationFixture({ existing: null });
  assert.equal((await valid.submit({ section: "targeting", serviceTargetMode: "product", serviceTargetValuesCsv: "10" })).ok, true);
  assert.equal(valid.writes[0].create.serviceTargetValuesCsv, "10");
});

test("location audience persists selection removal and switching back to all products", async () => {
  const existing = { enabled: true, pickupEnabled: true, localDeliveryEnabled: false, priority: 100, processingDays: null, transitDays: null };
  const reduced = locationFixture({ existing });
  assert.equal((await reduced.submit({ section: "targeting", serviceTargetMode: "product", serviceTargetValuesCsv: "10" })).ok, true);
  assert.deepEqual(reduced.writes[0].update, {
    name: "Scoped Store",
    localDeliveryTargetMode: "product",
    localDeliveryTargetValuesCsv: "10",
    pickupTargetMode: "product",
    pickupTargetValuesCsv: "10",
    serviceTargetMode: "product",
    serviceTargetValuesCsv: "10",
  });

  const cleared = locationFixture({ existing });
  assert.equal((await cleared.submit({ section: "targeting", serviceTargetMode: "all", serviceTargetValuesCsv: "" })).ok, true);
  assert.deepEqual(cleared.writes[0].update, {
    name: "Scoped Store",
    localDeliveryTargetMode: "all",
    localDeliveryTargetValuesCsv: "",
    pickupTargetMode: "all",
    pickupTargetValuesCsv: "",
    serviceTargetMode: "all",
    serviceTargetValuesCsv: "",
  });
});

test("local delivery and pickup audiences save independently", async () => {
  const delivery = locationFixture({ existing: { enabled: true, pickupEnabled: true, localDeliveryEnabled: true } });
  assert.equal((await delivery.submit({
    section: "delivery",
    localDeliveryEnabled: "on",
    localDeliveryCoverageMode: "postal",
    localDeliveryCountry: "US",
    localDeliveryPostalCodesCsv: "10001",
    localDeliveryTargetMode: "product",
    localDeliveryTargetValuesCsv: "10",
  })).ok, true);
  assert.equal(delivery.writes[0].update.localDeliveryTargetMode, "product");
  assert.equal(delivery.writes[0].update.localDeliveryTargetValuesCsv, "10");
  assert.equal("pickupTargetMode" in delivery.writes[0].update, false);

  const pickup = locationFixture({ existing: { enabled: true, pickupEnabled: true, localDeliveryEnabled: true } });
  assert.equal((await pickup.submit({
    section: "pickup",
    pickupEnabled: "on",
    pickupPreparationDays: "2",
    pickupAdvanceDays: "30",
    pickupWeekdaysCsv: "1,2,3",
    pickupTargetMode: "product",
    pickupTargetValuesCsv: "10",
  })).ok, true);
  assert.equal(pickup.writes[0].update.pickupTargetMode, "product");
  assert.equal(pickup.writes[0].update.pickupTargetValuesCsv, "10");
  assert.equal("localDeliveryTargetMode" in pickup.writes[0].update, false);
});

test("location audience uses one canonical multi-select with removable selections", () => {
  assert.match(locationsSource, /<Autocomplete\s+allowMultiple/);
  assert.match(locationsSource, /name=\{name\} value=\{value\}/);
  assert.match(locationsSource, /selected\.filter\(\(item\) => item !== selectedValue\)/);
  assert.match(locationsSource, />Clear all</);
});
