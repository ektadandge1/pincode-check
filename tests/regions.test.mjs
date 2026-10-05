import test from "node:test";
import assert from "node:assert/strict";
import { regionsForCountry, suggestedRegions } from "../app/utils/regions.ts";

test("region suggestions follow the selected country", () => {
  assert.deepEqual(suggestedRegions("IN", "ma").slice(0, 3).map((option) => option.value), [
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
  ]);
  assert.deepEqual(suggestedRegions("US", "tex").map((option) => option.value), ["Texas"]);
  assert.deepEqual(suggestedRegions("CA", "ont").map((option) => option.value), ["Ontario"]);
});

test("every supported delivery country has region data", () => {
  for (const country of ["AU", "CA", "DE", "ES", "FR", "GB", "IN", "IT", "JP", "NL", "NZ", "US"]) {
    assert.ok(regionsForCountry(country).length > 0, country);
  }
  assert.deepEqual(regionsForCountry(""), []);
});
