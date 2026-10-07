/* eslint-env node, es2020 */
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

test("actual importer preserves currency-only records and still requires currency for a charge", async () => {
  const historical = {
    shop: "import-test.myshopify.com", country: "US", postalCode: "10001",
    patternType: "exact", rangeStart: null, rangeEnd: null, deliveryDays: 2,
    deliveryCharge: null, currency: "USD", zone: "East", zoneId: 7,
    city: "New York", state: "NY", serviceable: false, codAvailable: true,
    sameDayAvailable: true, nextDayAvailable: true, expressAvailable: true,
  };
  let state = { postal: { ...historical }, jobs: [], errors: [] };
  const client = (current) => ({
    postalCode: {
      findUnique: async ({ where }) => current.postal?.postalCode === where.shop_country_postalCode.postalCode
        ? { deliveryCharge: current.postal.deliveryCharge, currency: current.postal.currency } : null,
      upsert: async ({ where, create, update }) => {
        const exists = current.postal?.postalCode === where.shop_country_postalCode.postalCode;
        current.postal = exists ? { ...current.postal, ...update } : { deliveryCharge: null, ...create };
        return current.postal;
      },
    },
    zone: { upsert: async () => assert.fail("Omitted zones must not be written") },
    importJob: {
      create: async ({ data }) => {
        const job = { id: current.jobs.length + 1, ...data };
        current.jobs.push(job);
        return job;
      },
      update: async ({ where, data }) => {
        const job = current.jobs.find((entry) => entry.id === where.id);
        for (const [key, value] of Object.entries(data)) {
          job[key] = typeof value === "object" && value !== null && "increment" in value
            ? job[key] + value.increment : value;
        }
        return job;
      },
    },
    importError: { create: async ({ data }) => current.errors.push(data) },
  });
  const previousPrisma = globalThis.prismaGlobal;
  const injected = {
    importJob: {
      create: (args) => client(state).importJob.create(args),
      update: (args) => client(state).importJob.update(args),
    },
    $transaction: async (callback, options) => {
      assert.equal(options.timeout, 10_000);
      const next = structuredClone(state);
      const result = await callback(client(next));
      state = next;
      return result;
    },
  };
  const server = await createServer({
    configFile: false, envFile: false,
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  globalThis.prismaGlobal = injected;
  try {
    const { importPostalCodesFromCsv } = await server.ssrLoadModule("/app/services/postal-code-importer.server.ts");
    for (const csv of [
      "country,postal_code,delivery_days\nUS,10001,3",
      "country,postal_code,delivery_days,delivery_charge,currency\nUS,10001,3, , ",
    ]) {
      const result = await importPostalCodesFromCsv(historical.shop, csv, "csv");
      assert.equal(result.status, "completed");
      assert.equal(result.successRows, 1);
      assert.equal(result.failedRows, 0);
      assert.deepEqual(state.postal, { ...historical, deliveryDays: 3 });
      assert.equal(state.jobs.at(-1).successRows, 1);
      assert.equal(state.errors.length, 0);
    }
    const zero = await importPostalCodesFromCsv(historical.shop,
      "country,postal_code,delivery_days,delivery_charge\nUS,10001,3,0", "csv");
    assert.equal(zero.status, "completed");
    assert.equal(state.postal.deliveryCharge, 0);
    assert.equal(state.postal.currency, "USD");

    const currencyOnly = await importPostalCodesFromCsv(historical.shop,
      "country,postal_code,delivery_days,currency\nUS,10002,3,USD", "csv");
    assert.equal(currencyOnly.status, "completed");
    assert.equal(state.postal.deliveryCharge, null);
    assert.equal(state.postal.currency, "USD");

    const beforeFailure = structuredClone(state.postal);
    const missingCurrency = await importPostalCodesFromCsv(historical.shop,
      "country,postal_code,delivery_days,delivery_charge\nUS,10003,3,0", "csv");
    assert.equal(missingCurrency.status, "failed");
    assert.equal(missingCurrency.failedRows, 1);
    assert.equal(state.jobs.at(-1).failedRows, 1);
    assert.match(state.errors.at(-1).reason, /Currency is required/);
    assert.deepEqual(state.postal, beforeFailure);
  } finally {
    if (previousPrisma === undefined) delete globalThis.prismaGlobal;
    else globalThis.prismaGlobal = previousPrisma;
    await server.close();
  }
});
