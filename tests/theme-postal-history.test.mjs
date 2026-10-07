import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../extensions/pincode-checker/assets/delivery-theme-context.js", import.meta.url), "utf8");
const code = source.slice(source.indexOf("  const postalHistory ="), source.indexOf("  window.incodeThemeContext ="));
function fixture(blockStorage = false) {
  const stored = new Map();
  const node = () => ({ children: [], handlers: {}, addEventListener(event, handler) { this.handlers[event] = handler; }, append(...items) { this.children.push(...items); }, replaceChildren(fragment) { this.children = fragment.children; }, setAttribute(name, value) { this[name] = value; } });
  const root = { ...node(), id: "history-test" };
  const input = { ...node(), value: "" };
  const country = { ...node(), value: "IN" };
  const context = { root, input, country, document: { createElement: node, createDocumentFragment: node }, window: { localStorage: {
    getItem(key) { if (blockStorage) throw new Error("Blocked"); return stored.get(key) ?? null; },
    setItem(key, value) { if (blockStorage) throw new Error("Blocked"); stored.set(key, value); },
  } } };
  vm.runInNewContext(`${code}\nremember = postalHistory(root, input, country, {});`, context);
  return { ...context, stored, list: root.children[0], values: () => root.children[0].children.map((option) => option.value) };
}

test("typing a prefix suggests prior checked postal codes across reloads", () => {
  const history = fixture();
  history.remember("400001");
  history.remember("411001");
  history.input.value = "4";
  history.input.handlers.input();
  assert.deepEqual(history.values(), ["411001", "400001"]);
  history.input.value = "40";
  history.input.handlers.input();
  assert.deepEqual(history.values(), ["400001"]);
  assert.equal(history.input.list, history.list.id);
  assert.equal(JSON.parse(history.stored.get("incode:postal-history:IN")).length, 2);
});

test("suggestions are country-scoped and accept equivalent international spacing", () => {
  const history = fixture();
  history.remember("400001");
  history.country.value = "CA";
  history.country.handlers.change();
  assert.deepEqual(history.values(), []);
  history.remember("K1A 0B1");
  history.input.value = "k1a0";
  history.input.handlers.input();
  assert.deepEqual(history.values(), ["K1A 0B1"]);
  history.country.value = "IN";
  history.input.value = "4";
  history.country.handlers.change();
  assert.deepEqual(history.values(), ["400001"]);
});

test("history deduplicates, limits suggestions, and excludes old or malformed records", () => {
  const history = fixture();
  for (let i = 0; i < 12; i++) history.remember(String(400001 + i));
  history.remember("400010");
  assert.equal(history.values().length, 8);
  assert.equal(history.values()[0], "400010");
  history.stored.set("incode:postal-history:IN", JSON.stringify([{ code: "400001", at: Date.now() - 31 * 86400000 }, { code: "<script>", at: Date.now() }]));
  history.input.handlers.focus();
  assert.deepEqual(history.values(), []);
});

test("blocked or corrupted browser storage never prevents checking delivery", () => {
  const blocked = fixture(true);
  assert.doesNotThrow(() => blocked.remember("400001"));
  const corrupt = fixture();
  corrupt.stored.set("incode:postal-history:IN", "not JSON");
  assert.doesNotThrow(() => corrupt.input.handlers.focus());
  assert.deepEqual(corrupt.values(), []);
});
