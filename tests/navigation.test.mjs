import test from "node:test";
import assert from "node:assert/strict";
import { requiresDocumentNavigation } from "../app/utils/navigation.ts";

test("embedded app pages stay in React Router navigation", () => {
  for (const url of [
    "/app/delivery-settings",
    "/app/delivery-settings#behavior",
    "/app/delivery-settings#coverage",
    "/app/delivery-settings#targeting",
    "/app/additional",
    "/app/analytics",
  ]) {
    assert.equal(requiresDocumentNavigation(url), false, url);
  }
});

test("external links and file endpoints retain document navigation", () => {
  assert.equal(requiresDocumentNavigation("https://admin.shopify.com", { external: true }), true);
  assert.equal(requiresDocumentNavigation("https://admin.shopify.com", { target: "_top" }), true);
  assert.equal(requiresDocumentNavigation("mailto:support@example.com"), true);
  assert.equal(requiresDocumentNavigation("/app/delivery-export"), true);
  assert.equal(requiresDocumentNavigation("/app/import-errors/job-1"), true);
});
