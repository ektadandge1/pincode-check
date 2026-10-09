import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { injectedServer } from "./helpers/injected-server.mjs";

const shop = "service-rules.myshopify.com";
const source = readFileSync(new URL("../app/routes/app.service-rules.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  fileName: "app.service-rules.tsx",
}).outputText;
const load = injectedServer({});

function fixture({ catalog = { product: [{ label: "Alpha", value: "10" }] }, zone = { id: 7 }, count = 0, existing = null } = {}) {
  const writes = [];
  const invalidated = [];
  const prisma = {
    serviceAvailabilityRule: {
      findUnique: async () => null,
      findFirst: async () => existing,
      count: async () => count,
      create: async (args) => writes.push(args),
      update: async (args) => writes.push(args),
    },
    zone: {
      findFirst: async ({ where }) => where.shop === shop && where.id === zone?.id && where.enabled ? zone : null,
      count: async ({ where }) => zone && where.shop === shop && where.enabled ? where.id.in.filter((value) => value === zone.id).length : 0,
    },
  };
  const mocks = {
    "../db.server": prisma,
    "../services/billing.server": { requireActiveBilling: async () => ({ admin: {}, session: { shop } }) },
    "../services/plan-access.server": { resolvePlanAccess: async () => ({ features: { targeting: true } }) },
    "../services/delivery-checker.server": { clearDeliveryCheckCaches: (value) => invalidated.push(value) },
    "../services/shopify-target-suggestions.server": {
      loadShopifyTargetSuggestions: async () => ({ product: [], collection: [], vendor: [], tag: [] }),
      loadShopifyTargetSuggestionsForKind: async (_admin, kind) => catalog[kind] ?? [],
    },
    "../utils/targeting.server": load("app/utils/targeting.server.ts"),
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier) => {
    if (specifier in mocks) return mocks[specifier];
    if (["react", "react-router", "react/jsx-runtime", "@shopify/polaris"].includes(specifier)) return {};
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  const submit = (overrides = {}) => module.exports.action({ request: new Request("https://fixture.test/app/service-rules", {
    method: "POST",
    body: new URLSearchParams({
      intent: "save",
      name: "Alpha shipping restriction",
      targetKind: "product",
      targetValue: "10",
      priority: "100",
      shippingAvailable: "",
      localDeliveryAvailable: "on",
      pickupAvailable: "on",
      ...overrides,
    }),
  }) });
  return { submit, writes, invalidated, shouldRevalidate: module.exports.shouldRevalidate };
}

test("service rules save only authenticated Shopify targets and clear unsupported predicates", async () => {
  const f = fixture();
  assert.equal((await f.submit()).ok, true);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.invalidated, [shop]);
  assert.deepEqual(f.writes[0].data, {
    shop,
    name: "Alpha shipping restriction",
    targetKind: "product",
    targetValue: "10",
    priority: 100,
    shippingAvailable: false,
    localDeliveryAvailable: true,
    pickupAvailable: true,
    countryCode: null,
    stateRegion: null,
    inventoryMode: "any",
    activationMode: "always",
    activeFromLocal: null,
    activeUntilLocal: null,
    weekdaysCsv: "",
    startTimeLocal: null,
    endTimeLocal: null,
    enabled: true,
  });
});

test("service rules reject forged Shopify targets and foreign or disabled zones", async () => {
  const forged = fixture();
  assert.equal((await forged.submit({ targetValue: "999" })).ok, false);
  assert.equal(forged.writes.length, 0);

  const foreignZone = fixture({ zone: null });
  assert.equal((await foreignZone.submit({ targetKind: "zone", targetValue: "7" })).ok, false);
  assert.equal(foreignZone.writes.length, 0);
});

test("one service rule stores and validates multiple targets", async () => {
  const f = fixture({ catalog: { product: [{ label: "Alpha", value: "10" }, { label: "Beta", value: "20" }] } });
  const result = await f.submit({ targetValues: JSON.stringify(["10", "20"]) });
  assert.equal(result.ok, true);
  assert.equal(f.writes[0].data.targetValue, '["10","20"]');

  const invalid = fixture({ catalog: { product: [{ label: "Alpha", value: "10" }] } });
  assert.equal((await invalid.submit({ targetValues: JSON.stringify(["10", "999"]) })).ok, false);
  assert.equal(invalid.writes.length, 0);
});

test("service rules allow all-service exceptions and enforce the supported rule cap", async () => {
  const exception = fixture();
  assert.equal((await exception.submit({ shippingAvailable: "on" })).ok, true);
  assert.equal(exception.writes.length, 1);

  const capped = fixture({ count: 2_000 });
  assert.equal((await capped.submit()).ok, false);
  assert.equal(capped.writes.length, 0);
});

test("failed service-rule actions preserve unsaved form state", () => {
  const f = fixture();
  assert.equal(f.shouldRevalidate({ actionResult: { ok: false, message: "Invalid" }, defaultShouldRevalidate: true }), false);
  assert.equal(f.shouldRevalidate({ actionResult: { ok: true, message: "Saved" }, defaultShouldRevalidate: true }), true);
});
