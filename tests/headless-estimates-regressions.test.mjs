import assert from "node:assert/strict";
import test from "node:test";
import { injectedServer } from "./helpers/injected-server.mjs";
import { STANDARD_FEATURES } from "../app/services/plans.server.ts";

function fixture(targets = [], targeting = true) {
  const features = { ...STANDARD_FEATURES, targeting, analytics: false };
  const calls = { settings: 0, targets: 0, lastUsed: 0 };
  const admin = { graphql: async (_query, { variables }) => Response.json({ data: {
    nodes: variables.ids.map((id) => ({ id, vendor: "Canonical", tags: [],
      collections: { nodes: [], pageInfo: { hasNextPage: false } } })),
  } }) };
  const tx = { headlessRateLimit: {
    upsert: async () => ({ count: 1 }), deleteMany: async () => ({}),
  } };
  const load = injectedServer({
    "app/db.server.ts": {
      headlessApiToken: {
        findUnique: async () => ({ id: "test-token", shop: "test.myshopify.com", tokenType: "private", enabled: true,
          scopesCsv: "delivery:estimate,delivery:batch" }),
        update: async () => { calls.lastUsed += 1; },
      },
      session: { findFirst: async () => ({}) },
      $transaction: async (callback) => callback(tx),
      deliverySetting: { findUnique: async () => { calls.settings += 1; return null; } },
      deliveryTarget: { findMany: async () => { calls.targets += 1; return targets; } },
    },
    "app/shopify.server.ts": {
      unauthenticated: { admin: async () => ({ admin }) },
      authenticate: { public: { appProxy: async () => ({ session: { shop: "test.myshopify.com" }, admin }) } },
    },
    "app/services/plan-access.server.ts": { resolvePlanAccess: async () => ({ active: true, features }) },
    "app/services/billing.server.ts": { billingRequiredResponse: () => { throw new Error("Unexpected billing response"); } },
  });
  const handler = load("app/services/headless-api.server.ts").handleHeadlessRequest;
  const route = load("app/routes/apps.delivery-checker.ts");
  const request = async (operation, body) => {
    const response = await handler(new Request(`https://example.com/api/v1/private/delivery/${operation}`, {
      method: "POST", headers: { Authorization: "Bearer hdt_private_regression", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), "private", operation);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.success, true);
    return payload.data;
  };
  const themeBatch = async () => {
    const response = await route.action({ request: new Request("https://example.com/apps/delivery-checker?batch=1", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: "US", items: [{ key: "first", productId: "1" }, { key: "second", productId: "2" }] }),
    }) });
    assert.equal(response.status, 200);
    return (await response.json()).results;
  };
  return { request, themeBatch, calls };
}

const target = { id: 1, name: "Specific", targetKind: "product", targetValue: "1", enabled: true,
  inventoryMode: "any", processingDays: 2, transitDays: 8, priority: 1 };

for (const [label, targets, targeting] of [
  ["no targets", [], true],
  ["unmatched product", [target], true],
  ["targeting feature disabled", [target], false],
  ["excluded product", [{ ...target, excluded: true }], true],
]) {
  test(`actual headless batch agrees with single estimates: ${label}; theme cards retain suppression`, async () => {
    const { request, themeBatch, calls } = fixture(targets, targeting);
    const singles = await Promise.all(["1", "2"].map((product_id) => request("estimate", { country: "US", product_id })));
    const settingsBefore = calls.settings;
    const targetsBefore = calls.targets;
    const batch = await request("batch", { country: "US", items: [
      { key: "first", product_id: "1" }, { key: "second", product_id: "2" },
    ] });
    assert.deepEqual(batch.map((row) => row.key), ["first", "second"]);
    assert.deepEqual(batch.map((row) => row.estimate), singles);
    assert.equal(singles[1].enabled, true);
    // One shared shop/default lookup pair, not one pair per batch item.
    assert.equal(calls.settings - settingsBefore, 2);
    assert.equal(calls.targets - targetsBefore, targeting ? 1 : 0);
    assert.equal(calls.lastUsed, 3);
    if (targeting && targets.length) {
      assert.equal(singles[0].matched_target, "Specific");
      assert.equal(singles[0].enabled, !targets[0].excluded);
      if (targets[0].excluded) assert.equal(singles[0].reason, "target_excluded");
      else assert.equal(singles[0].transit_days, 8);
    }
    const cards = await themeBatch();
    assert.deepEqual(cards[1].estimate, { enabled: false });
    assert.deepEqual(cards[0].estimate, targeting && targets.length ? singles[0] : { enabled: false });
  });
}
