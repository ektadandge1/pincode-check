/* eslint-env node */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { injectedServer } from "./helpers/injected-server.mjs";

const ownershipMigration = "20261007120000_import_error_ownership";
const shop = "target.myshopify.com";
const otherShop = "other.myshopify.com";

async function sqliteFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "privacy-webhooks-"));
  // SQL migration transactions must stay on one connection, like Prisma's migration engine.
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${join(directory, "test.sqlite")}?connection_limit=1` } } });
  t.after(async () => {
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });
  const migrations = new URL("../prisma/migrations/", import.meta.url);
  const migrate = async (name = ownershipMigration) => {
    const sql = await readFile(new URL(`${name}/migration.sql`, migrations), "utf8");
    for (const statement of sql.split(/;\s*(?:\r?\n|$)/).filter((statement) => statement.trim())) {
      await prisma.$executeRawUnsafe(statement);
    }
  };
  for (const entry of (await readdir(migrations, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && entry.name < ownershipMigration) await migrate(entry.name);
  }
  const actionFor = (db = prisma) => injectedServer({
    "app/db.server.ts": db,
    "app/shopify.server.ts": { authenticate: { webhook: async () => ({ shop, topic: "SHOP_REDACT" }) } },
    "app/services/delivery-checker.server.ts": { clearDeliveryCheckCaches: () => {} },
    "app/services/plan-access.server.ts": { clearPlanAccessCache: () => {} },
  })("app/routes/webhooks.privacy.tsx").action;
  return { prisma, migrate, actionFor };
}

const redact = (action) => action({ request: new Request("https://fixture.test/webhooks/privacy", { method: "POST" }) });

test("ownership migration preserves valid errors and removes persisted orphans", async (t) => {
  const { prisma, migrate } = await sqliteFixture(t);
  const retained = [];
  for (const owner of [shop, otherShop]) {
    const job = await prisma.importJob.create({ data: { shop: owner, source: "csv", status: "failed" } });
    retained.push(await prisma.importError.create({ data: {
      importJobId: job.id, rowNumber: 2, rawRow: `retained ${owner}`, reason: "invalid",
      createdAt: new Date("2026-10-01T12:00:00Z"),
    } }));
  }
  await prisma.importError.create({ data: { importJobId: 999, rowNumber: 3, rawRow: "historical orphan", reason: "invalid" } });
  await migrate();
  assert.deepEqual(await prisma.importError.findMany({ orderBy: { id: "asc" } }), retained);
  assert.deepEqual(await prisma.$queryRawUnsafe("PRAGMA foreign_key_check"), []);
  assert.deepEqual(await prisma.$queryRawUnsafe("PRAGMA foreign_keys"), [{ foreign_keys: 1n }]);
  const indexes = await prisma.$queryRawUnsafe('PRAGMA index_list("ImportError")');
  assert.ok(indexes.some((index) => index.name === "ImportError_importJobId_idx"));
  await assert.rejects(prisma.importError.create({ data: {
    importJobId: 999, rowNumber: 4, rawRow: "new orphan", reason: "invalid",
  } }), (error) => error.code === "P2003");
});

test("actual shop redaction cascades errors, preserves other tenants and removes rate limits on repeat delivery", async (t) => {
  const { prisma, migrate, actionFor } = await sqliteFixture(t);
  await migrate();
  const models = ["session", "deliverySetting", "zone", "postalCode", "deliveryTarget", "fulfillmentLocationRule",
    "shippingMethodRule", "postalCodeSearchEvent", "importJob", "headlessApiToken"];
  for (const [owner, tokenId] of [[shop, "target-token"], [otherShop, "target-token-other"]]) {
    await prisma.session.create({ data: { id: owner, shop: owner, state: "fixture", accessToken: "synthetic" } });
    await prisma.deliverySetting.create({ data: { shop: owner } });
    const zone = await prisma.zone.create({ data: { shop: owner, name: "Fixture" } });
    await prisma.postalCode.create({ data: { shop: owner, country: "US", postalCode: "10001", deliveryDays: 2, zoneId: zone.id } });
    await prisma.deliveryTarget.create({ data: { shop: owner, name: "Fixture", targetKind: "tag", targetValue: "fixture" } });
    await prisma.fulfillmentLocationRule.create({ data: { shop: owner, shopifyLocationId: "gid://shopify/Location/1", name: "Fixture" } });
    await prisma.shippingMethodRule.create({ data: { shop: owner, handle: "fixture", name: "Fixture", transitDays: 2 } });
    await prisma.postalCodeSearchEvent.create({ data: { shop: owner, country: "US", postalCode: "10***", available: false, source: "none" } });
    const job = await prisma.importJob.create({ data: { shop: owner, source: "csv", status: "failed" } });
    await prisma.importError.create({ data: { importJobId: job.id, rowNumber: 2, rawRow: owner, reason: "invalid" } });
    await prisma.headlessApiToken.create({ data: {
      id: tokenId, shop: owner, name: "Fixture", tokenType: "public", tokenHash: `synthetic-${owner}`,
      tokenPrefix: "synthetic", scopesCsv: "delivery:check", allowedOriginsJson: "[]",
    } });
    for (const key of [`shop:${owner}:public:1`, `token:${tokenId}:1`]) {
      await prisma.headlessRateLimit.create({ data: { key, count: 1, resetsAt: new Date("2027-01-01T00:00:00Z") } });
    }
  }
  const preserved = {};
  for (const model of [...models, "importError", "headlessRateLimit"]) {
    preserved[model] = await prisma[model].findMany(model === "importError"
      ? { where: { importJob: { shop: otherShop } } }
      : model === "headlessRateLimit"
        ? { where: { OR: [{ key: { startsWith: `shop:${otherShop}:` } }, { key: { startsWith: "token:target-token-other:" } }] } }
        : { where: { shop: otherShop } });
  }
  const action = actionFor();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal((await redact(action)).status, 200);
    for (const model of models) assert.equal(await prisma[model].count({ where: { shop } }), 0, model);
    for (const model of [...models, "importError", "headlessRateLimit"]) {
      assert.deepEqual(await prisma[model].findMany(), preserved[model], model);
    }
  }
});

test("an import committed at the redaction transaction boundary cannot leave an orphan", async (t) => {
  const { prisma, migrate, actionFor } = await sqliteFixture(t);
  await migrate();
  const importer = injectedServer({ "app/db.server.ts": prisma })("app/services/postal-code-importer.server.ts");
  let importedJob;
  const db = new Proxy(prisma, { get(target, key) {
    if (key === "$transaction") return async (callback) => {
      // The old route had already snapshotted job IDs at this boundary.
      const result = await importer.importPostalCodesFromCsv(shop, "country,postal_code,delivery_days\nUS,invalid,2", "csv");
      importedJob = result.jobId;
      assert.equal(await prisma.importError.count(), 1);
      return prisma.$transaction(callback);
    };
    return Reflect.get(target, key);
  } });
  assert.equal((await redact(actionFor(db))).status, 200);
  assert.equal(await prisma.importJob.count(), 0);
  assert.equal(await prisma.importError.count(), 0);
  await assert.rejects(prisma.importError.create({ data: {
    importJobId: importedJob, rowNumber: 3, rawRow: "late write", reason: "invalid",
  } }), (error) => error.code === "P2003");
  assert.equal((await redact(actionFor())).status, 200);
  assert.equal(await prisma.importError.count(), 0);
});

test("a paused actual importer cannot write an error after redaction deletes its job", async (t) => {
  const { prisma, migrate, actionFor } = await sqliteFixture(t);
  await migrate();
  let signalPaused;
  let resume;
  let writeError;
  const paused = new Promise((resolve) => { signalPaused = resolve; });
  const resumed = new Promise((resolve) => { resume = resolve; });
  const db = new Proxy(prisma, { get(target, key) {
    if (key === "$transaction") return async (callback, options) => {
      signalPaused();
      await resumed;
      try {
        return await prisma.$transaction(callback, options);
      } catch (error) {
        writeError = error;
        throw error;
      }
    };
    return Reflect.get(target, key);
  } });
  const importer = injectedServer({ "app/db.server.ts": db })("app/services/postal-code-importer.server.ts");
  const pending = importer.importPostalCodesFromCsv(shop, "country,postal_code,delivery_days\nUS,invalid,2", "csv");
  const rejected = assert.rejects(pending, /unable to persist the row failure/);
  await paused;
  try {
    assert.equal(await prisma.importJob.count(), 1);
    assert.equal((await redact(actionFor())).status, 200);
  } finally {
    resume();
  }
  await rejected;
  assert.equal(writeError.code, "P2003");
  assert.equal(await prisma.importJob.count(), 0);
  assert.equal(await prisma.importError.count(), 0);
});

test("failed redaction rolls back cascading errors and rate limits before a successful retry", async (t) => {
  const { prisma, migrate, actionFor } = await sqliteFixture(t);
  await migrate();
  const job = await prisma.importJob.create({ data: { shop, source: "csv", status: "failed" } });
  const error = await prisma.importError.create({ data: { importJobId: job.id, rowNumber: 2, rawRow: "retained for retry", reason: "invalid" } });
  const token = await prisma.headlessApiToken.create({ data: {
    shop, name: "Fixture", tokenType: "public", tokenHash: "synthetic", tokenPrefix: "synthetic",
    scopesCsv: "delivery:check", allowedOriginsJson: "[]",
  } });
  const bucket = await prisma.headlessRateLimit.create({ data: {
    key: `token:${token.id}:1`, count: 1, resetsAt: new Date("2027-01-01T00:00:00Z"),
  } });
  const db = { $transaction: (callback) => prisma.$transaction((tx) => callback(new Proxy(tx, { get(target, key) {
    if (key === "headlessApiToken") return new Proxy(target.headlessApiToken, { get(delegate, operation) {
      if (operation === "deleteMany") return async () => { throw new Error("fixture deletion failure"); };
      return Reflect.get(delegate, operation);
    } });
    return Reflect.get(target, key);
  } }))) };
  await assert.rejects(redact(actionFor(db)), /fixture deletion failure/);
  assert.deepEqual(await prisma.importJob.findMany(), [job]);
  assert.deepEqual(await prisma.importError.findMany(), [error]);
  assert.deepEqual(await prisma.headlessApiToken.findMany(), [token]);
  assert.deepEqual(await prisma.headlessRateLimit.findMany(), [bucket]);
  assert.equal((await redact(actionFor())).status, 200);
  assert.equal(await prisma.importError.count(), 0);
  assert.equal(await prisma.headlessRateLimit.count(), 0);
});
