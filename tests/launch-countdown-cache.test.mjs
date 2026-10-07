import assert from "node:assert/strict";
import test from "node:test";
import { countdownVisible } from "../app/utils/countdown-visibility.ts";
import { deliveryCacheEntry, readDeliveryCache } from "../app/utils/delivery-check-cache.ts";

const setting = {
  countdownEnabled: true,
  countdownDisplaySurfacesCsv: " product, cart ",
  countdownTargetMode: "products",
  countdownProductIdsCsv: " 123, gid://shopify/Product/456 ",
  countdownCollectionHandlesCsv: " summer, winter ",
  countdownZoneIdsCsv: " 2, 3 ",
};

test("countdown product targeting matches numeric and canonical Product IDs only", () => {
  for (const productId of ["123", "gid://shopify/Product/123", "456", "gid://shopify/Product/456"]) {
    assert.equal(countdownVisible(setting, { productId }, "product"), true);
  }
  for (const productId of [undefined, "789", "gid://shopify/ProductVariant/123", "junk123"]) {
    assert.equal(countdownVisible(setting, { productId }, "product"), false);
  }
  assert.equal(countdownVisible(setting, { productId: "123" }, "collection"), false);
  assert.equal(countdownVisible({ ...setting, countdownEnabled: false }, { productId: "123" }, "product"), false);
  assert.equal(countdownVisible(null, {}, "product"), false);
});

test("countdown collection and zone lists trim configured values", () => {
  assert.equal(countdownVisible({ ...setting, countdownTargetMode: "collections" }, { collectionHandles: ["summer"] }, "product"), true);
  assert.equal(countdownVisible({ ...setting, countdownTargetMode: "zones" }, { zoneId: 2 }, "product"), true);
  assert.equal(countdownVisible({ ...setting, countdownTargetMode: "zones" }, {}, "product"), false);
});

test("cache countdown ages without mutating the stored result and expires before cutoff", () => {
  const result = { seconds_until_cutoff: 30, estimated_date: "2026-10-06" };
  const entry = deliveryCacheEntry(result, 1000, 60_000);
  assert.equal(entry.expiresAt, 30_000);
  assert.equal(readDeliveryCache(entry, 10_100).seconds_until_cutoff, 20);
  assert.equal(result.seconds_until_cutoff, 30);
  assert.equal(readDeliveryCache(entry, 30_000), null);
  assert.equal(readDeliveryCache(entry, 31_000), null);
});

test("post-cutoff dates are not cached across midnight; non-date negatives retain normal TTL", () => {
  for (const seconds_until_cutoff of [0, 1, -1, NaN, Infinity]) {
    assert.equal(deliveryCacheEntry({ seconds_until_cutoff }, 0, 60_000), null);
  }
  assert.equal(deliveryCacheEntry({ available: false }, 0, 60_000).expiresAt, 60_000);
  assert.equal(deliveryCacheEntry({ seconds_until_cutoff: 3600 }, 0, 60_000).expiresAt, 60_000);
});
