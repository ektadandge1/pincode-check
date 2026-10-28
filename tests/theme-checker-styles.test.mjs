import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liquid = readFileSync(new URL("../extensions/pincode-checker/blocks/delivery-checker.liquid", import.meta.url), "utf8");
const css = readFileSync(new URL("../extensions/pincode-checker/assets/delivery-checker.css", import.meta.url), "utf8");

test("Shopify loads Delivery checker styles through its app-block schema", () => {
  const schema = JSON.parse(liquid.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  assert.equal(schema.stylesheet, "delivery-checker.css");
  assert.match(css, /\.pin-checker \.pin-checker__label\s*\{[\s\S]*?clip: rect/);
  assert.match(css, /\.pin-checker \.pin-checker__button\s*\{[\s\S]*?width: 100%/);
});

test("root sizing cannot collapse in intrinsically sized theme sections", () => {
  const root = css.match(/\.pin-checker\s*\{([\s\S]*?)\}/)[1];
  assert.match(root, /display: block/);
  assert.match(root, /width: 100%/);
  assert.match(root, /max-width: 760px/);
  assert.match(root, /flex: 1 1 100%/);
  assert.match(root, /overflow-wrap: break-word/);
  assert.doesNotMatch(root, /container-type|overflow-wrap:\s*anywhere|width:\s*min\(/);
  assert.match(css, /@media \(max-width: 300px\)\s*\{\s*\.pin-checker \.pin-checker__row \{ grid-template-columns: minmax\(0, 1fr\)/);
});
