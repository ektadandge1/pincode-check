import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { matchDeliveryTarget } from "../app/utils/targeting.server.ts";
import { STANDARD_FEATURES } from "../app/services/plans.server.ts";
import { injectedServer } from "./helpers/injected-server.mjs";

const features = { ...STANDARD_FEATURES, analytics: false };
const input = { shop: "zones.myshopify.com", country: "US", postalCode: "10001", features, trackAnalytics: false };
const target = (overrides = {}) => ({
  id: 1, shop: input.shop, name: "Collection A", targetKind: "collection", targetValue: "a",
  zoneIdsCsv: "7", countryCode: null, stateRegion: null, inventoryMode: "any", activationMode: "always",
  requireValidPin: false, processingDays: 1, transitDays: 2, excluded: false, enabled: true, priority: 100,
  shippingAvailable: true, localDeliveryAvailable: true, pickupAvailable: true, ...overrides,
});
const threeCollections = [
  target(),
  target({ id: 2, name: "Collection B", targetValue: "b", processingDays: 2, transitDays: 4 }),
  target({ id: 3, name: "Collection C", targetValue: "c", processingDays: 3, transitDays: 6 }),
];
const postal = (overrides = {}) => ({
  id: 1, shop: input.shop, country: "US", postalCode: "10001", patternType: "exact",
  rangeStart: null, rangeEnd: null, zoneId: 7,
  zoneGroup: { id: 7, name: "Zone 7", enabled: true, priority: 100 },
  zone: "Zone 7", city: null, state: "NY", serviceable: true, deliveryDays: 9, codAvailable: false,
  deliveryCharge: null, currency: null, sameDayAvailable: false, nextDayAvailable: false, expressAvailable: false,
  ...overrides,
});
const batchItems = ["a", "b", "c"].map((handle, index) => ({
  key: handle, productId: String(index + 1), productVendor: "Canonical", productTags: [], collectionHandles: [handle],
}));

function fixture({ targets = threeCollections, rows = [postal()], setting = {}, serviceRules = [], inventoryFailure = false } = {}) {
  const calls = { exact: 0, patterns: 0, targets: 0, inventory: 0 };
  const admin = { graphql: async (query, { variables } = {}) => {
    if (query.includes("DeliveryCheckerProductContexts")) {
      return Response.json({ data: { nodes: variables.ids.map((id) => {
        const number = Number(id.split("/").at(-1));
        return { id, vendor: "Canonical", tags: [], collections: {
          nodes: [{ handle: ["a", "b", "c"][number - 1] ?? "other" }], pageInfo: { hasNextPage: false },
        } };
      }) } });
    }
    calls.inventory += 1;
    if (inventoryFailure) return Response.json({ errors: [{ message: "Unavailable" }] });
    return Response.json({ data: { productVariant: {
      sellableOnlineQuantity: 10, inventoryPolicy: "DENY",
      inventoryItem: { inventoryLevels: { nodes: [], pageInfo: { hasNextPage: false } } },
    } } });
  } };
  const defaults = {
    cutoffHour24: 14, processingDays: 0, deliveryWindowDays: 2, dateFormat: "weekday_day_month",
    timeZone: "UTC", locale: "en", fallbackDays: 5, courierTimeoutMs: 2000, retryCount: 1,
    courierEnabled: false, dbFallbackEnabled: true, inventoryAwareEnabled: false, locationPriorityMode: "manual",
    holidaysCsv: "", weekendDaysCsv: "0", disableAddToCart: true, requireValidPin: true,
    successMessage: "Delivery {processing_days}/{transit_days}", unavailableMessage: "Unavailable",
    codAvailableMessage: "COD", codUnavailableMessage: "Prepaid", deliveryChargeMessage: "",
    shippingMethodDisplayStyle: "visual", ...setting,
  };
  const prisma = {
    deliverySetting: { findUnique: async () => defaults },
    deliveryTarget: { findMany: async () => { calls.targets += 1; return targets.filter((rule) => rule.enabled); } },
    serviceAvailabilityRule: { findMany: async () => serviceRules },
    postalCode: {
      findFirst: async ({ where }) => {
        calls.exact += 1;
        return rows.find((row) => row.patternType === "exact" && row.country === where.country
          && (typeof where.postalCode === "string" ? row.postalCode === where.postalCode : where.postalCode.in.includes(row.postalCode))) ?? null;
      },
      findMany: async ({ where }) => { calls.patterns += 1; return rows.filter((row) => row.patternType !== "exact" && row.country === where.country); },
    },
    fulfillmentLocationRule: { findMany: async () => [] }, shippingMethodRule: { findMany: async () => [] },
    headlessApiToken: {
      findUnique: async () => ({ id: "zones", shop: input.shop, tokenType: "private", enabled: true, scopesCsv: "delivery:estimate,delivery:batch,delivery:check" }),
      update: async () => ({}),
    },
    session: { findFirst: async () => ({}) },
    $transaction: async (callback) => callback({ headlessRateLimit: { upsert: async () => ({ count: 1 }), deleteMany: async () => ({}) } }),
  };
  const load = injectedServer({
    "app/db.server.ts": prisma,
    "app/shopify.server.ts": {
      authenticate: { public: { appProxy: async () => ({ session: { shop: input.shop }, admin }) } },
      unauthenticated: { admin: async () => ({ admin }) },
    },
    "app/services/plan-access.server.ts": { resolvePlanAccess: async () => ({ active: true, features }) },
    "app/services/billing.server.ts": { billingRequiredResponse: () => { throw new Error("Unexpected billing response"); } },
  });
  const service = load("app/services/delivery-checker.server.ts");
  const route = load("app/routes/apps.delivery-checker.ts");
  const handler = load("app/services/headless-api.server.ts").handleHeadlessRequest;
  return { service, route, handler, admin, calls };
}

test("zone restrictions are OR zones AND product, collection, vendor or tag", () => {
  for (const [kind, value, context] of [
    ["product", "1", { productId: "1" }], ["collection", "a", { collectionHandles: ["a"] }],
    ["vendor", "acme", { vendor: "ACME" }], ["tag", "sale", { tags: ["Sale"] }],
  ]) {
    const rule = target({ targetKind: kind, targetValue: value, zoneIdsCsv: "7, 8" });
    for (const zoneId of [7, "8"]) assert.equal(matchDeliveryTarget([rule], { ...context, zoneId })?.id, 1, kind);
    for (const zoneId of [9, null, undefined]) assert.equal(matchDeliveryTarget([rule], { ...context, zoneId }), null, kind);
    assert.equal(matchDeliveryTarget([rule], { zoneId: 7 }), null, kind);
  }
});

test("blank or absent restrictions retain existing all-zone behavior; malformed CSV fails closed", () => {
  for (const zoneIdsCsv of [undefined, "", "  "]) {
    assert.equal(matchDeliveryTarget([target({ zoneIdsCsv })], { collectionHandles: ["a"] })?.id, 1);
  }
  for (const zoneIdsCsv of [",", "7,", ",7", "7,,8", "7,invalid", "invalid", "0", "-7", "07", "7.0", "7|8", '["7"]', "7,8e0"]) {
    assert.equal(matchDeliveryTarget([target({ zoneIdsCsv })], { collectionHandles: ["a"], zoneId: 7 }), null, zoneIdsCsv);
  }
  assert.equal(matchDeliveryTarget([target({ zoneIdsCsv: "7,7" })], { collectionHandles: ["a"], zoneId: 7 })?.id, 1);
});

test("restrictions preserve kind rank, priority, ID tie-breaks and existing predicates", () => {
  const context = { productId: "1", collectionHandles: ["a"], vendor: "Acme", tags: ["sale"], zoneId: 7, country: "US", state: "NY", inventoryStatus: "in_stock" };
  const rules = [
    target({ id: 5, targetKind: "zone", targetValue: "7", priority: 0 }),
    target({ id: 4, targetKind: "tag", targetValue: "sale", priority: 1 }),
    target({ id: 3, targetKind: "vendor", targetValue: "acme", priority: 2 }),
    target({ id: 2, priority: 3 }),
    target({ id: 1, targetKind: "product", targetValue: "1", priority: 999 }),
  ];
  for (let id = 1; id <= 5; id += 1) assert.equal(matchDeliveryTarget(rules.filter((rule) => rule.id >= id), context)?.id, id);
  assert.equal(matchDeliveryTarget([target({ id: 3, priority: 2 }), target({ id: 2, priority: 2 }), target({ id: 4, priority: 1 })], context)?.id, 4);
  assert.equal(matchDeliveryTarget([target({ id: 3 }), target({ id: 2 })], context)?.id, 2);
  assert.equal(matchDeliveryTarget([target(), target({ id: 6, zoneIdsCsv: "", priority: 1 })], context)?.id, 6);
  for (const overrides of [{ enabled: false }, { countryCode: "IN" }, { stateRegion: "CA" }, { inventoryMode: "backorder" }, { activationMode: "date_range" }]) {
    assert.equal(matchDeliveryTarget([target(overrides)], context), null);
  }
});

test("additive SQLite migration preserves existing restrictions and defaults existing/new rules to all zones", async (t) => {
  const sql = readFileSync(new URL("../prisma/migrations/20261010140000_delivery_target_zones/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER TABLE "DeliveryTarget" ADD COLUMN "zoneIdsCsv" TEXT NOT NULL DEFAULT ''/);
  assert.doesNotMatch(sql, /DROP|DELETE|ServiceAvailabilityRule/i);
  const directory = await mkdtemp("/tmp/opencode/product-rule-zones-");
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${directory}/test.sqlite?connection_limit=1` } } });
  t.after(async () => {
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });
  await prisma.$executeRawUnsafe('CREATE TABLE "DeliveryTarget" ("id" INTEGER PRIMARY KEY, "targetValue" TEXT NOT NULL, "countryCode" TEXT, "inventoryMode" TEXT, "activationMode" TEXT, "transitDays" INTEGER)');
  await prisma.$executeRawUnsafe('INSERT INTO "DeliveryTarget" VALUES (1, \'a\', \'US\', \'backorder\', \'weekly\', 8)');
  const [before] = await prisma.$queryRawUnsafe('SELECT * FROM "DeliveryTarget"');
  await prisma.$executeRawUnsafe(sql);
  const [existing] = await prisma.$queryRawUnsafe('SELECT "id", "targetValue", "countryCode", "inventoryMode", "activationMode", "transitDays", "zoneIdsCsv" FROM "DeliveryTarget"');
  assert.deepEqual(existing, { ...before, zoneIdsCsv: "" });
  await prisma.$executeRawUnsafe('INSERT INTO "DeliveryTarget" ("id", "targetValue") VALUES (2, \'b\')');
  const [created] = await prisma.$queryRawUnsafe('SELECT "zoneIdsCsv" FROM "DeliveryTarget" WHERE "id" = 2');
  assert.equal(created.zoneIdsCsv, "");
  await prisma.$executeRawUnsafe('UPDATE "DeliveryTarget" SET "zoneIdsCsv" = \'7,8\' WHERE "id" = 1');
  const [selected] = await prisma.$queryRawUnsafe('SELECT "zoneIdsCsv" FROM "DeliveryTarget" WHERE "id" = 1');
  assert.equal(selected.zoneIdsCsv, "7,8");
});

test("actual delivery matches three independent collection timing rules for the same zone", async () => {
  const { service } = fixture();
  for (let index = 0; index < threeCollections.length; index += 1) {
    const rule = threeCollections[index];
    const result = await service.checkDelivery({ ...input, productId: String(index + 1), collectionHandles: [rule.targetValue] });
    assert.equal(result.available, true);
    assert.equal(result.zone_id, 7);
    assert.equal(result.matched_target, rule.name);
    assert.equal(result.processing_days, rule.processingDays);
    assert.equal(result.transit_days, rule.transitDays);
    assert.equal(result.delivery_days, rule.processingDays + rule.transitDays);
    assert.equal(result.require_valid_pin, false);
  }
});

test("actual delivery accepts multiple selected zones and retains postal/shop timing outside them", async () => {
  const { service } = fixture({ targets: [target({ zoneIdsCsv: "7,8" })], rows: [
    postal(), postal({ id: 2, postalCode: "10002", zoneId: 8, zoneGroup: { id: 8, name: "Zone 8", enabled: true, priority: 1 } }),
    postal({ id: 3, postalCode: "10003", zoneId: 9, zoneGroup: { id: 9, name: "Zone 9", enabled: true, priority: 1 } }),
    postal({ id: 4, postalCode: "10004", zoneId: null, zoneGroup: null }),
  ] });
  for (const postalCode of ["10001", "10002"]) assert.equal((await service.checkDelivery({ ...input, postalCode, collectionHandles: ["a"] })).matched_target, "Collection A");
  for (const postalCode of ["10003", "10004"]) {
    const result = await service.checkDelivery({ ...input, postalCode, collectionHandles: ["a"], zoneId: 7 });
    assert.equal(result.available, true);
    assert.equal(result.matched_target, null);
    assert.equal(result.processing_days, 0);
    assert.equal(result.transit_days, 9);
    assert.equal(result.require_valid_pin, true);
  }
  const unknown = await service.checkDelivery({ ...input, postalCode: "99999", collectionHandles: ["a"], zoneId: 7 });
  assert.equal(unknown.available, false);
  assert.equal(unknown.matched_target, null);
  assert.equal(unknown.require_valid_pin, true);
});

for (const [label, rows, postalCode, expectedZone] of [
  ["exact beats a more urgent pattern zone", [postal(), postal({ id: 2, postalCode: "100*", patternType: "wildcard", zoneId: 8, zoneGroup: { id: 8, enabled: true, priority: 0 } })], "10001", 7],
  ["range", [postal({ postalCode: "10000-10009", patternType: "range", rangeStart: "10000", rangeEnd: "10009" })], "10005", 7],
  ["wildcard", [postal({ postalCode: "100*", patternType: "wildcard" })], "10005", 7],
  ["disabled exact falls back to enabled wildcard", [postal({ zoneGroup: { id: 7, enabled: false, priority: 0 } }), postal({ id: 2, postalCode: "100*", patternType: "wildcard", zoneId: 8, zoneGroup: { id: 8, enabled: true, priority: 1 } })], "10001", 8],
  ["pattern zone priority breaks equal specificity ties", [postal({ postalCode: "10000-10999", patternType: "range", rangeStart: "10000", rangeEnd: "10999", zoneGroup: { id: 7, enabled: true, priority: 10 } }), postal({ id: 2, postalCode: "09900-10899", patternType: "range", rangeStart: "09900", rangeEnd: "10899", zoneId: 8, zoneGroup: { id: 8, enabled: true, priority: 1 } })], "10005", 8],
  ["unassigned exact prevents inferring a zone from wildcard", [postal({ zoneId: null, zoneGroup: null }), postal({ id: 2, postalCode: "100*", patternType: "wildcard" })], "10001", null],
  ["wildcard beats range regardless of zone priority", [postal({ postalCode: "100*", patternType: "wildcard", zoneGroup: { id: 7, enabled: true, priority: 100 } }), postal({ id: 2, postalCode: "10000-10009", patternType: "range", rangeStart: "10000", rangeEnd: "10009", zoneId: 8, zoneGroup: { id: 8, enabled: true, priority: 0 } })], "10005", 7],
]) {
  test(`actual target destination resolution: ${label}`, async () => {
    const { service } = fixture({ rows });
    const context = { ...input, postalCode, collectionHandles: ["a"] };
    const result = await service.checkDelivery(context);
    assert.equal(result.zone_id, expectedZone);
    assert.equal(result.matched_target, expectedZone === 7 ? "Collection A" : null);
    const policy = await service.checkDeliveryPolicy(context);
    assert.equal(policy.matched_target, expectedZone === 7 ? "Collection A" : null);
    assert.equal(policy.require_valid_pin, true);
    const batch = await service.getProductCardDeliveryEstimates(context, [batchItems[0]], { requireMatchedTarget: false });
    assert.equal(batch[0].estimate.matched_target, expectedZone === 7 ? "Collection A" : null);
  });
}

test("disabled exact/range/wildcard zones and feature-disabled patterns never enable restricted targets", async () => {
  for (const row of [
    postal(), postal({ postalCode: "10000-10009", patternType: "range", rangeStart: "10000", rangeEnd: "10009" }),
    postal({ postalCode: "100*", patternType: "wildcard" }),
  ]) {
    const { service } = fixture({ rows: [{ ...row, zoneGroup: { id: 7, enabled: false, priority: 1 } }] });
    const result = await service.checkDelivery({ ...input, collectionHandles: ["a"] });
    assert.equal(result.available, false);
    assert.equal(result.matched_target, null);
    assert.equal((await service.checkDeliveryPolicy({ ...input, collectionHandles: ["a"] })).matched_target, null);
  }
  const { service } = fixture({ rows: [postal({ postalCode: "100*", patternType: "wildcard" })] });
  const result = await service.checkDelivery({ ...input, features: { ...features, patterns: false }, collectionHandles: ["a"] });
  assert.equal(result.available, false);
  assert.equal(result.matched_target, null);
});

test("no destination leaves restricted estimates and initial policy unmatched; base rules still apply", async () => {
  const base = target({ id: 10, name: "Base", zoneIdsCsv: "", priority: 200, processingDays: 4, transitDays: 8 });
  const { service, calls } = fixture({ targets: [target(), base] });
  const context = { ...input, postalCode: undefined, collectionHandles: ["a"], zoneId: 7 };
  const estimate = await service.getGeneralDeliveryEstimate(context);
  assert.equal(estimate.matched_target, "Base");
  assert.equal(estimate.processing_days, 4);
  assert.equal(estimate.transit_days, 8);
  assert.equal((await service.checkDeliveryPolicy(context)).require_valid_pin, false);
  assert.equal(calls.exact, 0);
  const restricted = fixture();
  assert.equal((await restricted.service.getGeneralDeliveryEstimate(context)).matched_target, null);
  assert.equal((await restricted.service.getGeneralDeliveryEstimate({ ...context, requireTarget: true })).enabled, false);
  const policy = await restricted.service.checkDeliveryPolicy(context);
  assert.equal(policy.matched_target, null);
  assert.equal(policy.require_valid_pin, true);
  assert.equal(policy.disable_add_to_cart, true);
  const checked = await restricted.service.checkDelivery({ ...context, postalCode: "invalid" });
  assert.equal(checked.matched_target, null);
  assert.equal(checked.require_valid_pin, true);
});

test("zone-specific PIN exemption is available only after successful delivery, including cached failures", async () => {
  const { service } = fixture({ rows: [postal({ serviceable: false })] });
  const context = { ...input, collectionHandles: ["a"] };
  assert.equal((await service.checkDeliveryPolicy(context)).require_valid_pin, true);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await service.checkDelivery(context);
    assert.equal(result.available, false);
    assert.equal(result.matched_target, "Collection A");
    assert.equal(result.require_valid_pin, true);
  }
  const successful = fixture();
  assert.equal((await successful.service.checkDeliveryPolicy(context)).require_valid_pin, true);
  for (let attempt = 0; attempt < 2; attempt += 1) assert.equal((await successful.service.checkDelivery(context)).require_valid_pin, false);
  const zoneOnly = fixture({ targets: [target({ targetKind: "zone", targetValue: "7", zoneIdsCsv: "" })] });
  assert.equal((await zoneOnly.service.checkDeliveryPolicy(context)).require_valid_pin, true);
  assert.equal((await zoneOnly.service.checkDelivery(context)).require_valid_pin, false);
});

test("zone-specific PIN requirements still apply with a known destination and shop PIN validation disabled", async () => {
  const { service } = fixture({ targets: [target({ requireValidPin: true })], setting: { requireValidPin: false } });
  const context = { ...input, collectionHandles: ["a"] };
  assert.equal((await service.checkDeliveryPolicy(context)).require_valid_pin, true);
  assert.equal((await service.checkDelivery(context)).require_valid_pin, true);
  assert.equal((await service.checkDeliveryPolicy({ ...context, postalCode: undefined })).require_valid_pin, false);
  assert.equal((await service.checkDeliveryPolicy({ ...context, postalCode: "99999" })).require_valid_pin, false);
});

test("zone restrictions do not bypass inventory, exclusion or service availability", async () => {
  const stock = fixture({ targets: [target({ inventoryMode: "in_stock" })], inventoryFailure: true });
  const context = { ...input, collectionHandles: ["a"] };
  for (const call of [stock.service.checkDelivery, stock.service.checkDeliveryPolicy]) {
    assert.equal((await call(context)).reason, "variant_required");
    assert.equal((await call({ ...context, variantId: "1", admin: stock.admin })).reason, "inventory_unavailable");
  }
  assert.equal((await stock.service.checkDelivery({ ...context, postalCode: "99999" })).reason, undefined);
  const excluded = fixture({ targets: [target({ excluded: true })] });
  assert.equal((await excluded.service.checkDelivery(context)).available, false);
  assert.equal((await excluded.service.checkDelivery(context)).require_valid_pin, true);
  assert.equal((await excluded.service.checkDeliveryPolicy(context)).reason, "target_excluded");
  const services = fixture({ serviceRules: [target({ zoneIdsCsv: undefined, shippingAvailable: false })] });
  const denied = await services.service.checkDelivery(context);
  assert.equal(denied.shipping_available, false);
  assert.equal(denied.available, false);
  assert.equal(denied.require_valid_pin, true);
  assert.equal((await services.service.checkDeliveryPolicy({ ...context, postalCode: undefined })).shipping_available, false);
  const verified = fixture({ targets: [target({ inventoryMode: "in_stock", countryCode: "US", stateRegion: "NY" })] });
  const result = await verified.service.checkDelivery({ ...context, variantId: "1", admin: verified.admin });
  assert.equal(result.matched_target, "Collection A");
  assert.equal(result.available, true);
  assert.equal((await verified.service.checkDeliveryPolicy({ ...context, variantId: "1", admin: verified.admin })).matched_target, "Collection A");
});

test("actual general single and batch estimates resolve destination without losing per-product collections", async () => {
  const { service, calls } = fixture();
  const before = calls.targets;
  const batch = await service.getProductCardDeliveryEstimates(input, batchItems);
  assert.equal(calls.targets - before, 1);
  assert.equal(calls.exact, 1);
  for (let index = 0; index < batch.length; index += 1) {
    const rule = threeCollections[index];
    assert.equal(batch[index].key, batchItems[index].key);
    assert.equal(batch[index].estimate.matched_target, rule.name);
    assert.equal(batch[index].estimate.processing_days, rule.processingDays);
    assert.equal(batch[index].estimate.transit_days, rule.transitDays);
    const single = await service.getGeneralDeliveryEstimate({ ...input, ...batchItems[index] });
    assert.equal(single.matched_target, rule.name);
    assert.equal(single.processing_days, batch[index].estimate.processing_days);
    assert.equal(single.transit_days, batch[index].estimate.transit_days);
    assert.equal(single.estimated_date, batch[index].estimate.estimated_date);
  }
  const noDestination = await service.getProductCardDeliveryEstimates({ ...input, postalCode: undefined }, batchItems);
  assert.deepEqual(noDestination.map((row) => row.estimate), [{ enabled: false }, { enabled: false }, { enabled: false }]);
});

test("proxy single and batch use authoritative collections and ignore client zone hints", async () => {
  const { route } = fixture();
  const single = await route.loader({ request: new Request("https://example.com/apps/delivery-checker?estimate=1&country=US&postal_code=10001&productId=1&collections=c&zoneId=8") });
  const estimate = await single.json();
  assert.equal(single.status, 200);
  assert.equal(estimate.matched_target, "Collection A");
  const response = await route.action({ request: new Request("https://example.com/apps/delivery-checker?batch=1", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country: "US", postal_code: "10001", zoneId: 8, items: batchItems.map((item) => ({ ...item, collectionHandles: ["c"] })) }),
  }) });
  assert.equal(response.status, 200);
  const results = (await response.json()).results;
  assert.deepEqual(results.map((row) => row.estimate.matched_target), threeCollections.map((rule) => rule.name));
  const outside = await route.action({ request: new Request("https://example.com/apps/delivery-checker?batch=1", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country: "US", postal_code: "99999", zoneId: 7, items: batchItems }),
  }) });
  assert.deepEqual((await outside.json()).results.map((row) => row.estimate), [{ enabled: false }, { enabled: false }, { enabled: false }]);
  const init = await route.loader({ request: new Request("https://example.com/apps/delivery-checker?init=1&country=US&postal_code=10001&productId=1&zoneId=7") });
  const policy = await init.json();
  assert.equal(policy.matched_target, null);
  assert.equal(policy.require_valid_pin, true);
});

test("headless single accepts resolved postal context; postal-free batch does not infer a zone", async () => {
  const { handler } = fixture();
  const request = async (operation, body) => {
    const response = await handler(new Request(`https://example.com/api/v1/private/delivery/${operation}`, {
      method: "POST", headers: { Authorization: "Bearer hdt_private_zones", "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), "private", operation);
    assert.equal(response.status, 200);
    return (await response.json()).data;
  };
  const single = await request("estimate", { country: "US", postal_code: "10001", product_id: "1" });
  assert.equal(single.matched_target, "Collection A");
  const batch = await request("batch", { country: "US", items: batchItems.map((item) => ({ key: item.key, product_id: item.productId })) });
  assert.deepEqual(batch.map((row) => row.estimate.matched_target), [null, null, null]);
  assert.deepEqual(batch.map((row) => row.estimate.transit_days), [5, 5, 5]);
});
