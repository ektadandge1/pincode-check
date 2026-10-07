/* eslint-env node */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Complete synthetic environment: never load .env or inherit application secrets.
const fixture = {
  NODE_ENV: "production", APP_ENV: "production",
  DATABASE_URL: "file:/data/incode.sqlite",
  SHOPIFY_API_KEY: "fixture-client-id", SHOPIFY_API_SECRET: "fixture-secret-not-real",
  SHOPIFY_APP_URL: "https://incode.fixture-shop.dev", SHOPIFY_APP_HANDLE: "incode-track",
  SHOPIFY_BILLING_TEST: "false", SHOPIFY_BILLING_REQUIRED: "true",
  SCOPES: "read_products,read_inventory,read_locations,write_app_proxy",
  SUPPORT_EMAIL: "support@fixture-shop.dev", LEGAL_BUSINESS_NAME: "Fixture Business",
};
function check(overrides = {}) {
  const env = { ...fixture, ...overrides };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/check-env.mjs", import.meta.url))], { env, encoding: "utf8" });
  assert.ifError(result.error);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /MODULE_NOT_FOUND|SyntaxError/);
  assert.ok(!output.includes(fixture.SHOPIFY_API_SECRET));
  assert.ok(!output.includes(fixture.SHOPIFY_API_KEY));
  return { status: result.status, output };
}
test("production fixture passes with manual durability warning, not launch approval", () => {
  const result = check();
  assert.equal(result.status, 0);
  assert.match(result.output, /durability is not verified/);
  assert.match(result.output, /checks remain manual/);
});
test("every required production setting fails when absent", () => {
  for (const key of Object.keys(fixture)) {
    const result = check({ [key]: undefined });
    assert.equal(result.status, 1, key);
    assert.ok(result.output.includes(key));
  }
});
test("rejects unsafe billing, environment markers and unused permissions", () => {
  for (const overrides of [
    { NODE_ENV: "development" }, { APP_ENV: "development" },
    { SHOPIFY_BILLING_TEST: "true" }, { SHOPIFY_BILLING_TEST: "yes" },
    { SHOPIFY_BILLING_REQUIRED: "false" }, { SHOPIFY_BILLING_DEV_BYPASS: "true" },
    { SHOPIFY_BILLING_DEV_BYPASS: "yes" },
    ...["read_shipping", "read_orders", "write_orders"].map((scope) => ({ SCOPES: `${fixture.SCOPES},${scope}` })),
    ...["read_products", "read_inventory", "read_locations", "write_app_proxy"].map((scope) => ({ SCOPES: fixture.SCOPES.split(",").filter((value) => value !== scope).join(",") })),
  ]) assert.equal(check(overrides).status, 1, JSON.stringify(overrides));
  assert.equal(check({ SHOPIFY_BILLING_DEV_BYPASS: "false" }).status, 0);
});
test("rejects placeholders, malformed URLs, tunnel URLs and URLs containing secrets without echoing them", () => {
  for (const url of ["not-a-url-secret", "http://incode.fixture-shop.dev", "https://example.com", "https://your-production-domain.example", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://a.trycloudflare.com", "https://a.ngrok-free.app", "https://user:secret@fixture-shop.dev", "https://fixture-shop.dev/?secret=hidden"]) {
    const result = check({ SHOPIFY_APP_URL: url });
    assert.equal(result.status, 1);
    assert.ok(!result.output.includes(url));
    assert.ok(!result.output.includes("hidden"));
  }
  assert.equal(check({ SUPPORT_EMAIL: "support@example.com" }).status, 1);
  assert.equal(check({ SHOPIFY_API_SECRET: "your-shopify-client-secret" }).status, 1);
});
test("SQLite paths warn without disclosure; unsupported and in-memory databases fail", () => {
  for (const url of ["file:./dev.sqlite", "file:/tmp/private-path.sqlite"]) {
    const result = check({ DATABASE_URL: url });
    assert.equal(result.status, 0);
    assert.match(result.output, /temporary\/development storage/);
    assert.ok(!result.output.includes(url));
  }
  assert.match(check({ DATABASE_URL: "file:./production.sqlite" }).output, /relative SQLite path/);
  for (const url of ["postgresql://user:secret@host/db", "file:", "file::memory:", "file:/data/db?mode=memory"]) {
    const result = check({ DATABASE_URL: url });
    assert.equal(result.status, 1);
    assert.ok(!result.output.includes(url));
  }
});
