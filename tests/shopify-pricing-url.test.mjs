import assert from "node:assert/strict";
import test from "node:test";
import { shopifyPricingUrl } from "../app/utils/shopify-pricing-url.ts";

test("pricing uses Shopify's hosted plan selection page", () => {
  assert.equal(
    shopifyPricingUrl({ shop: "demo-store.myshopify.com", appHandle: "eta-deliver-pickup" }),
    "https://admin.shopify.com/store/demo-store/charges/eta-deliver-pickup/pricing_plans",
  );
});

test("pricing URL rejects invalid shops and app handles", () => {
  assert.throws(
    () => shopifyPricingUrl({ shop: "not a shop", appHandle: "eta-deliver-pickup" }),
    /shop domain is invalid/,
  );
  assert.throws(
    () => shopifyPricingUrl({ shop: "demo.myshopify.com", appHandle: "not/a/handle" }),
    /SHOPIFY_APP_HANDLE/,
  );
});
