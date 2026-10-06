import assert from "node:assert/strict";
import test from "node:test";
import { BULK_RULE_FIELDS, parseZoneRulePatch, validatePatchedRule } from "../app/utils/zone-rule-edit.ts";

function form(values, apply = Object.keys(values)) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, String(value));
  for (const key of apply) data.set(`apply_${key}`, "true");
  return data;
}

test("bulk updates change only explicitly applied fields, including false and zero", () => {
  const data = form({ deliveryDays: "0", serviceable: "false", codAvailable: "true", currency: "invalid" }, ["deliveryDays", "serviceable"]);
  data.set("shop", "other-shop");
  data.set("zoneId", "999");
  data.set("postalCode", "12345");
  data.set("apply_shop", "true");
  assert.deepEqual(parseZoneRulePatch(data), { deliveryDays: 0, serviceable: false });
  data.set("apply_codAvailable", "on");
  assert.deepEqual(parseZoneRulePatch(data), { deliveryDays: 0, serviceable: false });
});

test("bulk updates reject an empty patch", () => {
  assert.throws(() => parseZoneRulePatch(form({ deliveryDays: "2" }, [])), /at least one field/);
});

test("transit days use existing integer bounds from zero to sixty", () => {
  for (const value of ["0", "60"]) assert.equal(parseZoneRulePatch(form({ deliveryDays: value })).deliveryDays, Number(value));
  for (const value of ["", "-1", "61", "1.5", "NaN", "Infinity", "text"]) {
    assert.throws(() => parseZoneRulePatch(form({ deliveryDays: value })), /between 0 and 60/);
  }
});

test("charge accepts zero and fractions, rejects negative and nonfinite values", () => {
  for (const value of ["0", "2.25"]) assert.equal(parseZoneRulePatch(form({ deliveryCharge: value })).deliveryCharge, Number(value));
  for (const value of ["-1", "NaN", "Infinity", "text"]) {
    assert.throws(() => parseZoneRulePatch(form({ deliveryCharge: value })), /positive amount/);
  }
});

test("applied blank nullable fields clear values and currency normalizes", () => {
  assert.deepEqual(parseZoneRulePatch(form({ deliveryCharge: "", currency: " ", city: "", state: " " })), {
    deliveryCharge: null, currency: null, city: null, state: null,
  });
  assert.deepEqual(parseZoneRulePatch(form({ currency: " usd ", city: " New York ", state: " NY " })), {
    currency: "USD", city: "New York", state: "NY",
  });
  for (const currency of ["US", "USDD", "123", "U$D"]) {
    assert.throws(() => parseZoneRulePatch(form({ currency })), /3-letter/);
  }
});

test("all availability and COD options allow explicit true or false only", () => {
  for (const key of ["serviceable", "codAvailable", "sameDayAvailable", "nextDayAvailable", "expressAvailable"]) {
    for (const value of ["true", "false"]) assert.deepEqual(parseZoneRulePatch(form({ [key]: value })), { [key]: value === "true" });
    assert.throws(() => parseZoneRulePatch(form({ [key]: "" })), /Choose Yes or No/);
  }
  assert.equal(BULK_RULE_FIELDS.length, 10);
});

test("charge and currency validate the resulting values of every selected rule", () => {
  const usdRule = { deliveryCharge: 5, currency: "USD" };
  const noCurrencyRule = { deliveryCharge: null, currency: null };
  assert.doesNotThrow(() => validatePatchedRule(usdRule, { deliveryCharge: 0 }));
  assert.throws(() => validatePatchedRule(noCurrencyRule, { deliveryCharge: 0 }), /Apply a currency too/);
  assert.doesNotThrow(() => validatePatchedRule(noCurrencyRule, { deliveryCharge: 2.5, currency: "USD" }));
  assert.throws(() => validatePatchedRule(usdRule, { currency: null }), /clear the charge/);
  assert.doesNotThrow(() => validatePatchedRule(usdRule, { deliveryCharge: null, currency: null }));
  assert.doesNotThrow(() => validatePatchedRule(usdRule, { serviceable: false }));
  assert.deepEqual(usdRule, { deliveryCharge: 5, currency: "USD" });
});
