import test from "node:test";
import assert from "node:assert/strict";
import { compactCollectionName } from "../app/utils/target-display.ts";

test("collection handles display at most three readable words", () => {
  assert.equal(
    compactCollectionName("the-perfect-blend-of-style-and-functionality-tote-bag-with-zipper"),
    "the perfect blend",
  );
  assert.equal(compactCollectionName("summer_sale"), "summer sale");
  assert.equal(compactCollectionName(" featured "), "featured");
});
