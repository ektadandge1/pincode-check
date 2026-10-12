/* eslint-env node */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { injectedServer } from "./helpers/injected-server.mjs";

function loadBilling() {
  return injectedServer({
    "app/shopify.server.ts": {
      authenticate: { admin: async () => {} },
      STARTUP_PLAN: "startup",
      STARTUP_PLAN_NAME: "Startup",
    },
    "app/services/billing-config.server.ts": { isBillingRequired: () => true },
  })("app/services/billing.server.ts");
}

test("active Startup subscription is verified through the Shopify Admin API", async () => {
  const subscription = {
    id: "gid://shopify/AppSubscription/1",
    name: "startup",
    status: "ACTIVE",
    test: true,
    trialDays: 7,
    createdAt: "2026-10-12T00:00:00Z",
    currentPeriodEnd: "2026-11-12T00:00:00Z",
  };
  const queries = [];
  const admin = { graphql: async (query) => {
    queries.push(query);
    return Response.json({ data: { currentAppInstallation: { activeSubscriptions: [subscription] } } });
  } };
  assert.deepEqual(await loadBilling().getActiveAppSubscriptions(admin), [subscription]);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /currentAppInstallation[\s\S]*activeSubscriptions/);
});

test("missing active subscription remains locked", async () => {
  const admin = { graphql: async () => Response.json({ data: { currentAppInstallation: { activeSubscriptions: [] } } }) };
  assert.deepEqual(await loadBilling().getActiveAppSubscriptions(admin), []);
});

test("billing status is cached and concurrent checks share one Admin API request", async () => {
  let checks = 0;
  const load = injectedServer({
    "app/shopify.server.ts": { authenticate: { admin: async () => {} }, STARTUP_PLAN: "startup", STARTUP_PLAN_NAME: "Startup" },
    "app/services/billing-config.server.ts": { isBillingRequired: () => true },
  });
  const billing = load("app/services/billing.server.ts");
  const admin = { graphql: async () => {
    checks += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return Response.json({ data: { currentAppInstallation: { activeSubscriptions: [{ name: "startup", status: "ACTIVE" }] } } });
  } };
  const shop = "billing-cache.myshopify.com";

  assert.deepEqual(await Promise.all([
    billing.getCachedBillingStatus({ shop, admin }),
    billing.getCachedBillingStatus({ shop, admin }),
    billing.getCachedBillingStatus({ shop, admin }),
  ]), [true, true, true]);
  assert.equal(checks, 1);
  assert.equal(await billing.getCachedBillingStatus({ shop, admin }), true);
  assert.equal(checks, 1);

  billing.clearBillingStatusCache(shop);
  assert.equal(await billing.getCachedBillingStatus({ shop, admin }), true);
  assert.equal(checks, 2);
});

test("plans route uses Shopify's authenticated Billing API request flow", async () => {
  const source = await readFile(new URL("../app/routes/app.plans.tsx", import.meta.url), "utf8");
  assert.match(source, /billing\.request\(\{[\s\S]*plan: STARTUP_PLAN[\s\S]*isTest: isBillingTest\(\)/);
  assert.match(source, /<Form method="post">[\s\S]*name="intent" value="subscribe"/);
  assert.doesNotMatch(source, /pricing_plans|shopifyPricingUrl|target="_top"|returnUrl/);
});

test("only the plans route bypasses app-wide billing enforcement", async () => {
  const source = await readFile(new URL("../app/routes/app.tsx", import.meta.url), "utf8");
  const billingSource = await readFile(new URL("../app/services/billing.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /headless-api[\s\S]{0,120}billingExempt|billingExempt[\s\S]{0,120}headless-api/);
  assert.match(source, /isPlansRoute[\s\S]{0,160}requireActiveBilling/);
  assert.match(billingSource, /context\.redirect\("\/app\/plans"\)/);
  assert.doesNotMatch(billingSource, /import \{ redirect \} from "react-router"/);
});
