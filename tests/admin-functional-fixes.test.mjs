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
  assert.match(locationsSource, /Each section saves independently/);
  assert.match(locationsSource, /name="section"/);
  assert.match(locationsSource, /value="status"/);
  assert.match(locationsSource, /value="routing"/);
  assert.match(locationsSource, /value="delivery"/);
  assert.match(locationsSource, /value="pickup"/);
  assert.match(locationsSource, /value="targeting"/);
  assert.match(locationsSource, /section !== "all"/);
  assert.match(locationsSource, />Save routing</);
  assert.match(locationsSource, />Save delivery</);
  assert.match(locationsSource, />Save pickup</);
  assert.match(locationsSource, />Save targeting</);
  assert.match(locationsSource, />Save status</);
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
});
