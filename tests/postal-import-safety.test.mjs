import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../app/utils/csv.server.ts";
import {
  parsePostalImportOptions,
  validateImportCurrency,
  importErrorCsvValue,
} from "../app/utils/postal-import.ts";

test("minimal and blank CSV options preserve existing fields", () => {
  const existing = {
    serviceable: false, codAvailable: true, sameDayAvailable: true,
    nextDayAvailable: true, expressAvailable: true, deliveryCharge: 12,
    currency: "USD", city: "New York", state: "NY", zone: "East",
  };
  for (const row of [
    parseCsv("country,postal_code,delivery_days\nUS,10001,0")[0],
    Object.fromEntries([
      "serviceable", "cod_available", "same_day", "next_day", "express",
      "delivery_charge", "currency", "city", "state", "zone",
    ].map((key) => [key, "  "])),
  ]) {
    const patch = parsePostalImportOptions(row);
    assert.deepEqual(patch, {});
    assert.deepEqual({ ...existing, ...patch }, existing);
    validateImportCurrency(patch, existing);
  }
});

test("explicit false and zero are updates, including aliases", () => {
  assert.deepEqual(parsePostalImportOptions({
    serviceable: "0", codavailable: "false", sameday: "no",
    nextday: "off", expressavailable: "n", deliverycharge: "0",
    currency: "usd", city: " Boston ", state: "MA", zone: " North ",
  }), {
    serviceable: false, codAvailable: false, sameDayAvailable: false,
    nextDayAvailable: false, expressAvailable: false, deliveryCharge: 0,
    currency: "USD", city: "Boston", state: "MA", zone: "North",
  });
  assert.deepEqual(parsePostalImportOptions({ delivery_charge: "", deliverycharge: "0" }), {
    deliveryCharge: 0,
  });
});

test("invalid optional values fail rather than being treated as blank", () => {
  for (const row of [
    { serviceable: "maybe" }, { delivery_charge: "-1" },
    { delivery_charge: "Infinity" }, { delivery_charge: "abc" },
    { currency: "US" }, { currency: "123" }, { zone: "x".repeat(61) },
  ]) assert.throws(() => parsePostalImportOptions(row));
});

test("charge and currency validation uses the effective pair on updates", () => {
  const existing = { deliveryCharge: 10, currency: "USD" };
  validateImportCurrency({ deliveryCharge: 0 }, existing);
  validateImportCurrency({ currency: "EUR" }, existing);
  validateImportCurrency({ deliveryCharge: 0, currency: "USD" }, null);
  validateImportCurrency({}, null);
  assert.throws(() => validateImportCurrency({ deliveryCharge: 0 }, null), /Currency is required/);
  validateImportCurrency({ currency: "USD" }, null);
  assert.throws(() => validateImportCurrency({}, { deliveryCharge: 10, currency: null }), /Currency is required/);
  validateImportCurrency({ currency: "USD" }, { deliveryCharge: null, currency: null });
});

test("minimal and blank money cells preserve historical currency-only records", () => {
  const existing = { deliveryCharge: null, currency: "USD" };
  for (const csv of [
    "country,postal_code,delivery_days\nUS,10001,3",
    "country,postal_code,delivery_days,delivery_charge,currency\nUS,10001,3, , ",
  ]) {
    const patch = parsePostalImportOptions(parseCsv(csv)[0]);
    validateImportCurrency(patch, existing);
    assert.deepEqual({ ...existing, ...patch }, existing);
  }
  validateImportCurrency({ deliveryCharge: 0 }, existing);
});

test("error CSV neutralizes formulas, including whitespace and control prefixes", () => {
  for (const value of ["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "  =1", "\t=1", "\r=1", "\n=1", "\u0000=1"]) {
    const encoded = importErrorCsvValue(value);
    const decoded = encoded.startsWith('"') ? encoded.slice(1, -1).replace(/""/g, '"') : encoded;
    assert.equal(decoded, `'${value}`);
  }
  assert.equal(importErrorCsvValue('=HYPERLINK("https://example.com","click")'), '"\'=HYPERLINK(""https://example.com"",""click"")"');
});

test("error CSV retains normal quoting and harmless values", () => {
  assert.equal(importErrorCsvValue(null), "");
  assert.equal(importErrorCsvValue(2), "2");
  assert.equal(importErrorCsvValue("Validation failed."), "Validation failed.");
  assert.equal(importErrorCsvValue('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(importErrorCsvValue('{"city":"=1"}'), '"{""city"":""=1""}"');
});
