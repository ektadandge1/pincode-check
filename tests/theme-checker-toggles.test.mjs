import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("COD toggle hides the badge when off and shows true and false status when on", () => {
  const code = script.slice(script.indexOf("      const renderShippingOptions ="), script.indexOf("    const renderMethodSelection ="));
  const node = () => ({ dataset: {}, children: [], setAttribute() {}, append(...items) { this.children.push(...items); } });
  for (const cod of [true, false]) {
    for (const available of [true, false]) {
      const options = { replaceChildren(fragment) { this.children = fragment.children; this.childElementCount = this.children.length; } };
      const root = { dataset: { codLabel: "COD", availableLabel: "Available", unavailableLabel: "Prepaid only" } };
      vm.runInNewContext(`${code}\nrenderShippingOptions({ cod_available: ${available} });`, { cod, options, root, document: { createDocumentFragment: node, createElement: node } });
      assert.equal(options.childElementCount, cod ? 1 : 0);
      if (cod) assert.equal(options.children[0].children[2].textContent, available ? "Available" : "Prepaid only");
    }
  }
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
  const fields = { showSameDay: "same_day_available", showNextDay: "next_day_available", showExpress: "express_available", showLocal: "local_delivery_available", showPickup: "pickup_available" };
  for (const disabled of ["showServiceBadges", ...Object.keys(fields)]) {
    const options = { replaceChildren(fragment) { this.children = fragment?.children ?? []; this.childElementCount = this.children.length; } };
    const root = { dataset: { [disabled]: "false" } };
    const data = Object.fromEntries(Object.values(fields).map((field) => [field, true]));
    vm.runInNewContext(`${code}\nrenderShippingOptions(data);`, { root, options, data, cod: false, document: { createDocumentFragment: node, createElement: node } });
    assert.equal(options.childElementCount, disabled === "showServiceBadges" ? 0 : 4);
    if (disabled === "showServiceBadges") assert.equal(options.hidden, true);
  }
  const schema = JSON.parse(liquid.match(/{% schema %}([\s\S]*?){% endschema %}/)[1]);
  for (const id of ["show_service_badges", "show_same_day", "show_next_day", "show_express", "show_local", "show_pickup"]) {
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
