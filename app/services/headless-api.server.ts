import { randomUUID } from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { type HeadlessReadScope } from "../utils/headless-tokens";
import { hashHeadlessToken } from "../utils/headless-tokens.server";
import { HeadlessRequestError, parseHeadlessDeliveryInput } from "../utils/headless-request";
import { validatePostalCode } from "../utils/delivery.server";
import { parseProductEstimateBatch } from "../utils/targeting.server";
import { canonicalBatchItems, canonicalProductFor, resolveShopifyProductContexts } from "./product-context.server";
import { resolvePlanAccess } from "./plan-access.server";
import { checkDelivery, getGeneralDeliveryEstimate, getProductCardDeliveryEstimates } from "./delivery-checker.server";

async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HeadlessRequestError("invalid_content_type", "Use application/json.", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HeadlessRequestError("invalid_request", "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      finished = done;
      if (done) continue;
      size += value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        throw new HeadlessRequestError("body_too_large", "Maximum body size is 64 KiB.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HeadlessRequestError("invalid_json", "Invalid JSON body.");
  }
}

async function consumeLimits(tokenId: string, shop: string, tokenType: string) {
  const now = Date.now();
  const limits = [
    { key: `token:${tokenId}:${Math.floor(now / 60_000)}`, max: 120, period: 60_000 },
    { key: `shop:${shop}:${tokenType}:${Math.floor(now / 86_400_000)}`, max: 10_000, period: 86_400_000 },
  ];
  await prisma.$transaction(async (tx) => {
    for (const limit of limits) {
      const row = await tx.headlessRateLimit.upsert({
        where: { key: limit.key },
        create: { key: limit.key, count: 1, resetsAt: new Date((Math.floor(now / limit.period) + 1) * limit.period) },
        update: { count: { increment: 1 } },
      });
      if (row.count > limit.max) throw new HeadlessRequestError("rate_limited", "API rate limit exceeded.", 429);
    }
    await tx.headlessRateLimit.deleteMany({ where: { resetsAt: { lt: new Date(now) } } });
  });
}

export async function handleHeadlessRequest(request: Request, tokenType: string, operation: string) {
  const requestId = randomUUID();
  const headers = new Headers({ "Cache-Control": "no-store", "X-Request-ID": requestId, Vary: "Origin", "X-Content-Type-Options": "nosniff" });
  const json = (body: Record<string, unknown>, status = 200) => Response.json({ ...body, request_id: requestId }, { status, headers });
  try {
    if (tokenType !== "public" && tokenType !== "private") throw new HeadlessRequestError("not_found", "Unknown API endpoint.", 404);
    const scope = `delivery:${operation}` as HeadlessReadScope;
    if (!["check", "estimate", "batch", "methods"].includes(operation)) throw new HeadlessRequestError("not_found", "Unknown API operation.", 404);
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") {
      // Preflight never grants data access; the actual request validates token-bound origins.
      if (tokenType !== "public" || !origin || origin === "null") throw new HeadlessRequestError("origin_denied", "Origin is not allowed.", 403);
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type, X-Incode-Public-Token");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      headers.set("Allow", "POST, OPTIONS");
      throw new HeadlessRequestError("method_not_allowed", "Use POST.", 405);
    }
    const raw = tokenType === "public" ? request.headers.get("x-incode-public-token") : request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (!raw || raw.length > 150 || !raw.startsWith(`hdt_${tokenType}_`)) throw new HeadlessRequestError("invalid_token", "Invalid API token.", 401);
    const token = await prisma.headlessApiToken.findUnique({ where: { tokenHash: hashHeadlessToken(raw) } });
    if (!token || token.tokenType !== tokenType || !token.enabled || token.revokedAt || (token.expiresAt && token.expiresAt <= new Date())) {
      throw new HeadlessRequestError("invalid_token", "Invalid or expired API token.", 401);
    }
    if (tokenType === "public") {
      const allowed = JSON.parse(token.allowedOriginsJson) as string[];
      if (!origin || !allowed.includes(origin)) throw new HeadlessRequestError("origin_denied", "Origin is not allowed.", 403);
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Expose-Headers", "X-Request-ID, Retry-After");
    } else if (origin) {
      throw new HeadlessRequestError("private_token_browser_use", "Private tokens must only be used server-to-server.", 403);
    }
    if (!token.scopesCsv.split(",").includes(scope)) throw new HeadlessRequestError("scope_denied", "Token does not permit this operation.", 403);
    await consumeLimits(token.id, token.shop, tokenType);
    const installed = await prisma.session.findFirst({ where: { shop: token.shop, isOnline: false } });
    if (!installed) throw new HeadlessRequestError("app_not_installed", "App access is unavailable.", 403);
    const { admin } = await unauthenticated.admin(token.shop);
    const access = await resolvePlanAccess({ shop: token.shop, admin });
    if (!access.active) throw new HeadlessRequestError("subscription_required", "An active subscription is required.", 402);
    const body = await readBody(request);
    let result: unknown;
    if (operation === "batch") {
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new HeadlessRequestError("invalid_batch", "A batch object is required.");
      const input = body as Record<string, unknown>;
      if (Object.keys(input).some((key) => !["country", "items"].includes(key)) || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 24) throw new HeadlessRequestError("invalid_batch", "Use country and 1 to 24 items.");
      const seenKeys = new Set<string>();
      const countryInput = parseHeadlessDeliveryInput({ country: input.country }, true);
      const parsed = parseProductEstimateBatch({ items: input.items.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new HeadlessRequestError("invalid_batch", "Invalid batch item.");
        const row = item as Record<string, unknown>;
        if (Object.keys(row).some((key) => !["key", "product_id"].includes(key))) throw new HeadlessRequestError("invalid_batch", "Batch items accept only key and product_id.");
        if (typeof row.key !== "string" || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(row.key) || seenKeys.has(row.key)) throw new HeadlessRequestError("invalid_batch", "Use unique lowercase alphanumeric or hyphenated keys.");
        seenKeys.add(row.key);
        const product = parseHeadlessDeliveryInput({ country: input.country, product_id: row.product_id }, true);
        if (!product.productId) throw new HeadlessRequestError("invalid_batch", "product_id is required.");
        return { key: row.key, productId: product.productId };
      }) });
      if (parsed.error) throw new HeadlessRequestError("invalid_batch", "Use 1 to 24 products with unique keys.");
      const contexts = await resolveShopifyProductContexts(admin, parsed.items);
      const items = canonicalBatchItems(parsed.items, contexts);
      if (items.length !== parsed.items.length) throw new HeadlessRequestError("invalid_product_context", "A product could not be verified.");
      result = await getProductCardDeliveryEstimates({ shop: token.shop, country: countryInput.country, admin, features: access.features }, items, { requireMatchedTarget: false });
    } else {
      const input = parseHeadlessDeliveryInput(body, operation === "estimate");
      if (operation !== "estimate" && !validatePostalCode(input.country, input.postalCode ?? "")) throw new HeadlessRequestError("invalid_postal_code", "Invalid postal code for country.");
      const resolved = await resolveShopifyProductContexts(admin, [input]);
      const product = canonicalProductFor(resolved, input.productId, input.variantId);
      if ((input.productId || input.variantId) && !product) throw new HeadlessRequestError("invalid_product_context", "Product or variant could not be verified.");
      const variantId = input.variantId && !input.variantId.startsWith("gid://") ? `gid://shopify/ProductVariant/${input.variantId}` : input.variantId;
      const context = { ...input, variantId, shop: token.shop, admin, features: access.features, trackAnalytics: false,
        productId: product?.id, productVendor: product?.vendor, productTags: product?.tags, collectionHandles: product?.collectionHandles };
      if (operation === "estimate") result = await getGeneralDeliveryEstimate(context);
      else {
        const checked = await checkDelivery(context);
        result = operation === "methods" ? { available: checked.available, shipping_methods: checked.shipping_methods ?? [] } : checked;
      }
    }
    await prisma.headlessApiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
    return json({ success: true, data: result });
  } catch (error) {
    if (error instanceof HeadlessRequestError) {
      if (error.status === 429) headers.set("Retry-After", "60");
      return json({ success: false, error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ success: false, error: { code: "temporarily_unavailable", message: "Delivery API is temporarily unavailable. Please retry." } }, 503);
  }
}
