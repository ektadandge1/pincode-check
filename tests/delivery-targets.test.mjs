import assert from "node:assert/strict";
import test from "node:test";

import {
  deliveryTargetSuccessMessage,
  isDeliveryTargetActive,
  matchDeliveryTarget,
  normalizeTargetValue,
  parseListParam,
  parseProductEstimateBatch,
  productContextCacheKey,
} from "../app/utils/targeting.server.ts";

function conditionalTarget(overrides = {}) {
  return {
    id: 20,
    shop: "s.myshopify.com",
    name: "conditional",
    targetKind: "product",
    targetValue: "123456",
    requireValidPin: true,
    processingDays: null,
    transitDays: null,
    excluded: false,
    enabled: true,
    priority: 1,
    inventoryMode: "any",
    activationMode: "always",
    weekdaysCsv: "",
    ...overrides,
  };
}

const targets = [
  {
    id: 3,
    shop: "s.myshopify.com",
    name: "tag clearance",
    targetKind: "tag",
    targetValue: "clearance",
    requireValidPin: true,
    enabled: true,
    priority: 10,
  },
  {
    id: 2,
    shop: "s.myshopify.com",
    name: "collection sale",
    targetKind: "collection",
    targetValue: "sale-items",
    requireValidPin: false,
    enabled: true,
    priority: 10,
  },
  {
    id: 1,
    shop: "s.myshopify.com",
    name: "product exact",
    targetKind: "product",
    targetValue: "123456",
    requireValidPin: true,
    enabled: true,
    priority: 50,
  },
  {
    id: 4,
    shop: "s.myshopify.com",
    name: "disabled product",
    targetKind: "product",
    targetValue: "123456",
    requireValidPin: false,
    enabled: false,
    priority: 1,
  },
];

const vendorTarget = {
  id: 5,
  shop: "s.myshopify.com",
  name: "Acme custom ETA",
  targetKind: "vendor",
  targetValue: "acme",
  requireValidPin: false,
  processingDays: 2,
  transitDays: 3,
  excluded: false,
  enabled: true,
  priority: 1,
};

test("normalizes product, collection, vendor, and tag values", () => {
  assert.equal(normalizeTargetValue("product", "gid://shopify/Product/998877"), "998877");
  assert.equal(normalizeTargetValue("collection", "/Sale-Items"), "sale-items");
  assert.equal(normalizeTargetValue("tag", " Clearance "), "clearance");
  assert.equal(normalizeTargetValue("vendor", " Acme "), "acme");
  assert.equal(normalizeTargetValue("product", "abc"), null);
});

test("matches vendor ETA overrides case-insensitively", () => {
  const matched = matchDeliveryTarget([...targets, vendorTarget], {
    productId: "555",
    vendor: "ACME",
    tags: [],
    collectionHandles: [],
  });
  assert.equal(matched?.name, "Acme custom ETA");
  assert.equal(matched?.processingDays, 2);
  assert.equal(matched?.transitDays, 3);
});

test("product target wins over collection and tag", () => {
  const matched = matchDeliveryTarget(targets, {
    productId: "123456",
    tags: ["clearance"],
    collectionHandles: ["sale-items"],
  });
  assert.equal(matched?.name, "product exact");
  assert.equal(matched?.requireValidPin, true);
});

test("falls back to collection then tag", () => {
  const byCollection = matchDeliveryTarget(targets, {
    productId: "555",
    collectionHandles: ["Sale-Items"],
    tags: ["clearance"],
  });
  assert.equal(byCollection?.name, "collection sale");

  const byTag = matchDeliveryTarget(targets, {
    productId: "555",
    tags: ["CLEARANCE"],
    collectionHandles: ["other"],
  });
  assert.equal(byTag?.name, "tag clearance");

  assert.equal(
    matchDeliveryTarget(targets, { productId: "555", tags: [], collectionHandles: [] }),
    null,
  );
});

test("parses list params from pipe, comma, or JSON", () => {
  assert.deepEqual(parseListParam("a|b|c"), ["a", "b", "c"]);
  assert.deepEqual(parseListParam("a,b"), ["a", "b"]);
  assert.deepEqual(parseListParam('["x","y"]'), ["x", "y"]);
  assert.deepEqual(parseListParam(""), []);
});

test("parses and bounds product estimate batches", () => {
  const parsed = parseProductEstimateBatch({
    items: [{
      key: "Blue-Shirt",
      productId: "gid://shopify/Product/123",
      productVendor: " Acme ",
      productTags: ["summer", "summer", 42],
      collectionHandles: ["Featured", "bad handle", "sale-items"],
    }],
  });

  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.items, [{
    key: "blue-shirt",
    productId: "123",
    productVendor: "Acme",
    productTags: ["summer", "42"],
    collectionHandles: ["featured", "sale-items"],
  }]);
  assert.equal(parseProductEstimateBatch({ items: Array.from({ length: 25 }, (_, index) => ({
    key: `product-${index}`,
    productId: String(index + 1),
  })) }).error, "too_many_items");
});

test("rejects malformed product estimate batches and deduplicates keys", () => {
  assert.equal(parseProductEstimateBatch(null).error, "invalid_batch");
  assert.equal(parseProductEstimateBatch({ items: [{ key: "bad key", productId: "1" }] }).error, "invalid_batch");
  assert.equal(parseProductEstimateBatch({ items: [{ key: "valid", productId: "none" }] }).error, "invalid_batch");

  const parsed = parseProductEstimateBatch({ items: [
    { key: "same", productId: "1" },
    { key: "same", productId: "2" },
  ] });
  assert.equal(parsed.error, null);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].productId, "1");
});

test("builds stable product context cache keys", () => {
  const a = productContextCacheKey({
    productId: "1",
    tags: ["b", "a"],
    collectionHandles: ["z", "y"],
    vendor: "Acme",
  });
  const b = productContextCacheKey({
    productId: "1",
    tags: ["a", "b"],
    collectionHandles: ["y", "z"],
    vendor: "acme",
  });
  assert.equal(a, b);
});

test("preserves backward compatibility for rules without new targeting fields", () => {
  assert.equal(matchDeliveryTarget(targets, {
    productId: "123456",
    country: "CA",
    inventoryStatus: "out_of_stock",
    timeZone: "America/Toronto",
  })?.name, "product exact");
});

test("evaluates date ranges using the merchant local date", () => {
  const target = conditionalTarget({
    activationMode: "date_range",
    activeFromLocal: "2026-10-01",
    activeUntilLocal: "2026-10-01",
  });

  assert.equal(isDeliveryTargetActive(target, "Asia/Kolkata", new Date("2026-09-30T20:00:00Z")), true);
  assert.equal(isDeliveryTargetActive(target, "America/Los_Angeles", new Date("2026-10-02T03:00:00Z")), true);
  assert.equal(isDeliveryTargetActive(target, "Asia/Kolkata", new Date("2026-10-01T19:00:00Z")), false);
});

test("evaluates weekly windows in the merchant timezone with an exclusive end", () => {
  const target = conditionalTarget({
    activationMode: "weekly",
    weekdaysCsv: "4",
    startTimeLocal: "09:00",
    endTimeLocal: "17:00",
  });

  assert.equal(isDeliveryTargetActive(target, "Asia/Kolkata", new Date("2026-10-01T04:00:00Z")), true);
  assert.equal(isDeliveryTargetActive(target, "America/New_York", new Date("2026-10-01T04:00:00Z")), false);
  assert.equal(isDeliveryTargetActive(target, "Asia/Kolkata", new Date("2026-10-01T11:30:00Z")), false);
});

test("requires matching geography and a known state for state-specific rules", () => {
  const target = conditionalTarget({ countryCode: "US", stateRegion: "New York" });
  const context = { productId: "123456", country: "US", timeZone: "UTC" };

  assert.equal(matchDeliveryTarget([target], { ...context, state: null }), null);
  assert.equal(matchDeliveryTarget([target], { ...context, state: "New York" })?.name, "conditional");
  assert.equal(matchDeliveryTarget([target], { ...context, country: "CA", state: "New York" }), null);
});

test("matches every authoritative inventory mode and ignores an unknown status", () => {
  for (const status of ["in_stock", "backorder", "out_of_stock"]) {
    const target = conditionalTarget({ inventoryMode: status });
    assert.equal(matchDeliveryTarget([target], { productId: "123456", inventoryStatus: status })?.name, "conditional");
    assert.equal(matchDeliveryTarget([target], { productId: "123456", inventoryStatus: null }), null);
  }
});

test("returns the matched rule custom success message without affecting fallback rules", () => {
  const custom = conditionalTarget({ customSuccessMessage: "Arrives {max_delivery_date}." });
  const matched = matchDeliveryTarget([custom], { productId: "123456" });
  assert.equal(deliveryTargetSuccessMessage(matched, "Global {date}"), "Arrives {max_delivery_date}.");
  assert.equal(
    deliveryTargetSuccessMessage(matchDeliveryTarget(targets, { productId: "123456" }), "Global {date}"),
    "Global {date}",
  );
});
