import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { injectedServer } from "./helpers/injected-server.mjs";

const readRoute = (name) => readFileSync(new URL(`../app/routes/${name}`, import.meta.url), "utf8");
const source = readRoute("app.delivery-settings.tsx");
const retired = {
  codAvailable: "true", deliveryCharge: "invalid", currency: "invalid",
  sameDayAvailable: "true", nextDayAvailable: "true", expressAvailable: "true",
  codAvailableMessage: "", codUnavailableMessage: "", deliveryChargeMessage: "",
};
const shop = "retired-admin.myshopify.com";

function fixture() {
  const writes = [];
  const imports = [];
  const load = injectedServer({});
  const plans = load("app/services/plans.server.ts");
  const legacyRule = { id: 3, shop, zoneId: 2, deliveryCharge: -1, currency: "broken", codAvailable: true };
  const prisma = {
    deliverySetting: { upsert: async (args) => writes.push(args) },
    deliveryTarget: { findUnique: async () => null, create: async (args) => writes.push(args) },
    zone: { findFirst: async () => ({ id: 2, shop, name: "Metro" }) },
    postalCode: {
      findFirst: async ({ where }) => where.id === 3 ? legacyRule : null,
      findMany: async () => [legacyRule],
      upsert: async (args) => writes.push(args),
      update: async (args) => writes.push(args),
      updateMany: async (args) => writes.push(args),
    },
    $transaction: async (callback) => callback(prisma),
  };
  const mocks = {
    "../db.server": prisma,
    "../services/billing.server": { requireActiveBilling: async () => ({ admin: {}, session: { shop } }) },
    "../services/plan-access.server": { resolvePlanAccess: async () => plans.accessForPlan("startup") },
    "../services/plans.server": plans,
    "../services/delivery-checker.server": { clearDeliveryCheckCaches: () => {} },
    "../services/postal-code-importer.server": { importPostalCodesFromCsv: async (...args) => {
      imports.push(args);
      return { status: "completed", successRows: 1, failedRows: 0 };
    } },
  };
  const compiled = ts.transpileModule(source, { fileName: "app.delivery-settings.tsx", compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier) => {
    if (specifier in mocks) return mocks[specifier];
    if (["react", "react-router", "react/jsx-runtime", "@shopify/polaris"].includes(specifier)) return {};
    if (specifier.startsWith("../utils/")) return load(`app/utils/${specifier.slice("../utils/".length)}.ts`);
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return {
    writes, imports,
    submit: (params) => module.exports.action({ request: new Request("https://fixture.test/app/delivery-settings", {
      method: "POST", body: new URLSearchParams(params),
    }) }),
  };
}

function assertNoRetiredWrites(writes) {
  for (const write of writes) {
    for (const data of [write.create, write.update, write.data].filter(Boolean)) {
      for (const key of Object.keys(retired)) assert.equal(key in data, false, `${key} must not be written`);
    }
  }
}

test("postal create and edit ignore forged retired fields and invalid persisted charges", async () => {
  for (const postalRuleId of ["", "3"]) {
    const f = fixture();
    const result = await f.submit({
      intent: "upsert_single_postal_code", postalRuleId, country: "US", postalCode: "10001",
      deliveryDays: "2", serviceable: "true", city: "New York", state: "NY", ...retired,
    });
    assert.equal(result.ok, true);
    assert.equal(f.writes.length, 1);
    assertNoRetiredWrites(f.writes);
    const data = f.writes[0].data ?? f.writes[0].create;
    assert.equal(data.deliveryDays, 2);
    assert.equal(data.city, "New York");
    assert.equal(data.state, "NY");
  }
});

test("bulk edits retain core fields without validating or writing retired values", async () => {
  const f = fixture();
  const forged = Object.fromEntries(Object.entries(retired).flatMap(([key, value]) => [[key, value], [`apply_${key}`, "true"]]));
  const result = await f.submit({
    intent: "bulk_update_zone_rules", zoneId: "2", postalRuleIds: "3",
    apply_city: "true", city: "New York", ...forged,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(f.writes[0].data, { city: "New York" });
  assertNoRetiredWrites(f.writes);
  const onlyRetired = fixture();
  assert.equal((await onlyRetired.submit({ intent: "bulk_update_zone_rules", zoneId: "2", postalRuleIds: "3", ...forged })).ok, false);
  assert.equal(onlyRetired.writes.length, 0);
});

test("settings saves strip persisted retired placeholders and ignore retired message fields", async () => {
  const f = fixture();
  const result = await f.submit({
    intent: "save_settings", successMessage: "Arrives {max_delivery_date}. {COD_MESSAGE, COD available}{delivery_charge_message}{currency}{delivery_charge}",
    unavailableMessage: "Not available.", ...retired,
  });
  assert.equal(result.ok, true);
  assertNoRetiredWrites(f.writes);
  assert.equal(f.writes[0].update.successMessage, "Arrives {max_delivery_date}.");
  assert.equal(f.writes[0].update.unavailableMessage, "Not available.");
});

test("product-message saves strip retired placeholders including fallback text", async () => {
  const f = fixture();
  const result = await f.submit({
    intent: "create_target", targetName: "Product", targetKind: "product", targetValue: "123",
    targetInventoryMode: "any", targetActivationMode: "always",
    targetCustomSuccessMessage: "Arrives {max_delivery_date}. {cod_message, Prepaid only}{delivery_charge_message}",
  });
  assert.equal(result.ok, true);
  assert.equal(f.writes[0].data.customSuccessMessage, "Arrives {max_delivery_date}.");
});

test("manual CSV imports use only retained columns", async () => {
  const f = fixture();
  assert.equal((await f.submit({ intent: "bulk_manual_rows", manualRows: "US,10001,2,true,New York,NY,Metro" })).ok, true);
  assert.equal(f.imports[0][1], "country,postal_code,delivery_days,serviceable,city,state,zone\nUS,10001,2,true,New York,NY,Metro");
});

test("admin controls, rule tables and exports do not expose retired features", () => {
  assert.doesNotMatch(source, /name="(?:codAvailable|codUnavailableMessage|codAvailableMessage|deliveryChargeMessage|deliveryCharge|currency|sameDayAvailable|nextDayAvailable|expressAvailable)"/);
  assert.doesNotMatch(source, /"COD"|"Charge"|"Options"|validatePatchedRule|features\.deliveryOptions/);
  assert.doesNotMatch(readRoute("app.delivery-export.ts"), /cod_available|delivery_charge|currency|same_day|next_day|express|row\.codAvailable/);
  assert.match(source, /"City", "State", "Actions"/);
  assert.match(source, /"Available", "Location", "Actions"/);
});

test("appearance excludes legacy service-badge sections from loads and saves", () => {
  const appearance = readRoute("app.storefront-customization.tsx");
  assert.match(appearance, /const ETA_CONTENT_SECTIONS = \["date", "journey"\]/);
  assert.doesNotMatch(appearance, /Service badges|storefrontShowServices|toggleEtaSection\("services"/);
  const normalize = appearance.slice(appearance.indexOf("function normalizeEtaSections"), appearance.indexOf("function readCustomization"));
  const compiled = ts.transpileModule(normalize, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function("ETA_CONTENT_SECTIONS", "value", `${compiled}\nreturn normalizeEtaSections(value);`);
  assert.equal(run(["date", "journey"], "date,services"), "date");
  assert.equal(run(["date", "journey"], "services"), "date,journey");
});
