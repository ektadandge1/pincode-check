import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { countdownVisible } from "../app/utils/countdown-visibility.ts";

const liquid = readFileSync(new URL("../extensions/pincode-checker/blocks/delivery-checker.liquid", import.meta.url), "utf8");
const script = liquid.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const settings = { countdownEnabled: false, countdownDisplaySurfacesCsv: "product,cart", countdownTargetMode: "all", countdownProductIdsCsv: "", countdownCollectionHandlesCsv: "", countdownZoneIdsCsv: "" };

test("block countdown opt-in overrides global enable but preserves surface and targeting rules", () => {
  assert.equal(countdownVisible(settings, {}, "product"), false);
  assert.equal(countdownVisible(settings, {}, "product", true), true);
  assert.equal(countdownVisible({ ...settings, countdownEnabled: true }, {}, "product", false), false);
  assert.equal(countdownVisible(settings, {}, "collection", true), false);
  assert.equal(countdownVisible({ ...settings, countdownTargetMode: "products", countdownProductIdsCsv: "42" }, { productId: "43" }, "product", true), false);
  assert.equal(countdownVisible({ ...settings, countdownTargetMode: "products", countdownProductIdsCsv: "42" }, { productId: "42" }, "product", true), true);
});

test("shared appearance does not overwrite Theme Editor countdown control", () => {
  const code = script.slice(script.indexOf("    const applyStorefrontStyle ="), script.indexOf("    const productContextParams ="));
  for (const enabled of ["true", "false"]) {
    const root = { dataset: { appearanceSource: "shop", showCountdown: enabled }, style: { setProperty() {} }, querySelector: () => null };
    vm.runInNewContext(`${code}\napplyStorefrontStyle({ show_countdown: ${enabled !== "true"} });`, { root, fonts: {} });
    assert.equal(root.dataset.showCountdown, enabled);
  }
  assert.match(script, /params\.set\('countdown', root\.dataset\.showCountdown === 'true' \? '1' : '0'\)/);
});

test("persisted premium and COD switches cannot revive removed badges", () => {
  const code = script.slice(script.indexOf("      const renderShippingOptions ="), script.indexOf("    const renderMethodSelection ="));
  const node = () => ({ dataset: {}, children: [], setAttribute() {}, append(...items) { this.children.push(...items); } });
  for (const enabled of ["true", "false"]) {
    for (const available of [true, false]) {
      const options = { replaceChildren(fragment) { this.children = fragment.children; this.childElementCount = this.children.length; } };
      const root = { dataset: { cod: enabled, showSameDay: enabled, showNextDay: enabled, showExpress: enabled, localDeliveryLabel: "Local delivery", pickupLabel: "Store pickup" } };
      const data = { cod_available: available, same_day_available: available, next_day_available: available, express_available: available, delivery_charge: 25, currency: "USD", local_delivery_available: true, pickup_available: true };
      vm.runInNewContext(`${code}\nrenderShippingOptions(data);`, { data, options, root, document: { createDocumentFragment: node, createElement: node } });
      assert.equal(options.childElementCount, 2);
      assert.deepEqual(options.children.map((item) => item.children[1].textContent), ["Local delivery", "Store pickup"]);
    }
  }
});

test("shared appearance ignores persisted removed feature switches", () => {
  const code = script.slice(script.indexOf("    const applyStorefrontStyle ="), script.indexOf("    const productContextParams ="));
  const root = { dataset: { appearanceSource: "shop" }, style: { setProperty() {} }, querySelector: () => null };
  vm.runInNewContext(`${code}\napplyStorefrontStyle({ cod_enabled: true, show_same_day: true, show_next_day: true, show_express: true, show_charge: true, currency: 'USD' });`, { root });
  for (const key of ["cod", "showSameDay", "showNextDay", "showExpress", "showCharge", "currency"]) {
    assert.equal(root.dataset[key], undefined);
  }
});

test("all extension sources, schemas, and locales omit removed feature references", () => {
  const base = new URL("../extensions/", import.meta.url);
  const removed = /\b(?:cod|cod_enabled|cod_available|cod_message|cod_requested|delivery_charge(?:_message)?|deliveryCharge|currency|same[_ -]day(?:_available)?|next[_ -]day(?:_available)?|express(?:_available)?|show_same_day|show_next_day|show_express|prepaid)\b/i;
  for (const path of readdirSync(base, { recursive: true })) {
    if (!/\.(?:liquid|js|jsx|json|css|md|toml)$/.test(path)) continue;
    const source = readFileSync(new URL(path, base), "utf8");
    assert.doesNotMatch(source, removed, path);
    if (path.endsWith(".json")) JSON.parse(source);
    if (path.endsWith(".liquid")) JSON.parse(source.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  }
});

test("normal shipping method selection still updates the journey and persisted ETA", () => {
  const code = script.slice(script.indexOf("    const renderMethodSelection ="), script.indexOf("    const renderCountdown ="));
  const node = () => ({ children: [], append(...items) { this.children.push(...items); }, addEventListener(name, handler) { this[name] = handler; } });
  const methodControls = node();
  const methods = { hidden: true };
  const methodSummary = {};
  const selected = [];
  const persisted = [];
  const root = { dataset: { methodSelectLabel: "Shipping method", methodDeliveryBy: "Delivery by", methodDispatchLabel: "Dispatch", methodDeliveryLabel: "Delivery" } };
  const data = { country: "US", postal_code: "10001", shipping_method_display_style: "dropdown", shipping_methods: [{ handle: "standard", name: "Standard shipping", dispatch_date: "2026-10-12", estimated_date: "2026-10-15" }] };
  vm.runInNewContext(`${code}\nrenderMethodSelection(data);`, {
    root, data, requestVersion: 1, disposed: false, id: "test", eventOptions: {},
    methodControls, methods, methodSummary, document: { createElement: node },
    formatJourneyDate: (date) => date, renderJourney: (estimate) => selected.push(estimate),
    setResult: (message, state) => assert.equal(state, "success"),
    persistEstimate: async (estimate, country, postal) => { persisted.push({ estimate, country, postal }); },
  });
  assert.equal(methods.hidden, false);
  const select = methodControls.children[1];
  assert.equal(select.children[1].value, "standard");
  select.value = "standard";
  select.change();
  assert.equal(selected.length, 1);
  assert.equal(selected[0].estimated_date, "2026-10-15");
  assert.equal(persisted[0].estimate.estimated_date, "2026-10-15");
  assert.equal(persisted[0].country, "US");
  assert.equal(persisted[0].postal, "10001");
  assert.match(methodSummary.textContent, /Standard shipping/);
});

test("countdown uses a live timer before cutoff and an expired status after cutoff", () => {
  const code = script.slice(script.indexOf("    const renderCountdown ="), script.indexOf("     const renderDetails ="));
  for (const enabled of ["true", "false"]) {
    for (const future of [true, false]) {
      const countdown = { hidden: true, dataset: {}, querySelector: () => null };
      const context = {
        root: { dataset: { showCountdown: enabled, countdownVisible: "true" } }, countdown,
        countdownLabel: {}, countdownValue: {}, countdownTimer: null,
        window: { incodeThemeContext: { cutoffTime: () => Date.now() + (future ? 60000 : -1) }, setInterval: () => 1, clearInterval() {} },
      };
      vm.runInNewContext(`${code}\nrenderCountdown({});`, context);
      assert.equal(countdown.hidden, enabled !== "true");
      if (enabled === "true") assert.equal(countdown.dataset.state, future ? "running" : "expired");
    }
  }
});

test("the checker never renders sample countdowns or internal diagnostic text", () => {
  assert.doesNotMatch(liquid, /data-countdown-preview|data-preview-note|No live timer:|Countdown preview/);
});

test("Theme Editor service switches hide all badges or individual real service badges", () => {
  const code = script.slice(script.indexOf("      const renderShippingOptions ="), script.indexOf("    const renderMethodSelection ="));
  const node = () => ({ dataset: {}, children: [], setAttribute() {}, append(...items) { this.children.push(...items); } });
  const fields = { showLocal: "local_delivery_available", showPickup: "pickup_available" };
  for (const disabled of ["showServiceBadges", ...Object.keys(fields)]) {
    const options = { replaceChildren(fragment) { this.children = fragment?.children ?? []; this.childElementCount = this.children.length; } };
    const root = { dataset: { [disabled]: "false" } };
    const data = Object.fromEntries(Object.values(fields).map((field) => [field, true]));
    vm.runInNewContext(`${code}\nrenderShippingOptions(data);`, { root, options, data, document: { createDocumentFragment: node, createElement: node } });
    assert.equal(options.childElementCount, disabled === "showServiceBadges" ? 0 : 1);
    if (disabled === "showServiceBadges") assert.equal(options.hidden, true);
  }
  const schema = JSON.parse(liquid.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  for (const id of ["show_service_badges", "show_local", "show_pickup"]) {
    assert.equal(schema.settings.find((setting) => setting.id === id)?.default, true);
  }
});

test("real zero cutoff seconds produce an expired timestamp, not a missing cutoff", () => {
  const helper = readFileSync(new URL("../extensions/pincode-checker/assets/delivery-theme-context.js", import.meta.url), "utf8");
  const code = helper.slice(helper.indexOf("  const cutoffTime ="), helper.indexOf("  const expiryDelay ="));
  const context = {};
  vm.runInNewContext(`${code}\nresult = cutoffTime({ seconds_until_cutoff: 0 }); missing = cutoffTime({});`, context);
  assert.ok(Number.isFinite(context.result));
  assert.ok(Number.isNaN(context.missing));
});
