import assert from "node:assert/strict";
import test from "node:test";
import { BULK_RULE_FIELDS, parseZoneRulePatch } from "../app/utils/zone-rule-edit.ts";

function form(values, apply = Object.keys(values)) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, String(value));
  for (const key of apply) data.set(`apply_${key}`, "true");
  return data;
}

test("bulk updates only supported, explicitly applied fields", () => {
  assert.deepEqual(BULK_RULE_FIELDS, ["deliveryDays", "serviceable", "city", "state"]);
  const legacy = { codAvailable: "true", deliveryCharge: "invalid", currency: "invalid", sameDayAvailable: "true", nextDayAvailable: "true", expressAvailable: "true", shop: "other" };
  assert.deepEqual(parseZoneRulePatch(form({ ...legacy, deliveryDays: "0", serviceable: "false" })), { deliveryDays: 0, serviceable: false });
  assert.throws(() => parseZoneRulePatch(form(legacy)), /at least one field/);
});

test("bulk updates reject empty patches and invalid ETA days", () => {
  assert.throws(() => parseZoneRulePatch(form({ deliveryDays: "2" }, [])), /at least one field/);
  for (const value of ["0", "60"]) assert.equal(parseZoneRulePatch(form({ deliveryDays: value })).deliveryDays, Number(value));
  for (const value of ["", "-1", "61", "1.5", "NaN", "Infinity", "text"]) {
    assert.throws(() => parseZoneRulePatch(form({ deliveryDays: value })), /between 0 and 60/);
  }
});

test("city and state remain nullable and serviceability stays strictly boolean", () => {
  assert.deepEqual(parseZoneRulePatch(form({ city: "", state: " " })), { city: null, state: null });
  assert.deepEqual(parseZoneRulePatch(form({ city: " Boston ", state: " MA " })), { city: "Boston", state: "MA" });
  for (const value of ["true", "false"]) assert.deepEqual(parseZoneRulePatch(form({ serviceable: value })), { serviceable: value === "true" });
  assert.throws(() => parseZoneRulePatch(form({ serviceable: "" })), /Choose Yes or No/);
});
