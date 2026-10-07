/* eslint-env node */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadAction(file, db, authenticate, clearPlanAccessCache) {
  const source = await readFile(new URL(`../app/routes/${file}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  // Execute the actual route with injected dependencies, without Shopify startup or a database.
  const code = outputText.replace(/^import .*;\r?\n/gm, "").replace("export const action", "const action");
  return new Function("db", "authenticate", "clearPlanAccessCache", "clearDeliveryCheckCaches", `${code}\nreturn action;`)(db, authenticate, clearPlanAccessCache, clearPlanAccessCache);
}

async function fixture(file, topic, fail = false) {
  const shop = "target.myshopify.com";
  const calls = [];
  let inTransaction = false;
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1][0].toLowerCase() + match[1].slice(1));
  const db = Object.fromEntries(models.map((model) => [model, {
    findMany: async (args) => {
      assert.ok(inTransaction, "Ownership must be read inside the deletion transaction");
      calls.push({ model, operation: "findMany", args });
      return model === "headlessApiToken" ? [{ id: "target-token" }] : [{ id: 7 }];
    },
    deleteMany: (args) => { calls.push({ model, operation: "deleteMany", args }); return { model }; },
    updateMany: (args) => { calls.push({ model, operation: "updateMany", args }); return { model }; },
  }]));
  db.$transaction = async (operations) => {
    calls.push({ operation: "transaction", operations });
    if (fail) throw new Error("fixture database unavailable");
    if (typeof operations === "function") {
      inTransaction = true;
      try {
        return await operations(db);
      } finally {
        inTransaction = false;
      }
    }
  };
  const authenticate = { webhook: async () => ({ shop, topic }) };
  const clear = (value) => calls.push({ operation: "clearCache", shop: value });
  const action = await loadAction(file, db, authenticate, clear);
  return { action, db, authenticate, calls, models, shop };
}

test("shop redact covers every schema table, token/shop rate limits and plan cache, with tenant boundaries", async () => {
  const { action, calls, models, shop } = await fixture("webhooks.privacy.tsx", "SHOP_REDACT");
  assert.equal((await action({ request: new Request("https://fixture.test") })).status, 200);
  assert.deepEqual(calls[0], { operation: "clearCache", shop });
  // ImportError is deleted through its cascading ImportJob ownership, exercised
  // against actual SQLite in privacy-webhooks-sqlite.test.mjs.
  assert.deepEqual(calls.filter((call) => call.operation === "deleteMany").map((call) => call.model).sort(), models.filter((model) => model !== "importError").sort());
  for (const call of calls.filter((call) => call.model && call.model !== "importError" && call.model !== "headlessRateLimit")) {
    assert.equal(call.args.where.shop, shop);
  }
  assert.equal(calls[2].operation, "transaction");
  assert.equal(calls[3].model, "headlessApiToken");
  assert.equal(calls[3].operation, "findMany");
  const rateWhere = calls.find((call) => call.model === "headlessRateLimit").args.where;
  assert.deepEqual(rateWhere, { OR: [
    { key: { startsWith: `shop:${shop}:` } },
    { key: { startsWith: "token:target-token:" } },
  ] });
  const matches = (key) => rateWhere.OR.some((filter) => key.startsWith(filter.key.startsWith));
  assert.ok(matches(`shop:${shop}:public:1`));
  assert.ok(matches("token:target-token:1"));
  assert.ok(!matches("token:target-token-other:1"));
  assert.ok(!matches(`shop:${shop}.other:public:1`));
  assert.ok(!matches("shop:other.myshopify.com:public:1"));
  assert.equal(calls.filter((call) => call.operation === "transaction").length, 1);
  // A duplicate after tokens/import jobs are gone still removes shop-level buckets.
  const second = await fixture("webhooks.privacy.tsx", "SHOP_REDACT");
  second.db.importJob.findMany = second.db.headlessApiToken.findMany = async () => [];
  assert.equal((await second.action({ request: new Request("https://fixture.test") })).status, 200);
  assert.deepEqual(second.calls.find((call) => call.model === "headlessRateLimit").args.where.OR, [{ key: { startsWith: `shop:${shop}:` } }]);
});

test("customer privacy topics acknowledge without inventing customer-linked records or deleting shop data", async () => {
  for (const topic of ["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT"]) {
    const { action, calls } = await fixture("webhooks.privacy.tsx", topic);
    assert.equal((await action({ request: new Request("https://fixture.test") })).status, 200);
    assert.deepEqual(calls, []);
  }
});

test("uninstall clears cache, deletes sessions and revokes tokens together even on repeat delivery", async () => {
  const { action, calls, shop } = await fixture("webhooks.app.uninstalled.tsx", "APP_UNINSTALLED");
  for (let i = 0; i < 2; i++) assert.equal((await action({ request: new Request("https://fixture.test") })).status, 200);
  assert.deepEqual(calls[0], { operation: "clearCache", shop });
  const revoke = calls.find((call) => call.operation === "updateMany");
  assert.equal(revoke.model, "headlessApiToken");
  assert.equal(revoke.args.where.shop, shop);
  assert.equal(revoke.args.data.enabled, false);
  assert.ok(revoke.args.data.revokedAt instanceof Date);
  assert.deepEqual(calls.find((call) => call.model === "session").args.where, { shop });
  assert.equal(calls.filter((call) => call.operation === "transaction").length, 2);
});

test("authentication failures do not mutate data; database failures propagate for webhook retries after cache eviction", async () => {
  for (const [file, topic] of [["webhooks.privacy.tsx", "SHOP_REDACT"], ["webhooks.app.uninstalled.tsx", "APP_UNINSTALLED"]]) {
    const denied = await fixture(file, topic);
    denied.authenticate.webhook = async () => { throw new Response(null, { status: 401 }); };
    await assert.rejects(denied.action({ request: new Request("https://fixture.test") }), (error) => error.status === 401);
    assert.deepEqual(denied.calls, []);
    const failed = await fixture(file, topic, true);
    await assert.rejects(failed.action({ request: new Request("https://fixture.test") }), /database unavailable/);
    assert.equal(failed.calls[0].operation, "clearCache");
  }
});
