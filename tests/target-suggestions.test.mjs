/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";

import { loadShopifyTargetSuggestions, loadShopifyTargetSuggestionsForKind } from "../app/services/shopify-target-suggestions.server.ts";

test("loads every Shopify target connection and normalizes suggestion values", async () => {
  const requested = [];
  const admin = { graphql: async (query, { variables }) => {
    const resource = ["products", "collections", "productVendors", "productTags"].find((name) => query.includes(`${name}(`));
    requested.push([resource, variables.after]);
    const first = variables.after === null;
    const nodes = resource === "products"
      ? first ? [{ id: "gid://shopify/Product/10", title: "Alpha", handle: "alpha" }] : [{ id: "gid://shopify/Product/20", title: "Beta", handle: "beta" }]
      : resource === "collections"
        ? [{ handle: "summer", title: "Summer" }]
        : resource === "productVendors"
          ? first ? ["Acme", " acme "] : ["Bravo"]
          : first ? ["Bulky", "bulky"] : ["Sale"];
    return Response.json({ data: { [resource]: {
      nodes,
      pageInfo: { hasNextPage: (resource === "products" || resource === "productVendors" || resource === "productTags") && first, endCursor: first ? `${resource}-2` : null },
    } } });
  } };

  const result = await loadShopifyTargetSuggestions(admin);
  assert.deepEqual(result.product.map((item) => item.value), ["10", "20"]);
  assert.deepEqual(result.collection, [{ label: "Summer · summer", value: "summer" }]);
  assert.deepEqual(result.vendor, [{ label: "Acme", value: "acme" }, { label: "Bravo", value: "bravo" }]);
  assert.deepEqual(result.tag, [{ label: "Bulky", value: "bulky" }, { label: "Sale", value: "sale" }]);
  assert.equal(requested.length, 7);
});

test("fails visibly when Shopify pagination does not advance", async () => {
  const admin = { graphql: async (query) => {
    const resource = ["products", "collections", "productVendors", "productTags"].find((name) => query.includes(`${name}(`));
    return Response.json({ data: { [resource]: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } });
  } };
  await assert.rejects(loadShopifyTargetSuggestions(admin), /pagination did not advance/);
});

test("loads only the requested target kind when validating a submitted rule", async () => {
  const requested = [];
  const admin = { graphql: async (query) => {
    const resource = ["products", "collections", "productVendors", "productTags"].find((name) => query.includes(`${name}(`));
    requested.push(resource);
    return Response.json({ data: { [resource]: {
      nodes: [" Acme "],
      pageInfo: { hasNextPage: false, endCursor: null },
    } } });
  } };

  assert.deepEqual(await loadShopifyTargetSuggestionsForKind(admin, "vendor"), [{ label: "Acme", value: "acme" }]);
  assert.deepEqual(requested, ["productVendors"]);
});
