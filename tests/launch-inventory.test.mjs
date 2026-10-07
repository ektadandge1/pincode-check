import assert from "node:assert/strict";
import test from "node:test";
import { checkVariantInventory } from "../app/utils/variant-inventory.ts";

const variant = {
  sellableOnlineQuantity: 5,
  inventoryPolicy: "CONTINUE",
  inventoryItem: { inventoryLevels: {
    pageInfo: { hasNextPage: false },
    nodes: [{ location: { id: "a", isActive: true, fulfillsOnlineOrders: true }, quantities: [{ name: "available", quantity: 5 }] }],
  } },
};
const adminFor = (body, status = 200) => ({ graphql: async () => Response.json(body, { status }) });

test("inventory query requests active/online eligibility and completeness", async () => {
  const result = await checkVariantInventory({ graphql: async (query, options) => {
    assert.match(query, /isActive fulfillsOnlineOrders/);
    assert.match(query, /pageInfo \{ hasNextPage \}/);
    assert.equal(options.variables.id, "gid://shopify/ProductVariant/1");
    return Response.json({ data: { productVariant: variant } });
  } }, "gid://shopify/ProductVariant/1");
  assert.deepEqual(result, { sellableQuantity: 5, continueSelling: true, levels: [{ locationId: "a", available: 5, active: true, fulfillsOnlineOrders: true }] });
});

test("inventory failures, partial GraphQL data and truncated levels fail closed", async () => {
  for (const body of [
    {},
    { data: { productVariant: null } },
    { data: { productVariant: variant }, errors: [{ message: "Access denied" }] },
    { data: { productVariant: { ...variant, inventoryItem: { inventoryLevels: { ...variant.inventoryItem.inventoryLevels, pageInfo: { hasNextPage: true } } } } } },
    { data: { productVariant: { ...variant, sellableOnlineQuantity: null } } },
    { data: { productVariant: { ...variant, inventoryItem: { inventoryLevels: { pageInfo: { hasNextPage: false }, nodes: [{}] } } } } },
  ]) assert.equal(await checkVariantInventory(adminFor(body), "1"), null);
  assert.equal(await checkVariantInventory(adminFor({}, 500), "1"), null);
  assert.equal(await checkVariantInventory({ graphql: async () => { throw new Error("network"); } }, "1"), null);
  assert.equal(await checkVariantInventory({ graphql: async () => new Response("invalid json") }, "1"), null);
  assert.equal(await checkVariantInventory(undefined, "1"), null);
});
