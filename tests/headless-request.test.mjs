import assert from "node:assert/strict";
import test from "node:test";
import { HeadlessRequestError, parseHeadlessDeliveryInput } from "../app/utils/headless-request.ts";

const valid = { country: "IN", postal_code: "110001" };

function rejects(body, code, estimate = false) {
  assert.throws(() => parseHeadlessDeliveryInput(body, estimate), (error) => {
    assert.ok(error instanceof HeadlessRequestError);
    assert.equal(error.code, code);
    assert.equal(error.status, 400);
    assert.ok(error.message.length > 0);
    return true;
  });
}

test("normalizes country and postal code and supplies optional defaults without mutating input", () => {
  const body = Object.freeze({ country: "iN", postal_code: " 110001 " });
  assert.deepEqual(parseHeadlessDeliveryInput(body), {
    country: "IN", postalCode: "110001", productId: undefined, variantId: undefined,
    quantity: 1, codRequested: false,
  });
  assert.deepEqual(body, { country: "iN", postal_code: " 110001 " });
});

test("accepts numeric string IDs and matching Shopify GIDs without rewriting them", () => {
  for (const [productId, variantId] of [
    ["123", "456"],
    ["gid://shopify/Product/123", "gid://shopify/ProductVariant/456"],
    ["123", "gid://shopify/ProductVariant/456"],
    ["0", "000456"],
  ]) {
    assert.deepEqual(parseHeadlessDeliveryInput({ ...valid, product_id: productId, variant_id: variantId, quantity: 2, cod_requested: true }), {
      country: "IN", postalCode: "110001", productId, variantId, quantity: 2, codRequested: true,
    });
  }
  assert.equal(parseHeadlessDeliveryInput({ ...valid, variant_id: "456" }).variantId, "456");
  assert.equal(parseHeadlessDeliveryInput({ ...valid, product_id: "123" }).productId, "123");
});

test("rejects malformed, non-string, and wrong-resource IDs even with a valid paired ID", () => {
  for (const [field, other, kind, wrongKind] of [
    ["product_id", "variant_id", "Product", "ProductVariant"],
    ["variant_id", "product_id", "ProductVariant", "Product"],
  ]) {
    for (const id of [
      null, 123, true, {}, [], "", " 123", "123 ", "abc123", "12-3", "123.0", "-123", "+123", "1e3",
      `gid://shopify/${wrongKind}/123`, `gid://other/${kind}/123`,
      `gid://shopify/${kind}/123abc`, `gid://shopify/${kind}/123?x=1`,
      `gid://shopify/${kind}/123/`, `gid://shopify/${kind.toLowerCase()}/123`,
    ]) rejects({ ...valid, [field]: id, [other]: "456" }, "invalid_product_context");
  }
});

test("accepts integer quantity boundaries and defaults missing quantity to one", () => {
  for (const quantity of [1, 2, 999]) {
    assert.equal(parseHeadlessDeliveryInput({ ...valid, quantity }).quantity, quantity);
  }
  for (const quantity of [undefined]) {
    assert.equal(parseHeadlessDeliveryInput({ ...valid, quantity }).quantity, 1);
  }
});

test("rejects invalid quantities without coercion or rounding", () => {
  for (const quantity of [null, 0, -1, 1000, 1.5, NaN, Infinity, -Infinity, "1", "", true, false, [], {}]) {
    rejects({ ...valid, quantity }, "invalid_quantity");
  }
});

test("requires actual booleans for cod_requested", () => {
  for (const codRequested of [true, false, undefined]) {
    assert.equal(parseHeadlessDeliveryInput({ ...valid, cod_requested: codRequested }).codRequested, codRequested === true);
  }
  for (const codRequested of [null, "true", "false", "", 0, 1, [], {}]) {
    rejects({ ...valid, cod_requested: codRequested }, "invalid_request");
  }
});

test("rejects non-object JSON shapes and objects missing required fields", () => {
  for (const body of [undefined, null, false, true, 0, 1, "", "{}", [], [valid]]) {
    rejects(body, "invalid_request");
  }
  rejects({}, "invalid_country");
  rejects({ postal_code: "110001" }, "invalid_country");
  rejects({ country: "IN" }, "invalid_postal_code");
});

test("rejects unknown fields including caller-supplied product metadata", () => {
  for (const field of ["shop", "productId", "postalCode", "product_vendor", "product_tags", "collection_handles", "items", "extra", "constructor"]) {
    rejects({ ...valid, [field]: "untrusted" }, "invalid_request");
    rejects({ country: "IN", [field]: undefined }, "invalid_request", true);
  }
  rejects(JSON.parse('{"country":"IN","postal_code":"110001","__proto__":{}}'), "invalid_request");
});

test("requires exactly two ASCII country letters without trimming or coercion", () => {
  for (const country of [undefined, null, 12, true, [], {}, "", "I", "IND", " IN", "IN ", "I1", "12", "\u00e9N", "IN\n"]) {
    rejects({ ...valid, country }, "invalid_country");
    rejects({ country }, "invalid_country", true);
  }
  rejects({ ...valid, country: "zz" }, "invalid_country");
});

test("requires a nonblank postal string of at most 30 raw characters for checks", () => {
  for (const postalCode of [undefined, null, 110001, true, [], {}, "", " \t\n", "1".repeat(31), ` ${"1".repeat(29)} `]) {
    rejects({ ...valid, postal_code: postalCode }, "invalid_postal_code");
  }
  assert.equal(parseHeadlessDeliveryInput({ ...valid, postal_code: "1".repeat(30) }).postalCode, "1".repeat(30));
  assert.equal(parseHeadlessDeliveryInput({ ...valid, postal_code: "not-a-postcode" }).postalCode, "not-a-postcode");
});

test("estimate mode permits missing postal values but validates supplied fields", () => {
  assert.deepEqual(parseHeadlessDeliveryInput({ country: "us" }, true), {
    country: "US", postalCode: undefined, productId: undefined, variantId: undefined,
    quantity: 1, codRequested: false,
  });
  for (const postalCode of [null, 123, true, [], {}, "x".repeat(31)]) {
    rejects({ country: "US", postal_code: postalCode }, "invalid_postal_code", true);
  }
  for (const postalCode of ["", "   ", " 90210 "]) {
    assert.equal(parseHeadlessDeliveryInput({ country: "US", postal_code: postalCode }, true).postalCode, postalCode.trim());
  }
  rejects({ country: "US", product_id: "bad" }, "invalid_product_context", true);
  rejects({ country: "US", quantity: 0 }, "invalid_quantity", true);
  rejects({ country: "US", cod_requested: "true" }, "invalid_request", true);
});

test("request errors preserve their message, code, and optional HTTP status", () => {
  const error = new HeadlessRequestError("body_too_large", "Maximum body size is 64 KiB.", 413);
  assert.ok(error instanceof Error);
  assert.equal(error.code, "body_too_large");
  assert.equal(error.message, "Maximum body size is 64 KiB.");
  assert.equal(error.status, 413);
  assert.equal(new HeadlessRequestError("invalid_request", "Invalid input.").status, 400);
});
