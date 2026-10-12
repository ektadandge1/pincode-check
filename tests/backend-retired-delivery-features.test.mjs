import assert from "node:assert/strict";
import test from "node:test";
import { injectedServer } from "./helpers/injected-server.mjs";
import { STANDARD_FEATURES } from "../app/services/plans.server.ts";

const retired = ["cod_available", "delivery_charge", "currency", "same_day_available", "next_day_available", "express_available"];
const postalLegacy = { codAvailable: true, deliveryCharge: 12, currency: "USD", sameDayAvailable: true, nextDayAvailable: true, expressAvailable: true };

function fixture() {
  const analytics = [];
  const methodQueries = [];
  const shop = "retired-test.myshopify.com";
  const admin = { graphql: async (_query, { variables }) => Response.json({ data: {
    nodes: variables.ids.map((id) => ({ id, vendor: "Canonical", tags: [], collections: { nodes: [], pageInfo: { hasNextPage: false } } })),
  } }) };
  const methods = ["express", "same_day", "next_day", "standard", "local", "pickup"].map((kind) => ({
    handle: kind, name: kind, kind, processingDays: null, transitDays: 2, description: null, customMessage: null,
  }));
  const prisma = {
    deliverySetting: { findUnique: async ({ omit }) => {
      assert.deepEqual(Object.keys(omit).sort(), ["codAvailableMessage", "codUnavailableMessage", "deliveryChargeMessage"].sort());
      return null;
    } },
    postalCode: { findFirst: async ({ omit }) => {
      assert.deepEqual(omit, Object.fromEntries(Object.keys(postalLegacy).map((key) => [key, true])));
      return { id: 1, zoneId: null, serviceable: true, deliveryDays: 3, city: "New York", state: "NY", ...postalLegacy };
    } },
    deliveryTarget: { findMany: async () => [] },
    serviceAvailabilityRule: { findMany: async () => [] },
    fulfillmentLocationRule: { findMany: async () => [] },
    shippingMethodRule: { findMany: async (query) => { methodQueries.push(query); return methods; } },
    postalCodeSearchEvent: { create: async ({ data }) => { analytics.push(data); } },
    headlessApiToken: {
      findUnique: async () => ({ id: "token", shop, tokenType: "private", enabled: true, scopesCsv: "delivery:check,delivery:estimate,delivery:methods" }),
      update: async () => ({}),
    },
    session: { findFirst: async () => ({}) },
    $transaction: async (callback) => callback({ headlessRateLimit: { upsert: async () => ({ count: 1 }), deleteMany: async () => ({}) } }),
  };
  const load = injectedServer({
    "app/db.server.ts": prisma,
    "app/shopify.server.ts": { unauthenticated: { admin: async () => ({ admin }) } },
    "app/services/plan-access.server.ts": { resolvePlanAccess: async () => ({ active: true, features: STANDARD_FEATURES }) },
  });
  return { service: load("app/services/delivery-checker.server.ts"), headless: load("app/services/headless-api.server.ts").handleHeadlessRequest,
    input: { shop, country: "US", postalCode: "10001", features: STANDARD_FEATURES }, analytics, methodQueries };
}

function assertCore(result) {
  for (const key of retired) assert.equal(key in result, false, key);
  assert.equal(result.available, true);
  assert.ok(result.estimated_date);
  assert.ok(result.estimated_date_max);
  assert.ok(result.dispatch_date);
  assert.deepEqual(result.shipping_methods.map((method) => method.kind), ["standard"]);
}

test("single, cached, general and cart estimates ignore legacy flags and never write legacy analytics", async () => {
  const { service, input, analytics, methodQueries } = fixture();
  assert.equal("cod" in STANDARD_FEATURES, false);
  assertCore(await service.checkDelivery({ ...input, codRequested: true }));
  assertCore(await service.checkDelivery({ ...input, codRequested: false }));
  assert.equal(methodQueries.length, 1, "legacy COD inputs must not split the cache");
  assert.deepEqual(methodQueries[0].where.kind.in, ["standard", "local", "pickup"]);
  assertCore(await service.getGeneralDeliveryEstimate(input));
  assertCore(await service.checkCartDelivery(input, [{ productId: "1", variantId: "2", quantity: 1 }]));
  assert.ok(analytics.length > 0);
  for (const data of analytics) assert.equal("codAvailable" in data, false);
});

test("headless check, personalized estimate and methods do not expose retired fields or kinds", async () => {
  const { headless } = fixture();
  for (const operation of ["check", "estimate", "methods"]) {
    const response = await headless(new Request(`https://example.com/api/v1/private/delivery/${operation}`, {
      method: "POST", headers: { Authorization: "Bearer hdt_private_retired", "Content-Type": "application/json" },
      body: JSON.stringify({ country: "US", postal_code: "10001", product_id: "1", cod_requested: "ignored" }),
    }), "private", operation);
    assert.equal(response.status, 200);
    const { success, data } = await response.json();
    assert.equal(success, true);
    if (operation !== "methods") assertCore(data);
    else {
      for (const key of retired) assert.equal(key in data, false);
      assert.deepEqual(data.shipping_methods.map((method) => method.kind), ["standard"]);
    }
  }
});
