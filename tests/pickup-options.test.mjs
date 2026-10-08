import assert from "node:assert/strict";
import test from "node:test";
import { injectedServer } from "./helpers/injected-server.mjs";

const shop = "pickup-tests.myshopify.com";
const id = (number) => `gid://shopify/Location/${number}`;
const rule = (number, extra = {}) => ({ shopifyLocationId: id(number), serviceTargetMode: "all", serviceTargetValuesCsv: "",
  pickupPhone: "", pickupInstructions: "Bring your order confirmation", pickupPreparationDays: 0,
  pickupAdvanceDays: 30, pickupWeekdaysCsv: "0,1,2,3,4,5,6", pickupBlockedDatesCsv: "", ...extra });
const item = (number, quantity = 1, extra = {}) => ({ variantId: String(number), productId: `gid://shopify/Product/${number}`, quantity, ...extra });

function fixture({ rules = [rule(1), rule(2)], levels, truncated = false, locationErrors = false, exact = null, patterns = [], active = true,
  online = true, nodeActive = active, nodeOnline = online, access = true, noAdmin = false } = {}) {
  const calls = [];
  const admin = { graphql: async (query, options) => {
    calls.push({ query, variables: options.variables });
    if (query.includes("DeliveryCheckerProductContexts")) return Response.json({ data: { nodes: options.variables.ids.map((gid) => {
      const number = gid.split("/").at(-1);
      const product = { id: `gid://shopify/Product/${number}`, tags: ["verified"], collections: { nodes: [{ handle: "canonical" }], pageInfo: { hasNextPage: false } } };
      return gid.includes("ProductVariant") ? { id: gid, product } : product;
    }) } });
    if (query.includes("VariantInventoryForEdd")) return Response.json({ data: { productVariant: {
      sellableOnlineQuantity: 999, inventoryPolicy: "CONTINUE", inventoryItem: { inventoryLevels: {
        pageInfo: { hasNextPage: truncated }, nodes: (levels?.[options.variables.id.split("/").at(-1)] ?? [[1, 5], [2, 5]]).map(([number, stock]) => ({
          quantities: [{ name: "available", quantity: stock }], location: { id: id(number), isActive: active, fulfillsOnlineOrders: online },
        })),
      } },
    } } });
    assert.match(query, /address \{ address1 address2 city province zip country countryCode phone \}/);
    assert.match(query, /id name isActive fulfillsOnlineOrders/);
    return Response.json(locationErrors ? { errors: [{ message: "Denied" }] } : { data: { nodes: options.variables.ids.map((gid) => ({
      id: gid, name: `Shop ${gid.split("/").at(-1)}`, isActive: nodeActive, fulfillsOnlineOrders: nodeOnline,
      address: { address1: "1 Main St", address2: "Unit A", city: "New York", province: "New York", zip: "10001", country: "United States", countryCode: "US", phone: "+1 555 0100" },
    })) } });
  } };
  const prisma = {
    fulfillmentLocationRule: { findMany: async (query) => { assert.deepEqual(query.where, { shop, enabled: true, pickupEnabled: true }); assert.equal(query.take, 101); return rules; } },
    postalCode: { findFirst: async () => exact, findMany: async (query) => { assert.equal(query.take, 2001); return patterns; } },
    deliverySetting: { findUnique: async () => ({ timeZone: "UTC" }) },
  };
  const load = injectedServer({
    "app/db.server.ts": prisma,
    "app/shopify.server.ts": { authenticate: { public: { appProxy: async () => ({ session: { shop }, admin: noAdmin ? undefined : admin }) } } },
    "app/services/plan-access.server.ts": { resolvePlanAccess: async () => ({ active: access, features: {} }) },
    "app/services/billing.server.ts": { billingRequiredResponse: () => Response.json({ billing_required: true }, { status: 402 }) },
    "app/services/delivery-checker.server.ts": { parseCodRequestParam: () => false, getGeneralDeliveryEstimate: () => ({ enabled: true, old: true }) },
  });
  const get = (extra = {}) => load("app/services/pickup-options.server.ts").getPickupOptions({ shop, admin, items: [item(1)], complete: true, timeZone: "UTC", now: new Date("2026-10-07T12:00:00Z"), ...extra });
  const proxy = async (params = {}) => {
    const url = new URL("https://example.com/apps/delivery-checker");
    for (const [key, value] of Object.entries({ service_options: "1", variantId: "1", ...params })) url.searchParams.set(key, value);
    const response = await load("app/routes/apps.delivery-checker.ts").loader({ request: new Request(url) });
    return { response, body: await response.json() };
  };
  return { get, calls, admin, proxy };
}

test("returns all stocked pickup locations with full Shopify address and address phone; override wins", async () => {
  const { get } = fixture({ rules: [rule(1), rule(2, { pickupPhone: "Store phone" })] });
  const result = await get();
  assert.equal(result.pickup_locations.length, 2);
  assert.deepEqual(Object.keys(result.pickup_locations[0]).sort(), ["id", "name", "address1", "address2", "city", "province", "postal_code", "country", "country_code", "phone", "pickup_instructions", "available_dates"].sort());
  assert.equal(result.pickup_locations[0].phone, "+1 555 0100");
  assert.equal(result.pickup_locations[1].phone, "Store phone");
  assert.equal(result.pickup_locations[0].available_dates[0], "2026-10-07");
  assert.equal(result.pickup_selection_valid, undefined);
  assert.equal(result.requires_postal_code, false);
});

test("physical stock still requires active online fulfillment at both inventory level and Shopify node", async () => {
  for (const flags of [{ active: false, nodeActive: true }, { online: false, nodeOnline: true },
    { nodeActive: false }, { nodeOnline: false }]) {
    const { get, calls } = fixture(flags);
    const result = await get({ pickupLocationId: "1", pickupDate: "2026-10-07" });
    assert.deepEqual(result.pickup_locations, []);
    assert.equal(result.pickup_selection_valid, false);
    assert.equal(calls.some((call) => call.query.includes("PickupLocations")), flags.nodeActive === false || flags.nodeOnline === false);
  }
});

test("identical variants with differing tags sum stock without merging targeting eligibility", async () => {
  const items = [item(1, 2, { productTags: ["vip"] }), item(1, 2, { variantId: "gid://shopify/ProductVariant/1", productTags: ["other"] })];
  const { get, calls } = fixture({ rules: [rule(1), rule(2, { serviceTargetMode: "tag", serviceTargetValuesCsv: "vip" })], levels: { 1: [[1, 3], [2, 10]] } });
  assert.deepEqual((await get({ items })).pickup_locations, []);
  assert.equal(calls.filter((call) => call.query.includes("VariantInventoryForEdd")).length, 1);
  assert.deepEqual((await fixture({ levels: { 1: [[1, 4], [2, 3]] } }).get({ items })).pickup_locations.map((location) => location.id), [id(1)]);
});

test("duplicate numeric/GID variants aggregate before inventory and all cart items must have physical stock", async () => {
  const { get, calls } = fixture({ levels: { 1: [[1, 2], [2, 4]], 2: [[1, 10], [2, 3]] } });
  const result = await get({ items: [item(1, 2), item(1, 2, { variantId: "gid://shopify/ProductVariant/1" }), item(2, 3)] });
  assert.deepEqual(result.pickup_locations.map((location) => location.id), [id(2)]);
  assert.equal(calls.filter((call) => call.query.includes("VariantInventoryForEdd")).length, 2);
  assert.deepEqual((await fixture({ levels: { 1: [[1, 0], [2, -1]] } }).get()).pickup_locations, []);
  assert.deepEqual((await fixture({ active: false }).get()).pickup_locations, []);
});

test("targeting requires every item and uses product, collection and tag matches", async () => {
  for (const [mode, values, extra] of [["product", "1,2", {}], ["collection", "SUMMER", { collectionHandles: ["summer"] }], ["tag", "VIP", { productTags: ["vip"] }]]) {
    const { get } = fixture({ rules: [rule(1, { serviceTargetMode: mode, serviceTargetValuesCsv: values })] });
    assert.equal((await get({ items: [item(1, 1, extra), item(2, 1, extra)] })).pickup_locations.length, 1);
    assert.equal((await get({ items: [item(1, 1, extra), item(3)] })).pickup_locations.length, 0);
  }
  assert.equal((await fixture({ rules: [rule(1, { serviceTargetMode: "unknown" })] }).get()).pickup_locations.length, 0);
});

test("zone targeting needs valid postal context and real enabled shop-owned zone matching", async () => {
  const rules = [rule(1, { serviceTargetMode: "zone", serviceTargetValuesCsv: "7" }), rule(2)];
  const exact = { zoneId: 7, zoneGroup: { enabled: true, shop } };
  for (const extra of [{}, { postalCode: "10001" }, { country: "US" }, { country: "US", postalCode: "bad" }]) {
    const result = await fixture({ rules, exact }).get(extra);
    assert.deepEqual(result.pickup_locations.map((location) => location.id), [id(2)]);
    assert.equal(result.requires_postal_code, true);
  }
  const context = { country: "US", postalCode: "10001" };
  assert.equal((await fixture({ rules, exact }).get(context)).pickup_locations.length, 2);
  assert.equal((await fixture({ rules, exact }).get(context)).requires_postal_code, false);
  assert.equal((await fixture({ rules }).get(context)).requires_postal_code, false);
  assert.equal((await fixture({ rules: [rules[0]] }).get()).requires_postal_code, true);
  assert.equal((await fixture({ rules: [] }).get()).requires_postal_code, false);
  for (const zoneGroup of [{ enabled: false, shop }, { enabled: true, shop: "other" }]) {
    assert.equal((await fixture({ rules, exact: { ...exact, zoneGroup } }).get(context)).pickup_locations.length, 1);
  }
  const pattern = { id: 1, zoneId: 7, zoneGroup: { enabled: true, shop, priority: 1 }, patternType: "wildcard", postalCode: "100*" };
  assert.equal((await fixture({ rules, patterns: [pattern] }).get(context)).pickup_locations.length, 2);
  assert.equal((await fixture({ rules, patterns: [{ ...pattern, patternType: "range", rangeStart: "10000", rangeEnd: "10010" }] }).get(context)).pickup_locations.length, 2);
  await assert.rejects(fixture({ rules, patterns: Array(2001).fill(pattern) }).get(context), /exceeds limit/);
});

test("enabled exact zones take precedence and disabled exact zones allow broader matches like delivery", async () => {
  const rules = [rule(1, { serviceTargetMode: "zone", serviceTargetValuesCsv: "7" })];
  const patterns = [{ id: 1, zoneId: 7, zoneGroup: { enabled: true, shop, priority: 1 }, patternType: "wildcard", postalCode: "100*" }];
  const context = { country: "US", postalCode: "10001" };
  const exact = { zoneId: 8, zoneGroup: { enabled: true, shop } };
  assert.equal((await fixture({ rules, exact, patterns }).get(context)).pickup_locations.length, 0);
  assert.equal((await fixture({ rules, exact: { ...exact, zoneGroup: { enabled: false, shop } }, patterns }).get(context)).pickup_locations.length, 1);
  assert.equal((await fixture({ rules, exact: { zoneId: null }, patterns }).get(context)).pickup_locations.length, 0);
});

test("proxy exposes postal requirement without hiding untargeted pickup options", async () => {
  const { proxy } = fixture({ rules: [rule(1, { serviceTargetMode: "zone", serviceTargetValuesCsv: "7" }), rule(2)] });
  const absent = await proxy();
  assert.equal(absent.body.requires_postal_code, true);
  assert.deepEqual(absent.body.pickup_locations.map((location) => location.id), [id(2)]);
  assert.equal((await proxy({ country: "US", postal_code: "10001" })).body.requires_postal_code, false);
});

test("selection is rechecked against stock, target and schedule and malformed paired inputs are rejected", async () => {
  const { get } = fixture({ rules: [rule(1, { pickupBlockedDatesCsv: "2026-10-08" })] });
  assert.equal((await get({ pickupLocationId: "1", pickupDate: "2026-10-07" })).pickup_selection_valid, true);
  for (const [pickupLocationId, pickupDate] of [[id(1), "2026-10-08"], ["2", "2026-10-07"], ["1", "2026-11-07"]]) {
    assert.equal((await get({ pickupLocationId, pickupDate })).pickup_selection_valid, false);
  }
  for (const extra of [{ pickupLocationId: "1" }, { pickupDate: "2026-10-07" }, { pickupLocationId: "abc1", pickupDate: "2026-10-07" }, { pickupLocationId: "1", pickupDate: "2026-02-29" }]) {
    await assert.rejects(get(extra), RangeError);
  }
  assert.equal((await fixture({ levels: { 1: [[1, 0]] } }).get({ pickupLocationId: "1", pickupDate: "2026-10-07" })).pickup_selection_valid, false);
});

test("missing admin, incomplete/oversized carts, truncated inventory/rules and GraphQL errors fail closed", async () => {
  const { get } = fixture();
  await assert.rejects(get({ admin: undefined }), /unavailable/);
  for (const extra of [{ complete: false }, { items: [] }, { items: Array(21).fill(item(1)) }, { items: [item(1, 0)] }]) await assert.rejects(get(extra), RangeError);
  await assert.rejects(fixture({ rules: Array(101).fill(rule(1)) }).get(), /exceed limit/);
  await assert.rejects(fixture({ truncated: true }).get(), /inventory unavailable/);
  await assert.rejects(fixture({ locationErrors: true }).get(), /locations unavailable/);
});

test("signed proxy branch follows billing and canonical targeting, requires complete cart, precedes init/estimate", async () => {
  const { proxy } = fixture({ rules: [rule(1, { serviceTargetMode: "tag", serviceTargetValuesCsv: "spoofed" }), rule(2, { serviceTargetMode: "tag", serviceTargetValuesCsv: "verified" })] });
  const { response, body } = await proxy({ productTags: "spoofed", init: "1", estimate: "1" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(body.pickup_locations.map((location) => location.id), [id(2)]);
  assert.equal((await fixture({ access: false }).proxy()).response.status, 402);
  for (const count of [20, 21]) {
    const result = await proxy({ surface: "cart", cartItems: JSON.stringify(Array(count).fill(item(1))) });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.cart_complete, false);
  }
  assert.equal((await proxy({ pickup_location_id: "2", pickup_date: "invalid" })).response.status, 400);
  assert.equal((await proxy({ variantId: "abc1" })).response.status, 400);
  assert.equal((await proxy({ qty: "NaN" })).response.status, 400);
  assert.equal((await fixture({ noAdmin: true }).proxy()).response.status, 503);
  assert.equal((await fixture({ rules: [rule(1, { pickupWeekdaysCsv: "7" })] }).proxy()).response.status, 503);
});

test("pickup options remain opt-in and do not change existing estimate responses", async () => {
  const { proxy, calls } = fixture();
  const { body } = await proxy({ service_options: "0", estimate: "1" });
  assert.equal(body.old, true);
  assert.equal(body.pickup_locations, undefined);
  assert.equal(calls.some((call) => call.query.includes("VariantInventoryForEdd") || call.query.includes("PickupLocations")), false);
});
