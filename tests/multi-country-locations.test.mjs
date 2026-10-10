import assert from "node:assert/strict";
import test from "node:test";
import { injectedServer } from "./helpers/injected-server.mjs";
import { STANDARD_FEATURES } from "../app/services/plans.server.ts";

function fixture(rules, records = [], inventoryAwareEnabled = true, serviceRules = []) {
  const prisma = {
    deliverySetting: { findUnique: async () => ({ inventoryAwareEnabled, cutoffHour24: 14, processingDays: 0, deliveryWindowDays: 2, dateFormat: "weekday_day_month", timeZone: "UTC", locale: "en", fallbackDays: 5, courierTimeoutMs: 2000, retryCount: 1, courierEnabled: false, dbFallbackEnabled: true, holidaysCsv: "", weekendDaysCsv: "0", disableAddToCart: false, requireValidPin: false, successMessage: "Available", unavailableMessage: "Unavailable", codAvailableMessage: "COD", codUnavailableMessage: "Prepaid", deliveryChargeMessage: "" }) },
    deliveryTarget: { findMany: async () => [] },
    fulfillmentLocationRule: { findMany: async () => rules },
    serviceAvailabilityRule: { findMany: async () => serviceRules },
    shippingMethodRule: { findMany: async () => [] },
    postalCode: {
      findFirst: async ({ where }) => records.find((row) => row.country === where.country && (typeof where.postalCode === "string" ? row.postalCode === where.postalCode : where.postalCode.in.includes(row.postalCode))) ?? null,
      findMany: async () => [],
    },
  };
  const admin = { graphql: async () => Response.json({ data: { productVariant: {
    inventoryPolicy: "DENY", sellableOnlineQuantity: 20,
    inventoryItem: { inventoryLevels: { pageInfo: { hasNextPage: false }, nodes: rules.map((rule) => ({
      location: { id: rule.shopifyLocationId, isActive: true, fulfillsOnlineOrders: true },
      quantities: [{ name: "available", quantity: 10 }],
    })) } },
  } } }) };
  const { checkDelivery } = injectedServer({ "app/db.server.ts": prisma })("app/services/delivery-checker.server.ts");
  return (country, postalCode) => checkDelivery({ shop: "countries.myshopify.com", country, postalCode, variantId: "1", productId: "1", quantity: 1, admin, features: { ...STANDARD_FEATURES, analytics: false } });
}

const rule = (id, country, patterns) => ({ shopifyLocationId: `gid://shopify/Location/${id}`, name: `Location ${id}`, priority: id, enabled: true, localDeliveryEnabled: true, localDeliveryCountry: country, localDeliveryPostalCodesCsv: patterns, pickupEnabled: true, pickupInstructions: "Bring ID", serviceTargetMode: "all", serviceTargetValuesCsv: "", processingDays: null, transitDays: null });

test("local delivery cannot leak across countries sharing a postal pattern", async () => {
  const check = fixture([rule(1, "US", "100*")]);
  assert.equal((await check("US", "10001")).local_delivery_available, true);
  assert.equal((await check("DE", "10001")).local_delivery_available, false);
});

test("a stocked destination-matching location is preferred over an unrelated priority location", async () => {
  const check = fixture([rule(1, "US", "100*"), rule(2, "DE", "100*")]);
  const result = await check("DE", "10001");
  assert.equal(result.local_delivery_available, true);
  assert.equal(result.fulfillment_location_id, "gid://shopify/Location/2");
});

test("unconfirmed legacy location countries fail closed for local delivery", async () => {
  const result = await fixture([rule(1, "", "100*")])("US", "10001");
  assert.equal(result.local_delivery_available, false);
  assert.equal(result.pickup_available, true);
});

test("legacy compact exact coverage works with canonical international input", async () => {
  const check = fixture([], [{ country: "CA", postalCode: "K1A0B1", zoneId: null, serviceable: true, deliveryDays: 2 }]);
  assert.equal((await check("CA", "K1A 0B1")).available, true);
  assert.equal((await check("US", "10001")).available, false);
});

test("local delivery can reuse an existing enabled delivery zone", async () => {
  const zoneRule = { ...rule(1, "", ""), localDeliveryCoverageMode: "zone", localDeliveryZoneIdsCsv: "27,28" };
  const check = fixture([zoneRule], [
    { country: "IN", postalCode: "400001", zoneId: 27, zoneGroup: { enabled: true }, serviceable: true, deliveryDays: 2 },
    { country: "IN", postalCode: "500001", zoneId: 29, zoneGroup: { enabled: true }, serviceable: true, deliveryDays: 2 },
  ]);
  assert.equal((await check("IN", "400001")).local_delivery_available, true);
  assert.equal((await check("IN", "500001")).local_delivery_available, false);
});

test("local delivery works when general inventory-aware estimates are disabled", async () => {
  const zoneRule = { ...rule(1, "", ""), localDeliveryCoverageMode: "zone", localDeliveryZoneIdsCsv: "27" };
  const check = fixture([zoneRule], [
    { country: "IN", postalCode: "400001", zoneId: 27, zoneGroup: { enabled: true }, serviceable: true, deliveryDays: 2 },
  ], false);
  assert.equal((await check("IN", "400001")).local_delivery_available, true);
});

test("pickup-only locations are selected without enabling inventory-aware shipping", async () => {
  const pickupRule = { ...rule(1, "", ""), localDeliveryEnabled: false };
  const result = await fixture([pickupRule], [{ country: "IN", postalCode: "400001", zoneId: null, serviceable: true, deliveryDays: 2 }], false)("IN", "400001");
  assert.equal(result.pickup_available, true);
  assert.equal(result.local_delivery_available, false);
  assert.equal(result.fulfillment_location_id, "gid://shopify/Location/1");
});

test("local delivery returns dates even without separate shipping coverage", async () => {
  const result = await fixture([rule(1, "IN", "400*")], [], false)("IN", "400001");
  assert.equal(result.available, false);
  assert.equal(result.local_delivery_available, true);
  assert.ok(result.estimated_date);
  assert.ok(result.estimated_date_max);
  assert.ok(result.delivery_date_range);
});

test("local delivery and pickup use independent location audiences", async () => {
  const check = fixture([{
    ...rule(1, "US", "100*"),
    localDeliveryTargetMode: "product",
    localDeliveryTargetValuesCsv: "2",
    pickupTargetMode: "product",
    pickupTargetValuesCsv: "1",
  }]);
  const result = await check("US", "10001");
  assert.equal(result.local_delivery_available, false);
  assert.equal(result.pickup_available, true);
});

test("local delivery and pickup enforce independent assigned service rules", async () => {
  const serviceRule = (id, productId) => ({
    id,
    shop: "countries.myshopify.com",
    name: `Rule ${id}`,
    targetKind: "product",
    targetValue: productId,
    shippingAvailable: true,
    localDeliveryAvailable: true,
    pickupAvailable: true,
    enabled: true,
    priority: id,
  });
  const result = await fixture([{
    ...rule(1, "US", "100*"),
    localDeliveryServiceRuleId: 2,
    pickupServiceRuleId: 1,
  }], [], false, [serviceRule(1, "1"), serviceRule(2, "2")])("US", "10001");
  assert.equal(result.local_delivery_available, false);
  assert.equal(result.pickup_available, true);
});
