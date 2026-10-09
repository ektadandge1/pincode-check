import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CART_DELIVERY_ITEMS, MAX_CART_DELIVERY_BYTES, MAX_DELIVERY_QUANTITY,
  parseCartDeliveryItems, aggregateCartDeliveryItems, mapCartDeliveryItems,
} from "../app/utils/delivery.server.ts";
import { parseHeadlessDeliveryInput } from "../app/utils/headless-request.ts";
import { resolveShopifyProductContexts, canonicalProductFor } from "../app/services/product-context.server.ts";
import { STANDARD_FEATURES } from "../app/services/plans.server.ts";
import { injectedServer } from "./helpers/injected-server.mjs";

const features = { ...STANDARD_FEATURES, analytics: false };
const item = (id, quantity = 1) => ({ productId: String(id), variantId: `gid://shopify/ProductVariant/${id}`, quantity });
const cart = (count = 250, quantity = 1) => Array.from({ length: count }, (_, i) => item(i + 1, quantity));
const target = (overrides = {}) => ({ id: 1, name: "Last line", targetKind: "product", targetValue: "250",
  enabled: true, priority: 1, inventoryMode: "any", requireValidPin: true,
  processingDays: 1, transitDays: 12, excluded: false, ...overrides });
const pickupRule = { shopifyLocationId: "gid://shopify/Location/1", enabled: true, pickupEnabled: true,
  serviceTargetMode: "all", serviceTargetValuesCsv: "", pickupPreparationDays: 0, pickupAdvanceDays: 30,
  pickupWeekdaysCsv: "0,1,2,3,4,5,6", pickupBlockedDatesCsv: "", pickupPhone: "", pickupInstructions: "Bring ID" };

function fixture({ targets = [], settings = null, pickupRules = [], stock = MAX_DELIVERY_QUANTITY,
  missingVariant, failBatch, active = true } = {}) {
  const calls = [];
  const authenticated = [];
  let batches = 0;
  let reads = 0;
  const admin = { graphql: async (query, { variables }) => {
    calls.push({ query, variables });
    if (query.includes("DeliveryCheckerProductContexts")) {
      if (++batches === failBatch) return Response.json({ errors: [{ message: "Throttled" }] });
      return Response.json({ data: { nodes: variables.ids.map((id) => {
        const number = id.split("/").at(-1);
        if (number === String(missingVariant)) return null;
        const product = { id: `gid://shopify/Product/${number}`, vendor: "Verified", tags: [],
          collections: { nodes: [], pageInfo: { hasNextPage: false } } };
        return id.includes("ProductVariant") ? { id, product } : product;
      }) } });
    }
    if (query.includes("VariantInventoryForEdd")) return Response.json({ data: { productVariant: {
      sellableOnlineQuantity: stock, inventoryPolicy: "DENY", inventoryItem: { inventoryLevels: {
        pageInfo: { hasNextPage: false }, nodes: [{ quantities: [{ name: "available", quantity: stock }],
          location: { id: pickupRule.shopifyLocationId, isActive: true, fulfillsOnlineOrders: true } }],
      } },
    } } });
    assert.match(query, /PickupLocations/);
    return Response.json({ data: { nodes: variables.ids.map((id) => ({ id, name: "Store",
      isActive: true, fulfillsOnlineOrders: true, address: { address1: "Main St", address2: null,
        city: "New York", province: null, zip: "10001", country: "United States", countryCode: "US", phone: null } })) } });
  } };
  const db = {
    deliverySetting: { findUnique: async () => { reads++; return settings; } },
    deliveryTarget: { findMany: async () => targets },
    serviceAvailabilityRule: { findMany: async () => [] },
    fulfillmentLocationRule: { findMany: async () => pickupRules },
    shippingMethodRule: { findMany: async () => [] },
    postalCode: { findFirst: async () => ({ zoneId: null, serviceable: true, deliveryDays: 2, codAvailable: false }), findMany: async () => [] },
  };
  const load = injectedServer({
    "app/db.server.ts": db,
    "app/shopify.server.ts": { authenticate: { public: { appProxy: async (request) => {
      authenticated.push(request.url);
      return { session: { shop: "large-cart.myshopify.com" }, admin };
    } } } },
    "app/services/plan-access.server.ts": { resolvePlanAccess: async () => ({ active, features }) },
    "app/services/billing.server.ts": { billingRequiredResponse: () => Response.json({ billing_required: true }, { status: 402 }) },
  });
  const input = { shop: "large-cart.myshopify.com", country: "US", postalCode: "10001", admin, features, trackAnalytics: false };
  const route = load("app/routes/apps.delivery-checker.ts");
  const proxy = async (items, params = {}, options = {}) => {
    const url = new URL("https://example.com/apps/delivery-checker?surface=cart&country=US");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const post = options.post !== false;
    if (!post && items !== undefined) url.searchParams.set("cartItems", JSON.stringify(items));
    const request = new Request(url, post ? { method: "POST", headers: { "content-type": "application/json", ...options.headers },
      body: options.raw ?? JSON.stringify(options.body ?? { cartItems: items }) } : undefined);
    const response = await (post ? route.action : route.loader)({ request });
    return { response, body: await response.json() };
  };
  return { calls, authenticated, admin, input, proxy, route, reads: () => reads,
    service: load("app/services/delivery-checker.server.ts"), pickup: load("app/services/pickup-options.server.ts").getPickupOptions };
}

test("cart bounds accept complete normal large carts including the former 20/999 boundaries", () => {
  assert.equal(MAX_CART_DELIVERY_ITEMS, 250);
  assert.equal(MAX_DELIVERY_QUANTITY, 2 ** 31 - 1);
  for (const count of [20, 21, 50, 250]) {
    const parsed = parseCartDeliveryItems(JSON.stringify(cart(count, 1000)));
    assert.equal(parsed.complete, true);
    assert.equal(parsed.items.length, count);
    assert.equal(parsed.items.at(-1).quantity, 1000);
  }
  const full = cart(250, MAX_DELIVERY_QUANTITY).map((line) => ({ ...line, productId: `gid://shopify/Product/${line.productId}` }));
  assert.ok(JSON.stringify(full).length > 20_000);
  assert.equal(parseCartDeliveryItems(JSON.stringify(full)).complete, true);
  assert.equal(parseCartDeliveryItems(null).provided, false);
  assert.equal(parseCartDeliveryItems("[]").complete, true);
});

test("over-limit lines, invalid quantities, malformed and byte-oversized carts never return a subset", () => {
  for (const payload of [JSON.stringify(cart(251)), " ".repeat(MAX_CART_DELIVERY_BYTES + 1),
    JSON.stringify([{ ...item(1), productVendor: "\u00e9".repeat(MAX_CART_DELIVERY_BYTES / 2) }])]) {
    const result = parseCartDeliveryItems(payload);
    assert.equal(result.error, "cart_too_large");
    assert.equal(result.complete, false);
    assert.deepEqual(result.items, []);
  }
  for (const quantity of [0, -1, 1.5, MAX_DELIVERY_QUANTITY + 1, Number.MAX_SAFE_INTEGER, true, null, [], {}]) {
    const result = parseCartDeliveryItems(JSON.stringify([...cart(249), item(250, quantity)]));
    assert.equal(result.error, "invalid_cart", String(quantity));
    assert.deepEqual(result.items, []);
  }
  for (const value of ["", "not json", "{}", '[null]']) assert.equal(parseCartDeliveryItems(value).complete, false);
});

test("headless quantities use the same Shopify Int bound without relaxing JSON types", () => {
  for (const quantity of [1, 999, 1000, MAX_DELIVERY_QUANTITY]) {
    assert.equal(parseHeadlessDeliveryInput({ country: "US", postal_code: "10001", quantity }).quantity, quantity);
  }
  for (const quantity of [MAX_DELIVERY_QUANTITY + 1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, 1.5, "1000", true, null]) {
    assert.throws(() => parseHeadlessDeliveryInput({ country: "US", postal_code: "10001", quantity }), { code: "invalid_quantity" });
  }
});

test("duplicate maximum line quantities aggregate exactly rather than clamping to a line limit", () => {
  const lines = Array.from({ length: 250 }, (_, i) => ({ ...item(1, MAX_DELIVERY_QUANTITY), variantId: i % 2 ? "1" : item(1).variantId }));
  const aggregated = aggregateCartDeliveryItems(lines);
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].item.quantity, 250 * MAX_DELIVERY_QUANTITY);
  assert.equal(Number.isSafeInteger(aggregated[0].item.quantity), true);
  assert.equal(aggregated[0].itemCount, 250);
});

test("large-cart work remains bounded to the old 20-line concurrent fan-out and preserves order", async () => {
  let pending = 0;
  let peak = 0;
  const results = await mapCartDeliveryItems(cart(), async ({ item }) => {
    peak = Math.max(peak, ++pending);
    await new Promise((resolve) => setImmediate(resolve));
    pending--;
    return item.productId;
  });
  assert.equal(peak, 20);
  assert.deepEqual(results, cart().map((line) => line.productId));
});

test("actual ETA, policy and delivery include the 250th line rather than a 20-line estimate", async () => {
  const f = fixture({ targets: [target()] });
  const lines = cart();
  const estimate = await f.service.getGeneralCartDeliveryEstimate({ ...f.input, postalCode: undefined }, lines);
  const lastEstimate = await f.service.getGeneralDeliveryEstimate({ ...f.input, postalCode: undefined, ...item(250) });
  assert.equal(estimate.enabled, true);
  assert.equal(estimate.estimated_date, lastEstimate.estimated_date);
  assert.equal(estimate.estimated_date_max, lastEstimate.estimated_date_max);
  assert.equal(estimate.cart_items_checked, 250);
  const policy = await f.service.checkCartDeliveryPolicy(f.input, lines);
  assert.equal(policy.require_valid_pin, true);
  assert.equal(policy.cart_items_checked, 250);
  const delivery = await f.service.checkCartDelivery(f.input, lines);
  const lastDelivery = await f.service.checkDelivery({ ...f.input, ...item(250) });
  assert.equal(delivery.available, true);
  assert.equal(delivery.cart_complete, true);
  assert.equal(delivery.cart_items_checked, 250);
  assert.equal(delivery.estimated_date_max, lastDelivery.estimated_date_max);
  const excluded = fixture({ targets: [target({ excluded: true })] });
  assert.equal((await excluded.service.getGeneralCartDeliveryEstimate({ ...excluded.input, postalCode: undefined }, lines)).enabled, false);
  assert.equal((await excluded.service.checkCartDelivery(excluded.input, lines)).unavailable_items, 1);
});

test("invalid or explicitly incomplete carts fail before any calculation and expose no partial dates", async () => {
  const f = fixture();
  for (const call of [f.service.getGeneralCartDeliveryEstimate, f.service.checkCartDeliveryPolicy, f.service.checkCartDelivery]) {
    for (const [lines, options] of [[cart(251), {}], [cart(), { complete: false }],
      [[...cart(249), item(250, MAX_DELIVERY_QUANTITY + 1)], {}]]) {
      const result = await call(f.input, lines, options);
      assert.equal(result.cart_complete, false);
      assert.equal(result.estimated_date, undefined);
      assert.equal(result.estimated_date_max, undefined);
      assert.ok(["invalid_cart", "cart_incomplete"].includes(result.reason));
    }
  }
  assert.equal(f.reads(), 0);
  assert.equal(f.calls.length, 0);
});

test("cart product verification bypasses only the old cart ID cap, uses cost-bounded nodes batches, and keeps mismatches invalid", async () => {
  const f = fixture();
  const resolved = await resolveShopifyProductContexts(f.admin, cart(), { cart: true });
  assert.equal(resolved.variants.size, 250);
  assert.ok(canonicalProductFor(resolved, "250", item(250).variantId));
  assert.equal(canonicalProductFor(resolved, "249", item(250).variantId), null);
  assert.equal(f.calls.length, 50);
  assert.ok(f.calls.every(({ variables }) => variables.ids.length <= 5));
  assert.ok(f.calls.every(({ variables }) => variables.ids.every((id) => id.includes("ProductVariant"))));
  await assert.rejects(resolveShopifyProductContexts(f.admin, cart(51)), RangeError);
  await assert.rejects(resolveShopifyProductContexts(f.admin, cart(252), { cart: true }), RangeError);
});

test("POST supports delivery, ETA, policy and pickup on 250 lines with canonical verification", async () => {
  const f = fixture({ targets: [target()], pickupRules: [pickupRule] });
  for (const mode of [{ postal_code: "10001" }, { estimate: "1" }, { init: "1" }, { service_options: "1" }]) {
    const { response, body } = await f.proxy(cart(250, 1000), mode);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    if (mode.service_options) assert.equal(body.pickup_locations.length, 1);
    else assert.equal(body.cart_items_checked, 250);
    if (mode.estimate) assert.equal(body.enabled, true);
    if (mode.init) assert.equal(body.require_valid_pin, true);
    if (mode.postal_code) assert.equal(body.available, true);
  }
  assert.equal(f.authenticated.length, 4);
  assert.ok(f.authenticated.every((url) => !url.includes("cartItems")));
  assert.equal((await f.proxy(cart(21, 1000), { init: "1" }, { post: false })).response.status, 200);
});

test("POST rejects malformed, oversized, spoofed and ambiguous bodies without product queries", async () => {
  const f = fixture();
  for (const options of [{ raw: "not json" }, { body: [] }, { body: {} },
    { body: { cartItems: cart(1), shop: "forged.myshopify.com" } },
    { body: { cartItems: cart(1), productTags: ["forged"] } },
    { body: { cartItems: "[]" } }, { body: { cartItems: cart(251) } },
    { raw: " ".repeat(MAX_CART_DELIVERY_BYTES + 1) },
    { raw: "{}", headers: { "content-length": String(MAX_CART_DELIVERY_BYTES + 1) } },
    { headers: { "content-type": "text/plain" } }]) {
    const { response, body } = await f.proxy(cart(1), { estimate: "1" }, options);
    assert.ok([400, 413, 415].includes(response.status));
    assert.equal(body.cart_complete, false);
    assert.equal(body.estimated_date, undefined);
    assert.equal(body.disable_add_to_cart, true);
  }
  assert.equal((await f.proxy(cart(1), { cartItems: "[]" })).response.status, 400);
  assert.equal(f.calls.length, 0);
});

test("a late verification failure or missing last variant never becomes a partial successful estimate", async () => {
  for (const [options, status, reason] of [[{ failBatch: 50 }, 503, "product_context_unavailable"],
    [{ missingVariant: 250 }, 400, "invalid_cart"]]) {
    const f = fixture(options);
    const result = await f.proxy(cart(), { estimate: "1" });
    assert.equal(result.response.status, status);
    assert.equal(result.body.reason, reason);
    assert.equal(result.body.cart_complete, false);
    assert.equal(result.body.estimated_date, undefined);
  }
  const denied = await fixture({ active: false }).proxy(cart(), { init: "1" });
  assert.equal(denied.response.status, 402);
});

test("cart POST and GET share the existing request limit, including malformed bodies", async () => {
  const f = fixture();
  for (let i = 0; i < 120; i++) {
    assert.equal((await f.proxy([], {}, { raw: "invalid json" })).response.status, 400);
  }
  for (const post of [true, false]) {
    const result = await f.proxy(cart(1), { init: "1" }, { post });
    assert.equal(result.response.status, 429);
    assert.equal(result.response.headers.get("Retry-After"), "60");
  }
  assert.equal(f.calls.length, 0);
});

test("existing product-card batch POST is not captured by the cart POST branch", async () => {
  const f = fixture();
  const result = await f.proxy(undefined, { batch: "1" }, { body: { items: [{ key: "card-1", productId: "1" }] } });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.results.length, 1);
  assert.equal(result.body.results[0].key, "card-1");
  assert.equal(f.authenticated.length, 1);
});

test("pickup accepts large carts but still checks summed quantities, including above GraphQL Int for duplicate totals", async () => {
  const f = fixture({ pickupRules: [pickupRule] });
  const input = { shop: f.input.shop, admin: f.admin, complete: true, timeZone: "UTC", now: new Date("2026-10-09T12:00:00Z") };
  assert.equal((await f.pickup({ ...input, items: cart(250, MAX_DELIVERY_QUANTITY) })).pickup_locations.length, 1);
  assert.deepEqual((await f.pickup({ ...input, items: [item(1, MAX_DELIVERY_QUANTITY), item(1, 1)] })).pickup_locations, []);
  for (const items of [cart(251), [item(1, MAX_DELIVERY_QUANTITY + 1)]]) {
    await assert.rejects(f.pickup({ ...input, items }), RangeError);
  }
  const stocked = fixture({ stock: 1500, targets: [target({ targetValue: "1", inventoryMode: "out_of_stock", excluded: true })] });
  const delivery = await stocked.service.checkCartDelivery(stocked.input, [item(1, 1000), item(1, 1000)]);
  assert.equal(delivery.available, false);
  assert.equal(delivery.unavailable_items, 2);
  assert.equal(stocked.calls.filter(({ query }) => query.includes("VariantInventoryForEdd")).length, 1);
});
