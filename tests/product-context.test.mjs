import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveShopifyProductContexts,
  canonicalProductFor,
  canonicalBatchItems,
} from "../app/services/product-context.server.ts";
import { STANDARD_FEATURES } from "../app/services/plans.server.ts";
import { injectedServer } from "./helpers/injected-server.mjs";

const productId = "gid://shopify/Product/123";
const variantId = "gid://shopify/ProductVariant/456";
const product = {
  id: productId,
  vendor: "Shopify vendor",
  tags: ["authoritative"],
  collections: { nodes: [{ handle: "summer" }, {}], pageInfo: { hasNextPage: false } },
};
const mockAdmin = (nodes) => ({
  graphql: async () => Response.json({ data: { nodes } }),
});

test("resolves numeric and matching GIDs, deduplicates requests, and normalizes context", async () => {
  const resolved = await resolveShopifyProductContexts({
    graphql: async (query, options) => {
      assert.deepEqual(options.variables.ids, [productId, variantId]);
      assert.equal(query.match(/pageInfo \{ hasNextPage \}/g)?.length, 2);
      assert.equal(query.match(/collections\(first: 100\)/g)?.length, 2);
      return Response.json({ data: { nodes: [product, { id: variantId, product }, null] } });
    },
  }, [{ productId: " 123 ", variantId: "456" }, { productId, variantId }]);
  const canonical = { id: productId, vendor: product.vendor, tags: product.tags, collectionHandles: ["summer"] };
  assert.deepEqual(canonicalProductFor(resolved, "123", "456"), canonical);
  assert.deepEqual(canonicalProductFor(resolved, null, variantId), canonical);
  assert.equal(canonicalProductFor(resolved, "999", "456"), null);
  assert.equal(canonicalProductFor(resolved, "123", "999"), null);
});

test("rejects malformed IDs without salvaging digits or masking them with a valid paired ID", async () => {
  const resolved = await resolveShopifyProductContexts(mockAdmin([product, { id: variantId, product }]), [{ productId, variantId }]);
  const malformed = ["abc123", "12-3", "123.0", "-123", "1e3", "gid://shopify/Product/123abc", "gid://shopify/Product/123?x=1", variantId, "gid://other/Product/123"];
  for (const id of malformed) {
    const empty = await resolveShopifyProductContexts({ graphql: async () => assert.fail("Malformed IDs must not be queried") }, [{ productId: id }]);
    assert.equal(empty.products.size, 0);
    assert.equal(canonicalProductFor(resolved, id, "456"), null, id);
  }
  assert.equal(canonicalProductFor(resolved, "123", "abc456"), null);
  assert.equal(canonicalProductFor(resolved, "123", productId), null);
});

test("rejects a variant belonging to a different product", async () => {
  const resolved = await resolveShopifyProductContexts(mockAdmin([
    product,
    { id: variantId, product: { ...product, id: "gid://shopify/Product/789" } },
  ]), [{ productId, variantId }]);
  assert.equal(canonicalProductFor(resolved, productId, variantId), null);
});

test("canonical batch replaces client context and drops unverifiable products", async () => {
  const resolved = await resolveShopifyProductContexts(mockAdmin([product]), [{ productId }]);
  const item = { key: "card", productId: "123", productVendor: "spoofed", productTags: ["spoofed"], collectionHandles: ["spoofed"] };
  assert.deepEqual(canonicalBatchItems([item, { ...item, productId: "abc123" }, { ...item, productId: "999" }], resolved), [{
    ...item, productId, productVendor: product.vendor, productTags: product.tags, collectionHandles: ["summer"],
  }]);
  assert.equal(item.productVendor, "spoofed");
});

test("fails on truncated collections for both direct products and variant products", async () => {
  const truncated = { ...product, collections: { ...product.collections, pageInfo: { hasNextPage: true } } };
  for (const node of [truncated, { id: variantId, product: truncated }]) {
    await assert.rejects(resolveShopifyProductContexts(mockAdmin([node]), [{ productId, variantId }]), /exceeds 100 collections/);
  }
});

test("retains vendor limit, preserves all tags and tolerates missing optional context", async () => {
  const resolved = await resolveShopifyProductContexts(mockAdmin([
    { ...product, vendor: "v".repeat(101), tags: Array.from({ length: 101 }, (_, i) => i) },
    { id: "gid://shopify/Product/789" },
  ]), [{ productId }, { productId: "789" }]);
  assert.equal(resolved.products.get(productId).vendor.length, 100);
  assert.deepEqual(resolved.products.get(productId).tags, Array.from({ length: 101 }, (_, i) => String(i)));
  assert.equal(resolved.products.get(productId).tags[0], "0");
  assert.deepEqual(canonicalProductFor(resolved, "789"), { id: "gid://shopify/Product/789", vendor: "", tags: [], collectionHandles: [] });
});

test("tags beyond the first 100 enforce exclusions and PIN policy for direct products and variants", async () => {
  const shop = "tag-regression.myshopify.com";
  const tags = [...Array.from({ length: 249 }, (_, i) => `tag-${i}`), "no-delivery"];
  const authoritative = { ...product, tags };
  const target = {
    id: 1, shop, name: "Excluded tag", targetKind: "tag", targetValue: "no-delivery",
    inventoryMode: "any", enabled: true, excluded: true, requireValidPin: true, priority: 1,
  };
  const load = injectedServer({
    "app/db.server.ts": {
      deliverySetting: { findUnique: async () => null },
      deliveryTarget: { findMany: async () => [target] },
      postalCode: {
        findFirst: async () => ({ zoneId: null, serviceable: true, deliveryDays: 2, codAvailable: false }),
        findMany: async () => [],
      },
    },
  });
  const service = load("app/services/delivery-checker.server.ts");
  for (const input of [{ productId }, { variantId }]) {
    const admin = mockAdmin(input.variantId ? [{ id: variantId, product: authoritative }] : [authoritative]);
    const resolved = await resolveShopifyProductContexts(admin, [input]);
    const canonical = canonicalProductFor(resolved, input.productId, input.variantId);
    assert.deepEqual(canonical.tags, tags);
    assert.deepEqual(canonicalBatchItems([{ key: "card", productId }], resolved)[0].productTags, tags);
    const context = {
      shop, country: "US", postalCode: "10001", productId: canonical.id,
      variantId: input.variantId, productTags: canonical.tags, productVendor: canonical.vendor,
      collectionHandles: canonical.collectionHandles, admin,
      features: { ...STANDARD_FEATURES, analytics: false }, trackAnalytics: false,
    };
    const policy = await service.checkDeliveryPolicy(context);
    assert.equal(policy.matched_target, target.name);
    assert.equal(policy.require_valid_pin, true);
    assert.equal(policy.disable_add_to_cart, false);
    assert.equal(policy.reason, "target_excluded");
    const delivery = await service.checkDelivery(context);
    assert.equal(delivery.available, false);
    assert.equal(delivery.require_valid_pin, true);
    assert.equal(delivery.matched_target, target.name);
  }
});

test("excluded target preserves the configured Add-to-Cart and target PIN policy", async () => {
  const shop = "excluded-policy.myshopify.com";
  const target = {
    id: 1, shop, name: "Excluded product", targetKind: "product", targetValue: "123",
    inventoryMode: "any", enabled: true, excluded: true, requireValidPin: false, priority: 1,
  };
  const load = injectedServer({
    "app/db.server.ts": {
      deliverySetting: { findUnique: async () => ({ disableAddToCart: true, requireValidPin: true }) },
      deliveryTarget: { findMany: async () => [target] },
      postalCode: { findFirst: async () => ({ zoneId: null, serviceable: true, deliveryDays: 2, codAvailable: false }), findMany: async () => [] },
    },
  });
  const service = load("app/services/delivery-checker.server.ts");
  const result = await service.checkDeliveryPolicy({
    shop, country: "US", postalCode: "10001", productId: "123",
    features: { ...STANDARD_FEATURES, analytics: false }, trackAnalytics: false,
  });
  assert.equal(result.reason, "target_excluded");
  assert.equal(result.disable_add_to_cart, true);
  assert.equal(result.require_valid_pin, false);
});

test("preserves unavailable admin, context limits, HTTP and GraphQL failures", async () => {
  await assert.rejects(resolveShopifyProductContexts(undefined, []), /unavailable/);
  const noQuery = { graphql: async () => assert.fail("No query expected") };
  assert.equal((await resolveShopifyProductContexts(noQuery, [])).products.size, 0);
  await assert.rejects(resolveShopifyProductContexts(noQuery, Array.from({ length: 51 }, (_, i) => ({ productId: String(i) }))), RangeError);
  await assert.rejects(resolveShopifyProductContexts({ graphql: async () => new Response(null, { status: 503 }) }, [{ productId }]), /HTTP 503/);
  await assert.rejects(resolveShopifyProductContexts({ graphql: async () => Response.json({ errors: [{ message: "Denied" }] }) }, [{ productId }]), /Denied/);
});
