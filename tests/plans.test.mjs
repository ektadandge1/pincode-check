import assert from "node:assert/strict";
import test from "node:test";

import {
  accessForPlan,
  planFromItemHandles,
  storefrontPlanUrl,
} from "../app/services/plans.server.ts";

test("maps Shopify pricing item handles to plans", () => {
  assert.equal(planFromItemHandles(["basic"]), "basic");
  assert.equal(planFromItemHandles(["advanced"]), "advanced");
  assert.equal(planFromItemHandles(["unknown"]), null);
});

test("Advanced enables premium features while Basic keeps core checks", () => {
  const basic = accessForPlan("basic");
  const advanced = accessForPlan("advanced");
  assert.equal(basic.features.exactRules, true);
  assert.equal(basic.features.patterns, false);
  assert.equal(basic.features.analytics, false);
  assert.equal(advanced.features.patterns, true);
  assert.equal(advanced.features.analytics, true);
  assert.equal(advanced.features.cartProtection, true);
});

test("builds the Shopify-hosted plan selection URL", () => {
  assert.equal(
    storefrontPlanUrl("example-store.myshopify.com"),
    "https://admin.shopify.com/store/example-store/charges/incode-track/pricing_plans",
  );
});
