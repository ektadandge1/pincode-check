import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { HEADLESS_READ_SCOPES, normalizeAllowedOrigins, parseHeadlessScopes, storedAllowedOriginsLabel } from "../app/utils/headless-tokens.ts";
import { generateHeadlessToken, hashHeadlessToken } from "../app/utils/headless-tokens.server.ts";

test("tokens contain 256 random bits, safe prefixes, and only SHA-256 hashes", () => {
  for (const type of ["public", "private"]) {
    const generated = generateHeadlessToken(type);
    assert.match(generated.token, new RegExp(`^hdt_${type}_[A-Za-z0-9_-]{43}$`));
    assert.equal(generated.tokenHash, hashHeadlessToken(generated.token));
    assert.equal(generated.tokenHash, createHash("sha256").update(generated.token).digest("hex"));
    assert.match(generated.tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(generated.tokenPrefix, generated.token.slice(0, `hdt_${type}_`.length + 8));
    assert.notEqual(generated.tokenPrefix, generated.token);
    assert.notEqual(generateHeadlessToken(type).token, generated.token);
  }
  assert.throws(() => generateHeadlessToken("write"));
});

test("hashing is deterministic and does not trim or normalize bearer secrets", () => {
  assert.equal(hashHeadlessToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.notEqual(hashHeadlessToken("abc"), hashHeadlessToken(" abc"));
  assert.notEqual(hashHeadlessToken("abc"), hashHeadlessToken("ABC"));
});

test("origins are exact HTTPS origins or HTTP localhost, deduplicated in order", () => {
  assert.deepEqual(normalizeAllowedOrigins("  "), []);
  assert.deepEqual(normalizeAllowedOrigins("https://store.example,\nhttps://store.example https://other.example:8443\nhttp://localhost:3000\nhttp://localhost"), ["https://store.example", "https://other.example:8443", "http://localhost:3000", "http://localhost"]);
});

test("origins reject wildcards, credentials, paths, queries, fragments and parser repairs", () => {
  for (const origin of [
    "*", "null", "https://*.example.com", "https://example.com/", "https://example.com/path",
    "https://example.com?x=1", "https://example.com#fragment", "https://user:pass@example.com",
    "http://example.com", "http://127.0.0.1", "http://[::1]", "http://localhost.example.com",
    "http://localhost.evil", "ftp://example.com", "javascript:alert(1)", "https:example.com",
    "https://example.com\\evil", "https://EXAMPLE.com", "https://example.com:443",
    "https://example.com:99999", "https://example.com/../", "https://example.com@evil.com",
  ]) assert.throws(() => normalizeAllowedOrigins(origin), undefined, origin);
  assert.throws(() => normalizeAllowedOrigins("https://good.example, http://bad.example"));
});

test("scope parser permits only the four read scopes and deduplicates", () => {
  assert.deepEqual(parseHeadlessScopes(HEADLESS_READ_SCOPES.join(",")), [...HEADLESS_READ_SCOPES]);
  assert.deepEqual(parseHeadlessScopes([" delivery:check ", "delivery:check", "delivery:batch"]), ["delivery:check", "delivery:batch"]);
  for (const raw of ["", [], "delivery:write", "delivery:check,delivery:write", "*", "delivery:check,", ["delivery:check", "admin:read"], "delivery:CHECK"]) {
    assert.throws(() => parseHeadlessScopes(raw));
  }
});

test("stored origins render safely for malformed legacy metadata", () => {
  assert.equal(storedAllowedOriginsLabel('["https://shop.example","http://localhost:3000"]'), "https://shop.example, http://localhost:3000");
  assert.equal(storedAllowedOriginsLabel("[]"), "None (server only)");
  assert.equal(storedAllowedOriginsLabel("not-json"), "Invalid legacy metadata");
  assert.equal(storedAllowedOriginsLabel('{"origin":"https://shop.example"}'), "Invalid legacy metadata");
  assert.equal(storedAllowedOriginsLabel('["https://shop.example",7]'), "Invalid legacy metadata");
});
