import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPostalCsvTemplate,
  POSTAL_CSV_TEMPLATE_HEADERS,
} from "../app/utils/postal-csv-template.ts";

test("downloadable postal template uses the importer's canonical columns", () => {
  assert.equal(
    buildPostalCsvTemplate(),
    `\uFEFF${POSTAL_CSV_TEMPLATE_HEADERS.join(",")}\r\n`,
  );
  assert.deepEqual(POSTAL_CSV_TEMPLATE_HEADERS.slice(0, 3), [
    "country",
    "postal_code",
    "delivery_days",
  ]);
});
