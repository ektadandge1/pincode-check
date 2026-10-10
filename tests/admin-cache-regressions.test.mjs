import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { injectedServer } from "./helpers/injected-server.mjs";
import { STANDARD_FEATURES } from "../app/services/plans.server.ts";

const shop = "cache-regression.myshopify.com";

function fixture({ delayedShippingMethods = false } = {}) {
  let deliveryDays = 2;
  let shippingMethodCall = 0;
  let releaseShippingMethods;
  const shippingMethodsReady = new Promise((resolve) => { releaseShippingMethods = resolve; });
  const prisma = {
    deliverySetting: { findUnique: async () => null },
    deliveryTarget: { findMany: async () => [] },
    fulfillmentLocationRule: { findMany: async () => [] },
    shippingMethodRule: {
      findMany: async () => {
        shippingMethodCall += 1;
        if (delayedShippingMethods && shippingMethodCall === 1) await shippingMethodsReady;
        return [];
      },
    },
    postalCode: {
      findFirst: async () => ({
        id: 1,
        shop,
        country: "US",
        postalCode: "10001",
        patternType: "exact",
        zoneId: null,
        zone: null,
        serviceable: true,
        deliveryDays,
        codAvailable: false,
        deliveryCharge: null,
        currency: null,
        sameDayAvailable: false,
        nextDayAvailable: false,
        expressAvailable: false,
        state: null,
        zoneGroup: null,
      }),
      findMany: async () => [],
    },
  };
  const load = injectedServer({ "app/db.server.ts": prisma });
  const service = load("app/services/delivery-checker.server.ts");
  const input = { shop, country: "US", postalCode: "10001", features: { ...STANDARD_FEATURES, analytics: false }, trackAnalytics: false };
  return {
    service,
    input,
    setDeliveryDays(value) { deliveryDays = value; },
    clear() { service.clearDeliveryCheckCaches(shop); },
    release() { releaseShippingMethods(); },
  };
}

test("admin cache invalidation removes a previously cached delivery result", async () => {
  const fixtureData = fixture();
  const first = await fixtureData.service.checkDelivery(fixtureData.input);
  fixtureData.setDeliveryDays(7);
  fixtureData.clear();
  const second = await fixtureData.service.checkDelivery(fixtureData.input);

  assert.equal(first.delivery_days, 2);
  assert.equal(second.delivery_days, 7);
});

test("a calculation that finishes after invalidation cannot repopulate the old result", async () => {
  const fixtureData = fixture({ delayedShippingMethods: true });
  const pending = fixtureData.service.checkDelivery(fixtureData.input);
  await new Promise((resolve) => setImmediate(resolve));
  fixtureData.setDeliveryDays(9);
  fixtureData.clear();
  fixtureData.release();
  await pending;

  const current = await fixtureData.service.checkDelivery(fixtureData.input);
  assert.equal(current.delivery_days, 9);
});

test("delivery settings pagination stops querying exhausted catalog connections and deduplicates nodes", async () => {
  const source = await readFile(new URL("../app/routes/app.delivery-settings.tsx", import.meta.url), "utf8");
  assert.match(source, /activeTabId === "products"/);
  assert.match(source, /page < 20 && \(loadCollections \|\| loadProducts\)/);
  assert.doesNotMatch(source, /@include\(if: \$load(?:Collections|Products)\)/);
  assert.match(source, /new Map\(collections\.map\(\(collection\) => \[collection\.id, collection\]\)\)/);
  assert.match(source, /new Map\(products\.map\(\(product\) => \[product\.id, product\]\)\)/);
});
