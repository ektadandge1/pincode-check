/* eslint-env node */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getPartnerSubscription } from "../app/services/partner-billing.server.ts";
import { shopifyPricingUrl } from "../app/utils/shopify-pricing-url.ts";
import { injectedServer } from "./helpers/injected-server.mjs";

async function withPartnerFixture(subscription, callback) {
  const names = ["SHOPIFY_PARTNER_ORG_ID", "SHOPIFY_PARTNER_API_ACCESS_TOKEN", "SHOPIFY_APP_GID"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const calls = [];
  process.env.SHOPIFY_PARTNER_ORG_ID = "98765";
  process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN = "partner-token";
  process.env.SHOPIFY_APP_GID = "gid://shopify/App/123456";
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ data: { activeSubscription: subscription } });
    };
    const admin = { graphql: async () => Response.json({ data: { shop: { id: "gid://shopify/Shop/42" } } }) };
    await callback({ admin, calls });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("Shopify App Pricing subscription is verified through the Partner API", async () => {
  const subscription = {
    billingPeriod: "MONTHLY",
    cancelAtEndOfCycle: false,
    trialEndsAt: "2027-01-01T00:00:00Z",
    currentBillingCycle: null,
  };
  await withPartnerFixture(subscription, async ({ admin, calls }) => {
    assert.deepEqual(await getPartnerSubscription(admin), subscription);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://partners.shopify.com/98765/api/2026-07/graphql.json");
    assert.equal(calls[0].init.headers["X-Shopify-Access-Token"], "partner-token");
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.variables, { appId: "gid://shopify/App/123456", shopId: "gid://shopify/Shop/42" });
  });
});

test("missing active subscription remains locked", async () => {
  await withPartnerFixture(null, async ({ admin }) => {
    assert.equal(await getPartnerSubscription(admin), null);
  });
});

test("billing status is cached and concurrent checks share one Partner API request", async () => {
  let checks = 0;
  const load = injectedServer({
    "app/shopify.server.ts": { authenticate: { admin: async () => {} }, STANDARD_PLAN: "Standard" },
    "app/services/billing-config.server.ts": { isBillingRequired: () => true },
    "app/services/partner-billing.server.ts": {
      getPartnerSubscription: async () => {
        checks += 1;
        await new Promise((resolve) => setImmediate(resolve));
        return { billingPeriod: "MONTHLY" };
      },
    },
  });
  const billing = load("app/services/billing.server.ts");
  const admin = {};
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

test("pricing uses Shopify's supported hosted selection flow", () => {
  assert.equal(
    shopifyPricingUrl({ shop: "demo-store.myshopify.com", appHandle: "eta-deliver-pickup" }),
    "https://admin.shopify.com/store/demo-store/charges/eta-deliver-pickup/pricing_plans",
  );
  assert.throws(() => shopifyPricingUrl({ shop: "not a shop", appHandle: "eta-deliver-pickup" }), /shop domain is invalid/);
  assert.throws(() => shopifyPricingUrl({ shop: "demo.myshopify.com", appHandle: "not/a/handle" }), /SHOPIFY_APP_HANDLE/);
});

test("only the plans route bypasses app-wide billing enforcement", async () => {
  const source = await readFile(new URL("../app/routes/app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /headless-api[\s\S]{0,120}billingExempt|billingExempt[\s\S]{0,120}headless-api/);
  assert.match(source, /isPlansRoute[\s\S]{0,160}requireActiveBilling/);
});
