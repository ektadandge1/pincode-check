import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Shopify validates configuration at import time; these are nonsecret test values.
process.env.DATABASE_URL ||= "file:./dev.sqlite";
process.env.SHOPIFY_API_KEY ||= "headless-verification-api-key";
process.env.SHOPIFY_API_SECRET ||= "headless-verification-not-a-secret";
process.env.SHOPIFY_APP_URL ||= "https://headless-verification.example";
process.env.SCOPES ||= "read_products";
process.env.SHOPIFY_BILLING_REQUIRED = "true";
process.env.SHOPIFY_PARTNER_ORG_ID = "98765";
process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN = "headless-verification-partner-token";
process.env.SHOPIFY_APP_GID = "gid://shopify/App/123456";

const prisma = (await import("../app/db.server.ts")).default;
const shop = `headless-verify-${randomUUID()}.myshopify.com`;
const origin = "https://headless-verification.example";
const tokenIds = [];
const secrets = [process.env.SHOPIFY_API_KEY, process.env.SHOPIFY_API_SECRET];
const originalFetch = globalThis.fetch;
let networkCalls = 0;
const mockCalls = { billing: 0, products: 0, inventory: 0 };
let passed = 0;
let installed = false;

// Never delegate to the original fetch, including for unexpected requests.
globalThis.fetch = async (input, init) => {
  try {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.ok(installed, "Shopify called before the synthetic installation existed");
    if (url.hostname === "partners.shopify.com") {
      assert.equal(url.pathname, "/98765/api/2026-07/graphql.json");
      assert.equal(request.headers.get("X-Shopify-Access-Token"), "headless-verification-partner-token");
      const { query, variables } = await request.json();
      assert.ok(query.includes("query ActiveSubscription"));
      assert.deepEqual(variables, { appId: "gid://shopify/App/123456", shopId: "gid://shopify/Shop/1" });
      mockCalls.billing += 1;
      return Response.json({ data: { activeSubscription: {
        billingPeriod: "MONTHLY", cancelAtEndOfCycle: false, trialEndsAt: null,
        currentBillingCycle: { startTime: new Date().toISOString(), endTime: new Date(Date.now() + 86_400_000).toISOString() },
      } } });
    }
    assert.equal(url.hostname, shop);
    assert.equal(url.protocol, "https:");
    assert.match(url.pathname, /^\/admin\/api\/[^/]+\/graphql\.json$/);
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("X-Shopify-Access-Token"), "headless-verification-offline-access-token");
    const { query, variables } = await request.json();
    if (query.includes("query ShopBillingIdentity")) {
      return Response.json({ data: { shop: { id: "gid://shopify/Shop/1" } } });
    }
    if (query.includes("query VariantInventoryForEdd")) {
      assert.equal(variables?.id, "gid://shopify/ProductVariant/420", "Inventory must receive a normalized variant GID");
      mockCalls.inventory += 1;
      return Response.json({ data: { productVariant: {
        id: variables.id, inventoryPolicy: "DENY", sellableOnlineQuantity: 10,
        inventoryItem: { inventoryLevels: { pageInfo: { hasNextPage: false }, nodes: [{
          quantities: [{ name: "available", quantity: 10 }],
          location: { id: "gid://shopify/Location/1", isActive: true, fulfillsOnlineOrders: true },
        }] } },
      } } });
    }
    assert.ok(query.includes("query DeliveryCheckerProductContexts"), "Unexpected GraphQL query");
    assert.ok(Array.isArray(variables?.ids));
    mockCalls.products += 1;
    return Response.json({ data: { nodes: variables.ids.map((id) => {
      assert.match(id, /^gid:\/\/shopify\/(?:Product\/(42|43)|ProductVariant\/420)$/);
      const product = { id: id === "gid://shopify/ProductVariant/420" ? "gid://shopify/Product/42" : id,
        vendor: "Verification Vendor", tags: ["verification"],
        collections: { nodes: [{ handle: "verification" }], pageInfo: { hasNextPage: false } } };
      return id === "gid://shopify/ProductVariant/420" ? { id, product } : product;
    }) } });
  } catch (error) {
    networkCalls += 1;
    throw error;
  }
};

try {
  const { handleHeadlessRequest } = await import("../app/services/headless-api.server.ts");
  const { generateHeadlessToken } = await import("../app/utils/headless-tokens.server.ts");
  assert.equal(await prisma.session.count({ where: { shop } }), 0);

  async function createToken(type, overrides = {}) {
    const { token, tokenHash, tokenPrefix } = generateHeadlessToken(type);
    const id = randomUUID();
    tokenIds.push(id);
    secrets.push(token, tokenHash, tokenPrefix);
    await prisma.headlessApiToken.create({
      data: {
        id,
        shop,
        name: "Headless integration verification",
        tokenType: type,
        tokenHash,
        tokenPrefix,
        scopesCsv: "delivery:check,delivery:estimate,delivery:batch,delivery:methods",
        allowedOriginsJson: JSON.stringify([origin]),
        ...overrides,
      },
    });
    return token;
  }

  async function verify(label, {
    type = "public", token, method = "POST", requestOrigin = type === "public" ? origin : undefined,
    operation = "check", status, code,
    body = { country: "US", postal_code: "10001" }, rawBody, contentType = "application/json", check,
  }) {
    const headers = new Headers();
    if (requestOrigin !== undefined) headers.set("Origin", requestOrigin);
    if (token !== undefined) {
      headers.set(type === "public" ? "X-Incode-Public-Token" : "Authorization",
        type === "public" ? token : `Bearer ${token}`);
    }
    if (method === "POST") headers.set("Content-Type", contentType);
    const response = await handleHeadlessRequest(new Request(
      `https://headless-verification.example/api/v1/${type}/delivery/${operation}`,
      { method, headers, ...(method === "POST" ? { body: rawBody ?? JSON.stringify(body) } : {}) },
    ), type, operation);
    const text = await response.text();
    assert.equal(response.status, status, `${label}: unexpected status (${text})`);
    assert.equal(response.headers.get("Cache-Control"), "no-store", label);
    assert.equal(response.headers.get("Vary"), "Origin", label);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", label);
    assert.match(response.headers.get("X-Request-ID") ?? "", /^[\da-f-]{36}$/i, label);
    const exposed = `${text}\n${JSON.stringify([...response.headers])}`;
    for (const secret of secrets) {
      if (secret) assert.ok(!exposed.includes(secret), `${label}: response leaked a secret`);
    }
    assert.ok(!/hdt_(?:public|private)_/.test(exposed), `${label}: response leaked a token`);
    if (status === 204) {
      assert.equal(text, "", label);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), requestOrigin, label);
      assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS", label);
      assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type, X-Incode-Public-Token", label);
      assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null, label);
    } else {
      const result = JSON.parse(text);
      assert.equal(result.success, status === 200, label);
      assert.equal(result.request_id, response.headers.get("X-Request-ID"), label);
      if (status === 200) {
        assert.deepEqual(Object.keys(result).sort(), ["data", "request_id", "success"], label);
        assert.ok(check, `${label}: success must assert operation data`);
        check(result.data);
      } else {
        assert.equal(result.error.code, code, label);
        assert.deepEqual(Object.keys(result).sort(), ["error", "request_id", "success"], label);
      }
    }
    if (status === 405) assert.equal(response.headers.get("Allow"), "POST, OPTIONS", label);
    if (status === 429) assert.equal(response.headers.get("Retry-After"), "60", label);
    if (status === 200) {
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), type === "public" ? origin : null, label);
    }
    if (code === "origin_denied") assert.equal(response.headers.get("Access-Control-Allow-Origin"), null, label);
    assert.equal(networkCalls, 0, `${label}: attempted network access`);
    passed += 1;
    console.log(`PASS ${label}: ${status}${code ? ` ${code}` : ""}`);
  }

  for (const type of ["public", "private"]) {
    const valid = await createToken(type);
    await verify(`${type}: missing token`, { type, status: 401, code: "invalid_token" });
    await verify(`${type}: malformed token`, { type, token: "invalid", status: 401, code: "invalid_token" });
    const unknown = generateHeadlessToken(type).token;
    secrets.push(unknown);
    await verify(`${type}: unknown token`, { type, token: unknown, status: 401, code: "invalid_token" });
    const otherType = type === "public" ? "private" : "public";
    await verify(`${type}: wrong token prefix`, { type, token: await createToken(otherType), status: 401, code: "invalid_token" });
    await verify(`${type}: wrong stored token type`, { type, token: await createToken(type, { tokenType: otherType }), status: 401, code: "invalid_token" });
    for (const [label, overrides] of [
      ["disabled", { enabled: false }],
      ["revoked", { revokedAt: new Date() }],
      ["expired", { expiresAt: new Date(Date.now() - 60_000) }],
    ]) {
      await verify(`${type}: ${label} token`, { type, token: await createToken(type, overrides), status: 401, code: "invalid_token" });
    }
    await verify(`${type}: scope denied`, {
      type, token: await createToken(type, { scopesCsv: "delivery:estimate" }), status: 403, code: "scope_denied",
    });
    await verify(`${type}: origin denied`, {
      type, token: valid, requestOrigin: "https://denied.example", status: 403,
      code: type === "public" ? "origin_denied" : "private_token_browser_use",
    });
    if (type === "public") {
      for (const requestOrigin of ["", "null"]) {
        await verify(`public: ${requestOrigin || "empty"} origin denied`, {
          type, token: valid, requestOrigin, status: 403, code: "origin_denied",
        });
      }
    }
    for (const operation of ["check", "estimate", "batch", "methods"]) {
      await verify(`${type}: ${operation} missing offline session`, {
        type, token: valid, operation, status: 403, code: "app_not_installed",
      });
    }
    await verify(`${type}: GET rejected`, { type, method: "GET", status: 405, code: "method_not_allowed" });
  }

  await verify("public: OPTIONS allowed without token", { method: "OPTIONS", status: 204 });
  await verify("public: OPTIONS does not authenticate token", { method: "OPTIONS", token: "invalid", status: 204 });
  await verify("public: OPTIONS missing origin denied", { method: "OPTIONS", requestOrigin: "", status: 403, code: "origin_denied" });
  await verify("public: OPTIONS null origin denied", { method: "OPTIONS", requestOrigin: "null", status: 403, code: "origin_denied" });
  await verify("private: OPTIONS denied", { type: "private", method: "OPTIONS", requestOrigin: origin, status: 403, code: "origin_denied" });

  const rateWhere = { OR: [
    { key: { startsWith: `shop:${shop}:` } },
    ...tokenIds.map((id) => ({ key: { startsWith: `token:${id}:` } })),
  ] };
  const rateRows = await prisma.headlessRateLimit.findMany({ where: rateWhere });
  assert.equal(rateRows.filter((row) => row.key.startsWith(`shop:${shop}:`)).reduce((sum, row) => sum + row.count, 0), 8);
  assert.equal(rateRows.filter((row) => row.key.startsWith("token:")).reduce((sum, row) => sum + row.count, 0), 8);
  assert.equal(await prisma.headlessApiToken.count({ where: { shop, lastUsedAt: { not: null } } }), 0);
  assert.equal(networkCalls, 0);

  const accessToken = "headless-verification-offline-access-token";
  secrets.push(accessToken);
  await prisma.session.create({ data: {
    id: `offline_${shop}`, shop, state: "verification", isOnline: false,
    scope: "read_products", accessToken,
  } });
  await prisma.deliverySetting.create({ data: {
    shop, courierEnabled: false, inventoryAwareEnabled: false, dbFallbackEnabled: true,
    processingDays: 1, fallbackDays: 5, deliveryWindowDays: 2,
  } });
  await prisma.postalCode.create({ data: {
    shop, country: "US", postalCode: "10001", deliveryDays: 2, serviceable: true,
    codAvailable: true, deliveryCharge: 4.5, currency: "USD",
  } });
  installed = true;

  const checkEstimate = (data) => {
    assert.equal(data.enabled, true);
    assert.equal(data.processing_days, 1);
    assert.equal(data.transit_days, 5);
    assert.match(data.estimated_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(data.estimated_date_max, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(data.estimated_date_max >= data.estimated_date);
  };
  for (const type of ["public", "private"]) {
    const token = await createToken(type);
    const body = { country: "US", postal_code: "10001", product_id: "42" };
    await verify(`${type}: check available`, { type, token, body, status: 200, check: (data) => {
      assert.equal(data.available, true);
      assert.equal(data.source, "db_fallback");
      assert.equal(data.postal_code, "10001");
      assert.equal(data.cod_available, true);
      assert.equal(data.delivery_charge, 4.5);
    } });
    await verify(`${type}: check unavailable`, {
      type, token, body: { ...body, postal_code: "99999" }, status: 200,
      check: (data) => { assert.equal(data.available, false); assert.equal(data.postal_code, "99999"); },
    });
    await verify(`${type}: estimate`, {
      type, token, operation: "estimate", body: { country: "US", product_id: "42" }, status: 200, check: checkEstimate,
    });
    await verify(`${type}: methods`, { type, token, operation: "methods", body, status: 200, check: (data) => {
      assert.equal(data.available, true);
      assert.ok(Array.isArray(data.shipping_methods));
      assert.deepEqual(Object.keys(data).sort(), ["available", "shipping_methods"]);
    } });
    await verify(`${type}: batch`, {
      type, token, operation: "batch", body: { country: "US", items: [
        { key: "first", product_id: "42" }, { key: "second", product_id: "43" },
      ] }, status: 200, check: (data) => {
        assert.deepEqual(data.map((item) => item.key), ["first", "second"]);
        data.forEach((item) => checkEstimate(item.estimate));
      },
    });

    const json = JSON.stringify(body);
    const boundaryBody = json + " ".repeat(65_536 - Buffer.byteLength(json));
    await verify(`${type}: exactly 64 KiB accepted`, {
      type, token, rawBody: boundaryBody, status: 200, check: (data) => assert.equal(data.available, true),
    });
    await verify(`${type}: over 64 KiB rejected`, {
      type, token, rawBody: boundaryBody + " ", status: 413, code: "body_too_large",
    });
    await verify(`${type}: content type rejected`, {
      type, token, body, contentType: "text/plain", status: 415, code: "invalid_content_type",
    });
    await verify(`${type}: malformed JSON rejected`, { type, token, rawBody: "{", status: 400, code: "invalid_json" });
    for (const quantity of [0, -1, 1.5, 1000, "2", null]) {
      await verify(`${type}: invalid quantity ${JSON.stringify(quantity)}`, {
        type, token, body: { ...body, quantity }, status: 400, code: "invalid_quantity",
      });
    }
    for (const [label, items] of [
      ["empty", []],
      ["duplicate keys", [{ key: "same", product_id: "42" }, { key: "same", product_id: "43" }]],
    ]) {
      await verify(`${type}: ${label} batch rejected`, {
        type, token, operation: "batch", body: { country: "US", items }, status: 400, code: "invalid_batch",
      });
    }
    const usedToken = await prisma.headlessApiToken.findUnique({ where: { id: tokenIds.at(-1) } });
    assert.ok(usedToken.lastUsedAt instanceof Date);

    // Seed the current buckets rather than sending hundreds of requests.
    const limitedToken = await createToken(type);
    const limitedId = tokenIds.at(-1);
    const now = Date.now();
    const minuteKey = `token:${limitedId}:${Math.floor(now / 60_000)}`;
    await prisma.headlessRateLimit.upsert({
      where: { key: minuteKey },
      create: { key: minuteKey, count: 120, resetsAt: new Date((Math.floor(now / 60_000) + 1) * 60_000) },
      update: { count: 120 },
    });
    const callsBeforeLimit = mockCalls.billing + mockCalls.products;
    await verify(`${type}: token minute limit`, { type, token: limitedToken, status: 429, code: "rate_limited" });
    assert.equal((await prisma.headlessRateLimit.findUnique({ where: { key: minuteKey } })).count, 120);
    await prisma.headlessRateLimit.deleteMany({ where: { key: { startsWith: `token:${limitedId}:` } } });
    const dayNow = Date.now();
    const dayKey = `shop:${shop}:${type}:${Math.floor(dayNow / 86_400_000)}`;
    await prisma.headlessRateLimit.upsert({
      where: { key: dayKey },
      create: { key: dayKey, count: 10_000, resetsAt: new Date((Math.floor(dayNow / 86_400_000) + 1) * 86_400_000) },
      update: { count: 10_000 },
    });
    await verify(`${type}: shop daily limit`, { type, token: limitedToken, status: 429, code: "rate_limited" });
    assert.equal((await prisma.headlessRateLimit.findUnique({ where: { key: dayKey } })).count, 10_000);
    assert.equal(await prisma.headlessRateLimit.count({ where: { key: { startsWith: `token:${limitedId}:` } } }), 0);
    assert.equal(mockCalls.billing + mockCalls.products, callsBeforeLimit);
    const otherType = type === "public" ? "private" : "public";
    const otherToken = await createToken(otherType);
    const otherDayKey = `shop:${shop}:${otherType}:${Math.floor(dayNow / 86_400_000)}`;
    const otherCount = (await prisma.headlessRateLimit.findUnique({ where: { key: otherDayKey } }))?.count ?? 0;
    await verify(`${type}: exhausted daily quota leaves ${otherType} working`, {
      type: otherType, token: otherToken, status: 200,
      check: (data) => assert.equal(data.available, true),
    });
    assert.equal((await prisma.headlessRateLimit.findUnique({ where: { key: otherDayKey } })).count, otherCount + 1);
    assert.equal((await prisma.headlessRateLimit.findUnique({ where: { key: dayKey } })).count, 10_000);
    await prisma.headlessRateLimit.delete({ where: { key: dayKey } });
  }

  await prisma.deliverySetting.update({ where: { shop }, data: { inventoryAwareEnabled: true } });
  for (const type of ["public", "private"]) {
    const token = await createToken(type);
    for (const [label, context] of [
      ["numeric variant", { variant_id: "420" }],
      ["numeric product/variant pair", { product_id: "42", variant_id: "420" }],
      ["GID product/variant pair", { product_id: "gid://shopify/Product/42", variant_id: "gid://shopify/ProductVariant/420" }],
    ]) {
      const inventoryBefore = mockCalls.inventory;
      await verify(`${type}: inventory-aware ${label}`, {
        type, token, body: { country: "US", postal_code: "10001", quantity: 2, ...context }, status: 200,
        check: (data) => {
          assert.equal(data.available, true);
          assert.equal(data.in_stock, true);
          assert.equal(data.source, "db_fallback");
        },
      });
      assert.equal(mockCalls.inventory, inventoryBefore + 1, "Inventory-aware checks must execute the GID query");
    }
  }
  assert.ok(mockCalls.billing > 0, "Active subscription must be fetched from the mock");
  assert.ok(mockCalls.products >= 12, "Successful operations must resolve mock product contexts");
  assert.equal(await prisma.postalCodeSearchEvent.count({ where: { shop } }), 0, "Headless calls must not write analytics");
  assert.equal(networkCalls, 0);
} finally {
  try {
    const rateWhere = { OR: [
      { key: { startsWith: `shop:${shop}:` } },
      ...tokenIds.map((id) => ({ key: { startsWith: `token:${id}:` } })),
    ] };
    await prisma.$transaction([
      prisma.headlessRateLimit.deleteMany({ where: rateWhere }),
      prisma.headlessApiToken.deleteMany({ where: { shop } }),
      prisma.postalCodeSearchEvent.deleteMany({ where: { shop } }),
      prisma.postalCode.deleteMany({ where: { shop } }),
      prisma.deliverySetting.deleteMany({ where: { shop } }),
      prisma.session.deleteMany({ where: { shop } }),
    ]);
    assert.equal(await prisma.headlessRateLimit.count({ where: rateWhere }), 0);
    assert.equal(await prisma.headlessApiToken.count({ where: { shop } }), 0);
    for (const model of [prisma.session, prisma.deliverySetting, prisma.postalCode, prisma.postalCodeSearchEvent]) {
      assert.equal(await model.count({ where: { shop } }), 0);
    }
    console.log("Cleanup verified: all synthetic session, settings, postal, analytics, token and rate rows removed.");
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.$disconnect();
  }
}

console.log(`Headless API verification OK: ${passed} cases passed; ${mockCalls.billing} billing, ${mockCalls.products} product and ${mockCalls.inventory} inventory mocks; ${networkCalls} unexpected requests; 0 live network calls.`);
