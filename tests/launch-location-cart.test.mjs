import assert from "node:assert/strict";
import test from "node:test";
import { selectFulfillmentLocation, selectedLocationOptions } from "../app/utils/location-selection.ts";
import { matchesPostalPatternsCsv, validatePostalCode } from "../app/utils/delivery.server.ts";
import { cartLocationOptions, commonCartShippingMethods } from "../app/utils/cart-location-options.ts";

const rules = [
  { shopifyLocationId: "missing", priority: 0 },
  { shopifyLocationId: "inactive", priority: 1 },
  { shopifyLocationId: "offline", priority: 2 },
  { shopifyLocationId: "a", priority: 3 },
  { shopifyLocationId: "b", priority: 4 },
];
const levels = [
  { locationId: "inactive", available: 100, active: false, fulfillsOnlineOrders: true },
  { locationId: "offline", available: 100, active: true, fulfillsOnlineOrders: false },
  { locationId: "a", available: 0, active: true, fulfillsOnlineOrders: true },
  { locationId: "b", available: 5, active: true, fulfillsOnlineOrders: true },
];

test("continueSelling only chooses existing active online inventory locations", () => {
  assert.equal(selectFulfillmentLocation(rules, levels, 1, true, "manual"), rules[3]);
  assert.equal(selectFulfillmentLocation(rules, levels, 1, false, "manual"), rules[4]);
  assert.equal(selectFulfillmentLocation(rules, levels, 1, true, "highest_stock"), rules[4]);
  assert.equal(selectFulfillmentLocation(rules, [], 1, true, "manual"), null);
  assert.equal(selectFulfillmentLocation(rules, levels, 6, false, "manual"), null);
});

test("eligible location options are independent of shipping coverage and cannot claim shipping", () => {
  const rule = { shopifyLocationId: "a", priority: 1, name: "Store A", pickupEnabled: true, pickupInstructions: "Bring ID" };
  const country = "US";
  const postalCode = "10001";
  assert.equal(validatePostalCode(country, postalCode), true);
  const selected = selectFulfillmentLocation([rule], [{ locationId: "a", available: 2, active: true, fulfillsOnlineOrders: true }], 1, false, "manual");
  const result = { available: false, source: "none", ...selectedLocationOptions(selected, matchesPostalPatternsCsv(country, postalCode, "100*")) };
  assert.equal(result.available, false);
  assert.equal(result.source, "none");
  assert.equal(result.pickup_available, true);
  assert.equal(result.local_delivery_available, true);
  assert.equal(result.fulfillment_location_id, "a");
  assert.equal(result.fulfillment_location_name, "Store A");
  assert.equal(result.estimated_date, undefined);
  assert.equal(selectedLocationOptions(selected, false).local_delivery_available, false);
  const ineligible = selectFulfillmentLocation([rule], [], 1, true, "manual");
  const options = selectedLocationOptions(ineligible, true);
  assert.equal(options.pickup_available, false);
  assert.equal(options.local_delivery_available, false);
  assert.equal(options.fulfillment_location_id, undefined);
});

const methods = [
  { handle: "pickup", kind: "pickup", estimated_date: "2026-10-06" },
  { handle: "standard", kind: "standard", estimated_date: "2026-10-09" },
];
const item = { fulfillment_location_id: "a", fulfillment_location_name: "Store A", pickup_available: true, pickup_instructions: "Bring ID", local_delivery_available: true, shipping_methods: methods };

test("same-location cart returns ID/name and retains pickup method", () => {
  const results = [item, { ...item }];
  const options = cartLocationOptions(results, true);
  assert.equal(options.fulfillment_location_id, "a");
  assert.equal(options.fulfillment_location_name, "Store A");
  assert.equal(options.pickup_instructions, "Bring ID");
  assert.equal(options.pickup_available, true);
  assert.deepEqual(commonCartShippingMethods(results, options.pickup_available), methods);
});

test("multi-location, unknown-location and incomplete carts cannot advertise pickup", () => {
  for (const [results, complete] of [
    [[item, { ...item, fulfillment_location_id: "b" }], true],
    [[item, { ...item, fulfillment_location_id: undefined }], true],
    [[item], false],
  ]) {
    const options = cartLocationOptions(results, complete);
    assert.equal(options.pickup_available, false);
    assert.equal(options.fulfillment_location_id, undefined);
    assert.equal(options.fulfillment_location_name, undefined);
    assert.equal(options.pickup_instructions, undefined);
    assert.deepEqual(commonCartShippingMethods(results, options.pickup_available), [methods[1]]);
  }
});

test("cart local availability requires every item and methods require intersection", () => {
  const results = [item, { ...item, local_delivery_available: false, shipping_methods: [] }];
  assert.equal(cartLocationOptions(results, true).local_delivery_available, false);
  assert.deepEqual(commonCartShippingMethods(results, true), []);
  assert.equal(cartLocationOptions([], true).pickup_available, false);
});
