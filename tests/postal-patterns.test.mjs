import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPostalPattern,
  matchesPostalPattern,
  matchesPostalPatternsCsv,
  parsePostalPattern,
  postalPatternSpecificity,
  validatePostalPattern,
} from "../app/utils/delivery.server.ts";

test("matches local-delivery CSV patterns", () => {
  assert.equal(matchesPostalPatternsCsv("US", "10015", "10001,10010-10020,902*"), true);
  assert.equal(matchesPostalPatternsCsv("US", "90210", "10001,10010-10020,902*"), true);
  assert.equal(matchesPostalPatternsCsv("US", "30301", "10001,10010-10020,902*"), false);
});

test("classifies exact, range, and wildcard patterns", () => {
  assert.equal(classifyPostalPattern("US", "10001"), "exact");
  assert.equal(classifyPostalPattern("US", "10001-1234"), "exact");
  assert.equal(classifyPostalPattern("US", "10000-10999"), "range");
  assert.equal(classifyPostalPattern("IN", "400001-400999"), "range");
  assert.equal(classifyPostalPattern("US", "123*"), "wildcard");
  assert.equal(classifyPostalPattern("GB", "SW1A*"), "wildcard");
});

test("rejects invalid patterns", () => {
  assert.equal(validatePostalPattern("US", ""), false);
  assert.equal(validatePostalPattern("US", "10999-10000"), false);
  assert.equal(validatePostalPattern("US", "*"), false);
  assert.equal(parsePostalPattern("US", "not-a-code!!"), null);
});

test("matches numeric ranges including ZIP boundaries", () => {
  const range = parsePostalPattern("US", "10000-10999");
  assert.ok(range && range.type === "range");
  assert.equal(matchesPostalPattern(range, "US", "10001"), true);
  assert.equal(matchesPostalPattern(range, "US", "10000"), true);
  assert.equal(matchesPostalPattern(range, "US", "10999"), true);
  assert.equal(matchesPostalPattern(range, "US", "11000"), false);
  assert.equal(matchesPostalPattern(range, "US", "90210"), false);
});

test("matches wildcard prefixes", () => {
  const wildcard = parsePostalPattern("US", "123*");
  assert.ok(wildcard && wildcard.type === "wildcard");
  assert.equal(matchesPostalPattern(wildcard, "US", "12345"), true);
  assert.equal(matchesPostalPattern(wildcard, "US", "123"), true);
  assert.equal(matchesPostalPattern(wildcard, "US", "98765"), false);

  const gb = parsePostalPattern("GB", "SW1A*");
  assert.ok(gb && gb.type === "wildcard");
  assert.equal(matchesPostalPattern(gb, "GB", "SW1A 1AA"), true);
  assert.equal(matchesPostalPattern(gb, "GB", "E1 6AN"), false);
});

test("ranks exact above longer wildcards above ranges", () => {
  const exact = parsePostalPattern("US", "10001");
  const shortWildcard = parsePostalPattern("US", "123*");
  const longWildcard = parsePostalPattern("US", "1234*");
  const wideRange = parsePostalPattern("US", "00000-99999");
  const narrowRange = parsePostalPattern("US", "10000-10010");

  assert.ok(exact && shortWildcard && longWildcard && wideRange && narrowRange);
  assert.ok(postalPatternSpecificity(exact) > postalPatternSpecificity(longWildcard));
  assert.ok(postalPatternSpecificity(longWildcard) > postalPatternSpecificity(shortWildcard));
  assert.ok(postalPatternSpecificity(narrowRange) > postalPatternSpecificity(wideRange));
});
