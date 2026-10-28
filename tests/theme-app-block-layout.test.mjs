import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const base = new URL("../extensions/pincode-checker/", import.meta.url);
const asset = (name) => readFileSync(new URL(`assets/${name}`, base), "utf8");
const block = (name) => readFileSync(new URL(`blocks/${name}`, base), "utf8");

const roots = [
  [asset("delivery-checker.css"), /\.pin-checker\s*\{([\s\S]*?)\}/, "delivery checker"],
  [asset("availability-checker.css"), /\.incode-availability\s*\{([\s\S]*?)\}/, "availability checker"],
  [asset("product-delivery-pickup.css"), /\.incode-product-service\s*\{([\s\S]*?)\}/, "product delivery and pickup"],
  [asset("delivery-service-options.css"), /\.incode-service-card\[id\]\s*\{([\s\S]*?)\}/, "service card"],
  [asset("delivery-service-options.css"), /\[data-template="service-tabs"\]\s*\{([^}]*)\}/, "service tabs"],
  [block("estimated-delivery-date.liquid"), /box-sizing:\s*border-box;([\s\S]*?)\n\s*\}/, "estimated delivery date"],
];

test("section app-block roots keep intrinsic width in flex and grid themes", () => {
  for (const [source, pattern, name] of roots) {
    const match = source.match(pattern);
    assert.ok(match, `${name} root styles`);
    const declarations = match[1];
    assert.match(declarations, /display:\s*block/, `${name} uses block layout`);
    assert.match(declarations, /width:\s*100%/, `${name} fills its theme block`);
    assert.match(declarations, /max-width:/, `${name} remains bounded`);
    assert.doesNotMatch(declarations, /container-type\s*:\s*inline-size/, `${name} does not suppress intrinsic width`);
    assert.doesNotMatch(declarations, /overflow-wrap\s*:\s*anywhere/, `${name} does not advertise one-character min-content width`);
  }
});

test("theme extension has no size-contained section block roots", () => {
  for (const file of [
    "delivery-checker.css",
    "availability-checker.css",
    "product-delivery-pickup.css",
    "delivery-service-options.css",
  ]) {
    assert.doesNotMatch(asset(file), /container-type\s*:\s*inline-size/, file);
  }
});
