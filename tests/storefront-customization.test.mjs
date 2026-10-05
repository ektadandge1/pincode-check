import test from "node:test";
import assert from "node:assert/strict";
import { isSafeStorefrontCss } from "../app/utils/custom-css.ts";
import { selectFulfillmentLocation } from "../app/utils/location-selection.ts";

const locations = [
  { shopifyLocationId: "gid://shopify/Location/1", priority: 1 },
  { shopifyLocationId: "gid://shopify/Location/2", priority: 2 },
  { shopifyLocationId: "gid://shopify/Location/3", priority: 3 },
];

test("manual location selection uses the first eligible merchant priority", () => {
  const selected = selectFulfillmentLocation(locations, [
    { locationId: locations[0].shopifyLocationId, available: 0 },
    { locationId: locations[1].shopifyLocationId, available: 4 },
    { locationId: locations[2].shopifyLocationId, available: 20 },
  ], 2, false, "manual");
  assert.equal(selected?.shopifyLocationId, locations[1].shopifyLocationId);
});

test("highest-stock selection uses priority only to break stock ties", () => {
  const selected = selectFulfillmentLocation(locations, [
    { locationId: locations[0].shopifyLocationId, available: 3 },
    { locationId: locations[1].shopifyLocationId, available: 9 },
    { locationId: locations[2].shopifyLocationId, available: 9 },
  ], 2, false, "highest_stock");
  assert.equal(selected?.shopifyLocationId, locations[1].shopifyLocationId);
});

test("safe storefront CSS rejects remote resources and style escapes", () => {
  assert.equal(isSafeStorefrontCss(".pin-checker { border-width: 2px; }"), true);
  assert.equal(isSafeStorefrontCss("@import 'https://example.com/style.css';"), false);
  assert.equal(isSafeStorefrontCss(".x { background: url(https://example.com/x); }"), false);
  assert.equal(isSafeStorefrontCss("</style><script>alert(1)</script>"), false);
  assert.equal(isSafeStorefrontCss("a".repeat(5_001)), false);
});
