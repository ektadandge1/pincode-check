import assert from "node:assert/strict";
import test from "node:test";
import { injectedServer } from "./helpers/injected-server.mjs";
import { STANDARD_FEATURES } from "../app/services/plans.server.ts";
import * as deliveryUtils from "../app/utils/delivery.server.ts";

const features = { ...STANDARD_FEATURES, analytics: false };
const rule = (overrides = {}) => ({
  id: 1, shop: "test.myshopify.com", name: "Restricted", targetKind: "product", targetValue: "1",
  inventoryMode: "backorder", requireValidPin: true, processingDays: 1, transitDays: 3,
  excluded: false, enabled: true, priority: 1, ...overrides,
});
const item = (id, quantity = 1) => ({ productId: `gid://shopify/Product/${id}`, variantId: `gid://shopify/ProductVariant/${id}`, quantity });
const input = { shop: "test.myshopify.com", country: "US", postalCode: "10001", features, trackAnalytics: false };

function fixture(targets = [rule()], { inventoryFailure = false, contextFailure = false, unknown = false, utils, cityRecords = [], serviceRules = [] } = {}) {
  const calls = [];
  const admin = { graphql: async (query, options) => {
    calls.push({ query, variables: options.variables });
    if (query.includes("DeliveryCheckerProductContexts")) {
      if (contextFailure) throw new Error("Product context network failure");
      return Response.json({ data: { nodes: options.variables.ids.map((id) => {
        if (unknown) return null;
        const number = id.split("/").at(-1);
        const product = { id: `gid://shopify/Product/${number}`, vendor: "Canonical", tags: [], collections: { nodes: [], pageInfo: { hasNextPage: false } } };
        return id.includes("ProductVariant") ? { id, product } : product;
      }) } });
    }
    if (inventoryFailure) return Response.json({ errors: [{ message: "Stock access unavailable" }] });
    return Response.json({ data: { productVariant: {
      sellableOnlineQuantity: 2, inventoryPolicy: "CONTINUE",
      inventoryItem: { inventoryLevels: { nodes: [], pageInfo: { hasNextPage: false } } },
    } } });
  } };
  const prisma = {
    deliverySetting: { findUnique: async () => null },
    deliveryTarget: { findMany: async () => targets },
    serviceAvailabilityRule: { findMany: async () => serviceRules },
    postalCode: { findFirst: async () => ({ zoneId: null, serviceable: true, deliveryDays: 4, codAvailable: false }), findMany: async (args = {}) => args.where?.city ? cityRecords : [] },
    shippingMethodRule: { findMany: async () => [] },
    fulfillmentLocationRule: { findMany: async () => [] },
  };
  const load = injectedServer({
    "app/db.server.ts": prisma,
    "app/shopify.server.ts": { authenticate: { public: { appProxy: async () => ({ session: { shop: input.shop }, admin }) } } },
    "app/services/plan-access.server.ts": { resolvePlanAccess: async () => ({ active: true, features }) },
    "app/services/billing.server.ts": { billingRequiredResponse: () => { throw new Error("Unexpected billing response"); } },
    ...(utils ? { "app/utils/delivery.server.ts": { ...deliveryUtils, ...utils } } : {}),
  });
  const service = load("app/services/delivery-checker.server.ts");
  const route = load("app/routes/apps.delivery-checker.ts");
  const proxy = async (mode, cartItems, extra = {}) => {
    const url = new URL("https://example.com/apps/delivery-checker");
    if (mode) url.searchParams.set(mode, "1");
    url.searchParams.set("surface", "cart");
    url.searchParams.set("country", "US");
    if (cartItems !== undefined) url.searchParams.set("cartItems", typeof cartItems === "string" ? cartItems : JSON.stringify(cartItems));
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
    const response = await route.loader({ request: new Request(url) });
    return { response, body: await response.json() };
  };
  return { service, admin, calls, proxy };
}

test("service availability rules suppress automatic shipping estimates and initialize service choices", async () => {
  const serviceRule = rule({
    name: "Pickup only",
    inventoryMode: "any",
    requireValidPin: false,
    processingDays: null,
    transitDays: null,
    shippingAvailable: false,
    localDeliveryAvailable: false,
    pickupAvailable: true,
  });
  const { service, admin } = fixture([], { serviceRules: [serviceRule] });
  const context = { ...input, postalCode: undefined, ...item(1), admin };

  const estimate = await service.getGeneralDeliveryEstimate(context);
  assert.equal(estimate.enabled, false);
  assert.equal(estimate.shipping_available, false);
  assert.equal(estimate.reason, "service_unavailable");
  assert.equal(estimate.matched_service_target, "Pickup only");

  const policy = await service.checkDeliveryPolicy(context);
  assert.equal(policy.shipping_available, false);
  assert.equal(policy.local_delivery_available, false);
  assert.equal(policy.pickup_available, true);

  const cartPolicy = await service.checkCartDeliveryPolicy(context, [item(1), item(2)]);
  assert.equal(cartPolicy.shipping_available, false);
  assert.equal(cartPolicy.local_delivery_available, false);
  assert.equal(cartPolicy.pickup_available, true);
});

test("specific all-service rules override broader restrictions", async () => {
  const allOn = rule({
    name: "Product exception",
    inventoryMode: "any",
    requireValidPin: false,
    processingDays: null,
    transitDays: null,
    shippingAvailable: true,
    localDeliveryAvailable: true,
    pickupAvailable: true,
  });
  const restriction = { ...allOn, id: 2, name: "Tagged products cannot ship", targetKind: "tag", targetValue: "restricted", priority: 2, shippingAvailable: false };
  const { service, admin } = fixture([], { serviceRules: [allOn, restriction] });
  const estimate = await service.getGeneralDeliveryEstimate({ ...input, postalCode: undefined, ...item(1), productTags: ["restricted"], admin });
  assert.equal(estimate.enabled, true);
});

test("actual delivery, general estimate and policy callers fail closed on inventory-target fetch failures without inventoryAware", async () => {
  const { service, admin } = fixture([rule(), rule({ id: 2, inventoryMode: "any", name: "Fallback", requireValidPin: false, priority: 2 })], { inventoryFailure: true });
  const context = { ...input, ...item(1), admin };
  const delivery = await service.checkDelivery(context);
  assert.equal(delivery.available, false);
  assert.equal(delivery.reason, "inventory_unavailable");
  assert.equal(delivery.require_valid_pin, true);
  assert.equal(delivery.estimated_date, undefined);
  const estimate = await service.getGeneralDeliveryEstimate(context);
  assert.equal(estimate.enabled, false);
  assert.equal(estimate.reason, "inventory_unavailable");
  const policy = await service.checkDeliveryPolicy(context);
  assert.equal(policy.reason, "inventory_unavailable");
  assert.equal(policy.disable_add_to_cart, true);
  assert.equal(policy.require_valid_pin, true);
  assert.equal(policy.matched_target, null);
  assert.equal((await service.getGeneralDeliveryEstimate({ ...context, admin: undefined })).reason, "inventory_unavailable");
});

test("city suggestions return every configured exact postal code once", async () => {
  const { proxy } = fixture([], { cityRecords: [
    { id: 1, postalCode: "400001", city: "Mumbai", state: "Maharashtra" },
    { id: 2, postalCode: "400002", city: "Mumbai", state: "Maharashtra" },
    { id: 3, postalCode: "400001", city: "Mumbai", state: "Maharashtra" },
  ] });
  const result = await proxy(null, undefined, { city_suggestions: "1", city: "mumbai" });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.suggestions.map((entry) => entry.postal_code), ["400001", "400002"]);
  assert.equal(result.body.suggestions[0].state, "Maharashtra");
});

test("actual callers require variants for applicable inventory targets but do not block unrelated products", async () => {
  const { service, admin } = fixture([], { inventoryFailure: true });
  assert.equal((await service.getGeneralDeliveryEstimate({ ...input, ...item(2), admin })).enabled, true);
  const restricted = fixture();
  for (const call of [restricted.service.getGeneralDeliveryEstimate, restricted.service.checkDeliveryPolicy, restricted.service.checkDelivery]) {
    const result = await call({ ...input, productId: item(1).productId, admin: restricted.admin });
    assert.equal(result.reason, "variant_required");
  }
  assert.equal((await restricted.service.getGeneralDeliveryEstimate({ ...input, ...item(2), admin: restricted.admin })).enabled, true);
});

test("actual cart policy aggregates duplicate variant quantities and any required PIN", async () => {
  const { service, admin, calls } = fixture();
  const policy = await service.checkCartDeliveryPolicy({ ...input, admin }, [item(1), item(1, 2), item(2)]);
  assert.equal(policy.require_valid_pin, true);
  assert.equal(policy.cart_complete, true);
  assert.equal(policy.cart_items_checked, 3);
  assert.equal(calls.filter((call) => call.query.includes("VariantInventoryForEdd")).length, 1);
  assert.equal((await service.checkCartDeliveryPolicy({ ...input, admin }, [item(1), item(2)])).require_valid_pin, false);
  const mixed = [item(1), { ...item(1, 2), productId: "1", variantId: "1" }];
  assert.equal((await service.checkCartDeliveryPolicy({ ...input, admin }, mixed)).require_valid_pin, true);
  assert.equal((await service.getGeneralCartDeliveryEstimate({ ...input, admin }, mixed)).enabled, true);
});

test("actual cart estimates aggregate independent earliest/latest/dispatch maxima", async () => {
  const targets = [rule({ inventoryMode: "any", transitDays: 1 }), rule({ id: 2, targetValue: "2", inventoryMode: "any", transitDays: 10 })];
  const dates = { 1: "2026-10-10", 3: "2026-10-11", 10: "2026-10-09", 12: "2026-10-15" };
  const { service, admin } = fixture(targets, { utils: { computeDeliveryDetails: ({ transitDays }) => ({
    orderDate: new Date("2026-10-06T12:00:00Z"),
    dispatchDate: new Date(transitDays < 5 ? "2026-10-07T12:00:00Z" : "2026-10-08T12:00:00Z"),
    estimatedDate: new Date(`${dates[transitDays]}T12:00:00Z`),
  }) } });
  const estimate = await service.getGeneralCartDeliveryEstimate({ ...input, admin }, [item(1), item(2)]);
  assert.equal(estimate.enabled, true);
  assert.equal(estimate.estimated_date, "2026-10-10");
  assert.equal(estimate.estimated_date_max, "2026-10-15");
  assert.equal(estimate.dispatch_date, "2026-10-08");
  assert.equal(estimate.estimated_date_label, deliveryUtils.formatReadableDate(new Date("2026-10-10T12:00:00Z"), "en", "UTC", "weekday_day_month"));
  assert.equal(estimate.estimated_date_max_label, deliveryUtils.formatReadableDate(new Date("2026-10-15T12:00:00Z"), "en", "UTC", "weekday_day_month"));
  assert.equal(estimate.available, undefined);
  assert.equal(estimate.fulfillment_location_id, undefined);
});

test("actual cart estimate/policy callers reject incomplete and unknown item context", async () => {
  const { service, admin } = fixture();
  for (const call of [service.getGeneralCartDeliveryEstimate, service.checkCartDeliveryPolicy]) {
    assert.equal((await call({ ...input, admin }, [item(1)], { complete: false })).reason, "cart_incomplete");
    assert.equal((await call({ ...input, admin }, [])).reason, "invalid_cart");
    assert.equal((await call({ ...input, admin }, [{ ...item(1), productId: undefined }])).reason, "invalid_cart");
  }
});

test("actual cart delivery rejects empty context without single-product fallback", async () => {
  const { service, admin, calls } = fixture([]);
  for (const complete of [true, false]) {
    const result = await service.checkCartDelivery({ ...input, admin }, [], { complete });
    assert.equal(result.available, false);
    assert.equal(result.reason, "invalid_cart");
    assert.equal(result.source, "none");
    assert.equal(result.cart_complete, false);
    assert.equal(result.cart_items_checked, 0);
    assert.equal(result.disable_add_to_cart, true);
    assert.equal(result.require_valid_pin, true);
    assert.equal(result.estimated_date, undefined);
  }
  assert.equal(calls.length, 0);
});

test("ordinary proxy cart checks reject missing/empty context even with a page product", async () => {
  const { proxy, calls } = fixture([]);
  for (const cart of [undefined, [], ""]) {
    for (const pageContext of [{}, { productId: "1", variantId: "1" }]) {
      const { response, body } = await proxy(null, cart, { postal_code: "10001", ...pageContext });
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(body.reason, "invalid_cart");
      assert.equal(body.available, false);
      assert.equal(body.cart_complete, false);
      assert.equal(body.cart_items_checked, 0);
      assert.equal(body.disable_add_to_cart, true);
      assert.equal(body.require_valid_pin, true);
      assert.equal(body.estimated_date, undefined);
    }
  }
  assert.equal(calls.length, 0);
  const explicitCart = await proxy(null, [], { surface: "product", postal_code: "10001" });
  assert.equal(explicitCart.response.status, 400);
  assert.equal(explicitCart.body.reason, "invalid_cart");
  const productCheck = await proxy(null, undefined, { surface: "product", postal_code: "10001" });
  assert.equal(productCheck.response.status, 200);
  assert.equal(productCheck.body.available, true);
  const validCart = await proxy(null, [item(1)], { postal_code: "10001" });
  assert.equal(validCart.body.available, true);
  assert.equal(validCart.body.cart_complete, true);
  const partialCart = await proxy(null, Array.from({ length: 20 }, () => item(1)), { postal_code: "10001" });
  assert.equal(partialCart.response.status, 200);
  assert.equal(partialCart.body.available, true);
  assert.equal(partialCart.body.cart_complete, true);
});

test("proxy estimate/init use canonical cart targets, exclusions and summed quantities rather than page context", async () => {
  const { proxy } = fixture([rule({ excluded: true })]);
  const items = [item(1), { ...item(1, 2), productVendor: "Forged" }, item(2)];
  const estimate = await proxy("estimate", items);
  assert.equal(estimate.response.status, 200);
  assert.equal(estimate.body.enabled, false);
  assert.equal(estimate.body.reason, "target_excluded");
  assert.equal(estimate.body.estimated_date, undefined);
  const init = await proxy("init", items);
  assert.equal(init.body.require_valid_pin, true);
  assert.equal(init.body.disable_add_to_cart, false);
  assert.equal(init.body.reason, "target_excluded");
  assert.equal(init.response.headers.get("Cache-Control"), "no-store");
  const canonical = await fixture([rule({ targetKind: "vendor", targetValue: "Canonical", inventoryMode: "any" })])
    .proxy("init", [{ ...item(1), productVendor: "Forged" }]);
  assert.equal(canonical.body.require_valid_pin, true);
  assert.equal(canonical.body.reason, undefined);
});

test("proxy estimate/init fail closed on inventory failures", async () => {
  const { proxy } = fixture([rule()], { inventoryFailure: true });
  const estimate = await proxy("estimate", [item(1)]);
  assert.equal(estimate.body.enabled, false);
  assert.equal(estimate.body.reason, "inventory_unavailable");
  const init = await proxy("init", [item(1)]);
  assert.equal(init.body.require_valid_pin, true);
  assert.equal(init.body.disable_add_to_cart, true);
  assert.equal(init.body.reason, "inventory_unavailable");
});

test("proxy estimate/init reject malformed, missing, empty, incomplete and unverified carts", async () => {
  const { proxy } = fixture();
  for (const mode of ["estimate", "init"]) {
    for (const cart of ["not json", undefined, [], [{ quantity: 1 }], Array.from({ length: 21 }, () => item(1))]) {
      const { response, body } = await proxy(mode, cart);
      assert.equal(response.status, 400);
      assert.equal(body.enabled, false);
      assert.equal(body.require_valid_pin, true);
      assert.equal(body.cart_complete, false);
      assert.equal(body.estimated_date, undefined);
    }
    const unknown = await fixture([], { unknown: true }).proxy(mode, [item(999)]);
    assert.equal(unknown.response.status, 400);
    assert.equal(unknown.body.reason, "invalid_cart");
    assert.equal(unknown.body.require_valid_pin, true);
    const mismatch = await proxy(mode, [{ ...item(1), variantId: item(2).variantId }]);
    assert.equal(mismatch.response.status, 400);
    assert.equal(mismatch.body.reason, "invalid_cart");
    assert.equal(mismatch.body.require_valid_pin, true);
    const unavailable = await fixture([], { contextFailure: true }).proxy(mode, [item(1)]);
    assert.equal(unavailable.response.status, 503);
    assert.equal(unavailable.body.reason, "product_context_unavailable");
    assert.equal(unavailable.body.cart_complete, false);
    assert.equal(unavailable.body.require_valid_pin, true);
    assert.equal(unavailable.body.disable_add_to_cart, true);
  }
});

test("proxy general cart success returns general dates without shipping/location availability", async () => {
  const { proxy } = fixture([rule({ inventoryMode: "any", transitDays: 1 }), rule({ id: 2, targetValue: "2", inventoryMode: "any", transitDays: 10 })]);
  const { response, body } = await proxy("estimate", [item(1), item(2)], { targeted: "1" });
  assert.equal(response.status, 200);
  assert.equal(body.enabled, true);
  assert.equal(body.cart_complete, true);
  assert.equal(body.cart_items_checked, 2);
  assert.ok(body.estimated_date);
  assert.ok(body.estimated_date_max);
  assert.equal(body.available, undefined);
  assert.equal(body.fulfillment_location_id, undefined);
  const unmatched = await proxy("estimate", [item(1), item(3)], { targeted: "1" });
  assert.equal(unmatched.body.enabled, false);
  assert.equal(unmatched.body.estimated_date, undefined);
});
