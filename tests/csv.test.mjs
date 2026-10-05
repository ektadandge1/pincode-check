import assert from "node:assert/strict";
import test from "node:test";

import { parseCsv } from "../app/utils/csv.server.ts";

test("parses quoted commas, multiline values, and UTF-8 BOM headers", () => {
  const rows = parseCsv(
    '\uFEFFcountry,postal_code,delivery_days,city\r\nUS,10001,2,"New York, NY"\r\nGB,SW1A 1AA,3,"Westminster\nLondon"',
  );

  assert.deepEqual(rows, [
    { country: "US", postal_code: "10001", delivery_days: "2", city: "New York, NY" },
    { country: "GB", postal_code: "SW1A 1AA", delivery_days: "3", city: "Westminster\nLondon" },
  ]);
});

test("rejects malformed and ambiguous headers", () => {
  assert.throws(() => parseCsv('country,city\nUS,"New York'), /unclosed quoted field/i);
  assert.throws(() => parseCsv("country,country\nUS,US"), /duplicate column names/i);
  assert.throws(() => parseCsv("country,\nUS,10001"), /empty column name/i);
});
