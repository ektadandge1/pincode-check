import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRY_CODES, COUNTRY_OPTIONS } from "../app/utils/countries.ts";
import { parseHeadlessDeliveryInput } from "../app/utils/headless-request.ts";

import {
  matchesPostalPattern,
  matchesPostalPatternsCsv,
  normalizeCountryCode,
  normalizePostalCode,
  parsePostalPattern,
  postalCodeLookupValues,
  validatePostalCode,
} from "../app/utils/delivery.server.ts";

const optionalFormats = [
  ["CA", "K1A 0B1", "K1A0B1", "K1A 0*"],
  ["GB", "SW1A 1AA", "SW1A1AA", "SW1A 1*"],
  ["GB", "GIR 0AA", "GIR0AA", "GIR 0*"],
  ["NL", "1234 AB", "1234AB", "1234 A*"],
  ["JP", "123-4567", "1234567", "123-4*"],
  ["US", "10001-1234", "100011234", "10001-1*"],
];

for (const [country, canonical, compact, wildcard] of optionalFormats) {
  test(`${country} ${canonical}: equivalent separators preserve canonical and legacy exact coverage`, () => {
    for (const input of [canonical, compact, `  ${canonical.toLowerCase()}  `]) {
      assert.equal(normalizePostalCode(country, input), canonical);
      assert.equal(validatePostalCode(country, input), true);
      assert.deepEqual(postalCodeLookupValues(country, input), [canonical, compact]);
      for (const stored of [canonical, compact, canonical.toLowerCase()]) {
        const parsed = parsePostalPattern(country, stored);
        assert.deepEqual(parsed, { type: "exact", pattern: canonical });
        assert.equal(matchesPostalPattern(parsed, country, input), true);
        assert.equal(matchesPostalPattern({ type: "exact", pattern: stored }, country, input), true);
        assert.equal(matchesPostalPatternsCsv(country, input, stored), true);
      }
    }
    assert.equal(matchesPostalPatternsCsv(country, compact, canonical), true);
    assert.equal(matchesPostalPatternsCsv(country, canonical, compact), true);
  });

  test(`${country} ${canonical}: wildcard literals and values use equivalent separators`, () => {
    for (const pattern of [wildcard, wildcard.replace(/[ -]/g, ""), wildcard.toLowerCase()]) {
      const parsed = parsePostalPattern(country, pattern);
      assert.equal(parsed?.type, "wildcard");
      for (const value of [canonical, compact, canonical.toLowerCase()]) {
        assert.equal(matchesPostalPattern(parsed, country, value), true);
        assert.equal(matchesPostalPatternsCsv(country, value, pattern), true);
        // Matching must not depend on the regex originally persisted/constructed.
        assert.equal(matchesPostalPattern({ type: "wildcard", pattern, regex: /^never$/ }, country, value), true);
      }
      assert.equal(matchesPostalPattern(parsed, country, "999999999"), false);
    }
  });
}

test("numeric normalization removes whitespace, not letters or punctuation", () => {
  for (const [country, valid] of [
    ["IN", "400001"], ["AU", "2000"], ["DE", "10115"], ["ES", "28001"],
    ["FR", "75001"], ["IT", "00100"], ["NZ", "6011"],
  ]) {
    assert.equal(normalizePostalCode(country, `${valid.slice(0, 2)} \t${valid.slice(2)}`), valid);
    for (const invalid of [`${valid}A`, `A${valid}`, `${valid.slice(0, 2)}-${valid.slice(2)}`]) {
      assert.equal(normalizePostalCode(country, invalid), invalid);
      assert.equal(validatePostalCode(country, invalid), false);
      assert.equal(parsePostalPattern(country, invalid), null);
    }
    assert.equal(parsePostalPattern(country, `${valid}A - ${valid}`), null);
  }
});

test("generic explicit spaced numeric ranges take priority over generic exact codes", () => {
  const range = parsePostalPattern("BR", "10000 - 10999");
  assert.deepEqual(range, { type: "range", pattern: "10000 - 10999", start: "10000", end: "10999" });
  assert.deepEqual(parsePostalPattern("BR", range.pattern), range);
  for (const code of ["10000", "10015", "10999"]) {
    assert.equal(matchesPostalPattern(range, "BR", code), true);
  }
  for (const code of ["09999", "11000"]) {
    assert.equal(matchesPostalPattern(range, "BR", code), false);
  }
  assert.equal(parsePostalPattern("BR", "10999 - 10000"), null);
  assert.equal(parsePostalPattern("BR", "01000-000")?.type, "exact");
  assert.equal(parsePostalPattern("JP", "123-4567")?.type, "exact");
  assert.equal(parsePostalPattern("US", "10001-1234")?.type, "exact");
  assert.equal(parsePostalPattern("US", "10000 - 10999")?.type, "range");
  assert.equal(parsePostalPattern("JP", "123-0000 - 123-9999")?.type, "range");
  for (const [country, pattern] of [
    ["JP", "1230000-1239999"], ["US", "100011000-100019999"],
  ]) {
    const parsed = parsePostalPattern(country, pattern);
    assert.equal(parsed?.type, "range");
    assert.deepEqual(parsePostalPattern(country, parsed.pattern), parsed);
  }
});

test("lookup values are canonical-first, unique, and do not broaden ZIP+4 to ZIP", () => {
  assert.deepEqual(postalCodeLookupValues("US", "10001"), ["10001"]);
  assert.deepEqual(postalCodeLookupValues("IN", "400 001"), ["400001"]);
  assert.deepEqual(postalCodeLookupValues("BR", "01000-000"), ["01000-000"]);
  assert.deepEqual(postalCodeLookupValues("CA", "bad-code"), ["BAD-CODE"]);
  assert.deepEqual(postalCodeLookupValues("US", ""), []);
});

test("country normalization preserves invalid codes and aliases UK without changing the missing default", () => {
  assert.equal(normalizeCountryCode(" ca "), "CA");
  assert.equal(normalizeCountryCode(" uk "), "GB");
  assert.equal(normalizePostalCode("UK", "gir0aa"), "GIR 0AA");
  assert.deepEqual(postalCodeLookupValues("UK", "gir0aa"), ["GIR 0AA", "GIR0AA"]);
  for (const country of [null, undefined, "", "  "]) {
    assert.equal(normalizeCountryCode(country), "US");
  }
  for (const country of ["ZZ", " xx ", "USA", "1A", "United Kingdom"]) {
    assert.equal(normalizeCountryCode(country), country.trim().toUpperCase());
    assert.equal(validatePostalCode(country, "10001"), false);
    for (const pattern of ["10001", "10000 - 10999", "100*"]) {
      assert.equal(parsePostalPattern(country, pattern), null);
      assert.equal(matchesPostalPatternsCsv(country, "10001", pattern), false);
    }
    for (const pattern of ["10001", "10000 - 10999", "100*"]) {
      assert.equal(matchesPostalPattern(parsePostalPattern("US", pattern), country, "10001"), false);
    }
  }
  for (const country of ["BR", "HK", "AE", "AX", "BQ", "SS", "ZW"]) {
    assert.equal(normalizeCountryCode(country), country);
  }
});

test("shared country list includes Maldives for postal validation, options, and headless requests", () => {
  assert.equal(COUNTRY_CODES.has("MV"), true);
  assert.equal(COUNTRY_OPTIONS.some((option) => option.value === "MV" && option.label === "Maldives (MV)"), true);
  assert.equal(normalizeCountryCode(" mv "), "MV");
  assert.equal(validatePostalCode("MV", "20026"), true);
  assert.deepEqual(parsePostalPattern("MV", "20026"), { type: "exact", pattern: "20026" });
  assert.equal(parseHeadlessDeliveryInput({ country: "mv", postal_code: "20026" }).country, "MV");
});

test("postal-code-less countries do not acquire a synthetic postal code", () => {
  for (const country of ["HK", "AE"]) {
    assert.equal(normalizePostalCode(country, ""), "");
    assert.equal(validatePostalCode(country, ""), false);
    assert.deepEqual(postalCodeLookupValues(country, ""), []);
    assert.equal(parsePostalPattern(country, ""), null);
    assert.equal(matchesPostalPatternsCsv(country, "", "123*"), false);
  }
});
