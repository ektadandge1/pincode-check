import test from "node:test";
import assert from "node:assert/strict";
import { themeEmbedEnabled } from "../app/services/theme-embed.server.ts";

const appBlock = "shopify://apps/incode-track/blocks/delivery-checker-embed/extension-id";

test("theme embed status requires the matching enabled app block", () => {
  assert.equal(themeEmbedEnabled(JSON.stringify({
    current: { blocks: { embed: { type: appBlock, disabled: false } } },
  }), "incode-track", "delivery-checker-embed"), true);

  assert.equal(themeEmbedEnabled(JSON.stringify({
    current: { blocks: { embed: { type: appBlock, disabled: true } } },
  }), "incode-track", "delivery-checker-embed"), false);
});

test("theme embed status ignores unrelated and malformed theme settings", () => {
  assert.equal(themeEmbedEnabled(JSON.stringify({
    current: { blocks: { embed: { type: "shopify://apps/other/blocks/delivery-checker-embed/id" } } },
  }), "incode-track", "delivery-checker-embed"), false);
  assert.equal(themeEmbedEnabled("not-json", "incode-track", "delivery-checker-embed"), false);
});
