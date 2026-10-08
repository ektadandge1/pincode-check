import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  checkDelivery,
  checkCartDelivery,
  checkDeliveryPolicy,
  getGeneralDeliveryEstimate,
  getGeneralCartDeliveryEstimate,
  checkCartDeliveryPolicy,
  getProductCardDeliveryEstimates,
  parseCodRequestParam,
} from "../services/delivery-checker.server";
import { authenticate } from "../shopify.server";
import { parseListParam, parseProductEstimateBatch } from "../utils/targeting.server";
import {
  resolveShopifyProductContexts,
  canonicalProductFor,
  canonicalBatchItems,
} from "../services/product-context.server";
import { parseCartDeliveryItems } from "../utils/delivery.server";
import { resolvePlanAccess } from "../services/plan-access.server";
import { billingRequiredResponse } from "../services/billing.server";
import prisma from "../db.server";
import { countdownVisible } from "../utils/countdown-visibility";
import { COUNTRY_CODES } from "../utils/countries";
import { getPickupOptions } from "../services/pickup-options.server";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 120;
const lookupWindows = new Map<string, { count: number; resetsAt: number }>();

function storefrontStyle(setting: Awaited<ReturnType<typeof prisma.deliverySetting.findUnique>>) {
  const etaSections = new Set(
    setting?.storefrontEtaDisplayMode === "both"
      ? ["date", "journey"]
      : String(setting?.storefrontEtaDisplayMode ?? "date,journey").split(",").filter(Boolean),
  );
  if (setting?.countdownEnabled ?? true) etaSections.add("countdown");
  return {
    font_family: setting?.storefrontFontFamily ?? "system",
    font_size: setting?.storefrontFontSize ?? 14,
    heading_size: setting?.storefrontHeadingSize ?? 18,
    text_color: setting?.storefrontTextColor ?? "#16151a",
    muted_color: setting?.storefrontMutedColor ?? "#667085",
    accent_color: setting?.storefrontAccentColor ?? "#2b2640",
    button_color: setting?.storefrontButtonColor ?? "#2b2640",
    button_text_color: setting?.storefrontButtonTextColor ?? "#ffffff",
    card_background: setting?.storefrontCardBackground ?? "#ffffff",
    field_background: setting?.storefrontFieldBackground ?? "#ffffff",
    field_border_color: setting?.storefrontFieldBorderColor ?? "#d7d9dd",
    result_background: setting?.storefrontResultBackground ?? "#171717",
    result_text_color: setting?.storefrontResultTextColor ?? "#ffffff",
    journey_background: setting?.storefrontJourneyBackground ?? "#e6edff",
    journey_active_color: setting?.storefrontJourneyActiveColor ?? "#9bb8f2",
    journey_line_color: setting?.storefrontJourneyLineColor ?? "#f28c52",
    journey_line_style: setting?.storefrontJourneyLineStyle ?? "dotted",
    template: setting?.storefrontTemplate ?? "modern-card",
    border_radius: setting?.storefrontBorderRadius ?? 14,
    icon_style: setting?.storefrontIconStyle ?? "number",
    animation: setting?.storefrontAnimation ?? "soft",
    show_journey: setting?.storefrontShowJourney ?? true,
    eta_display_mode: ["date", "journey", "countdown"].filter((section) => etaSections.has(section)).join(",") || "date,journey",
    countdown_background: setting?.storefrontCountdownBackground ?? "#06451f",
    countdown_digit_color: setting?.storefrontCountdownDigitColor ?? "#ff6500",
    countdown_text_color: setting?.storefrontCountdownTextColor ?? "#ffffff",
    countdown_title: setting?.storefrontCountdownTitle ?? "Order cutoff countdown",
    show_countdown: setting?.countdownEnabled ?? true,
    custom_css: setting?.storefrontCustomCss ?? "",
    shipping_method_display_style: setting?.shippingMethodDisplayStyle === "dropdown" ? "dropdown" : "visual",
  };
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  for (const [entryKey, entry] of lookupWindows) {
    if (entry.resetsAt <= now) lookupWindows.delete(entryKey);
  }
  const current = lookupWindows.get(key);
  if (!current || current.resetsAt <= now) {
    lookupWindows.set(key, { count: 1, resetsAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT_REQUESTS;
}

export async function action({ request }: ActionFunctionArgs) {
  const proxyContext = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = proxyContext.session?.shop ?? (url.searchParams.get("shop") ?? undefined);
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (isRateLimited(`${shop ?? "unknown"}|${forwardedFor}`)) {
    return Response.json(
      { enabled: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }
  if (url.searchParams.get("batch") !== "1") {
    return Response.json({ enabled: false, error: "unsupported_request" }, { status: 400 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 65_536) {
    return Response.json({ enabled: false, error: "invalid_batch" }, { status: 413 });
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 65_536) {
      return Response.json({ enabled: false, error: "invalid_batch" }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ enabled: false, error: "invalid_batch" }, { status: 400 });
  }
  const parsed = parseProductEstimateBatch(body);
  if (parsed.error) {
    return Response.json(
      { enabled: false, error: parsed.error },
      { status: parsed.error === "too_many_items" ? 413 : 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let access = null;
  try {
    access = shop
      ? await resolvePlanAccess({ shop, admin: proxyContext.admin })
      : null;
  } catch {
    return Response.json(
      { enabled: false, error: "temporarily_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
    );
  }
  if (!access?.active) {
    return billingRequiredResponse();
  }

  let canonicalItems: ReturnType<typeof canonicalBatchItems>;
  try {
    const resolved = await resolveShopifyProductContexts(proxyContext.admin, parsed.items);
    canonicalItems = canonicalBatchItems(parsed.items, resolved);
  } catch {
    return Response.json(
      { enabled: false, error: "product_context_unavailable", results: [] },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
    );
  }
  if (canonicalItems.length !== parsed.items.length) {
    return Response.json(
      { enabled: false, error: "invalid_product_context", results: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const setting = await prisma.deliverySetting.findUnique({ where: { shop } });
  const style = storefrontStyle(setting);
  const country = typeof (body as { country?: unknown }).country === "string"
    ? (body as { country: string }).country.slice(0, 2)
    : undefined;
  const postalCode = typeof (body as { postal_code?: unknown }).postal_code === "string"
    ? (body as { postal_code: string }).postal_code.trim().slice(0, 30)
    : undefined;

  try {
    const results = await getProductCardDeliveryEstimates({
      shop,
      country,
      postalCode,
      features: access.features,
      admin: proxyContext.admin,
    }, canonicalItems);
    return Response.json(
      { enabled: true, results, storefront_style: style },
      { headers: { "Cache-Control": "private, max-age=0, s-maxage=60" } },
    );
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return Response.json(
      { enabled: false, error: "configuration_error", results: [], storefront_style: style },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const proxyContext = await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const country = url.searchParams.get("country") ?? undefined;
  if (country !== undefined && !COUNTRY_CODES.has(country.trim().toUpperCase() === "UK" ? "GB" : country.trim().toUpperCase())) {
    return Response.json({ enabled: false, available: false, reason: "invalid_country", message: "Choose a valid country." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const postalCode =
    url.searchParams.get("postal_code") ??
    url.searchParams.get("postalCode") ??
    url.searchParams.get("pincode") ??
    "";
  const cod = parseCodRequestParam(url.searchParams.get("cod"));
  const variantId = url.searchParams.get("variantId") ?? undefined;
  const quantityRaw = Number(url.searchParams.get("qty") ?? "1");
  const quantity = Number.isFinite(quantityRaw) ? quantityRaw : 1;
  const productId = url.searchParams.get("productId") ?? undefined;
  const productTags = parseListParam(url.searchParams.get("productTags"));
  const productVendor = url.searchParams.get("productVendor")?.slice(0, 100) ?? undefined;
  const collectionHandles = parseListParam(url.searchParams.get("collections"));
  const surface = url.searchParams.get("surface") ?? "product";
  const isInit = url.searchParams.get("init") === "1";
  const isEstimate = url.searchParams.get("estimate") === "1";
  const isServiceOptions = url.searchParams.get("service_options") === "1";
  const countdownOverride = url.searchParams.get("countdown") === "1" ? true
    : url.searchParams.get("countdown") === "0" ? false : undefined;
  const requireTarget = url.searchParams.get("targeted") === "1";
  const cart = parseCartDeliveryItems(url.searchParams.get("cartItems"));
  const shop = proxyContext.session?.shop ?? (url.searchParams.get("shop") ?? undefined);
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (isRateLimited(`${shop ?? "unknown"}|${forwardedFor}`)) {
    return Response.json(
      { available: false, message: "Too many delivery checks. Please wait a minute and try again." },
      { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
    );
  }

  let context = {
    shop,
    country,
    variantId,
    quantity,
    productId,
    productTags,
    productVendor,
    collectionHandles,
    admin: proxyContext.admin,
  };

  let access = null;
  try {
    access = shop
      ? await resolvePlanAccess({ shop, admin: proxyContext.admin })
      : null;
  } catch {
    return Response.json(
      {
        enabled: false,
        available: false,
        source: "none",
        message: "",
        disable_add_to_cart: false,
        require_valid_pin: false,
      },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
    );
  }
  if (!access?.active) {
    return billingRequiredResponse();
  }

  let canonicalCartItems = cart.items;
  const cartRequest = cart.provided || surface === "cart";
  if (cart.error || (cartRequest && (!cart.provided || !cart.items.length || ((isEstimate || isInit || isServiceOptions) && !cart.complete)))) {
    return Response.json({
      enabled: false,
      available: false,
      source: "none",
      reason: cart.error || !cart.provided || !cart.items.length ? "invalid_cart" : "cart_incomplete",
      cart_complete: false,
      cart_items_checked: 0,
      disable_add_to_cart: true,
      require_valid_pin: true,
      message: "Full cart delivery context could not be verified.",
    }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const contextInputs = [
    { productId, variantId },
    ...cart.items.map((item) => ({ productId: item.productId, variantId: item.variantId })),
  ].filter((item) => item.productId || item.variantId);
  if (contextInputs.length) {
    let resolved: Awaited<ReturnType<typeof resolveShopifyProductContexts>>;
    try {
      resolved = await resolveShopifyProductContexts(proxyContext.admin, contextInputs);
    } catch {
      return Response.json(
        { enabled: false, available: false, source: "none", reason: "product_context_unavailable", ...(cartRequest ? { cart_complete: false } : {}), disable_add_to_cart: true, require_valid_pin: true, message: "Delivery details are temporarily unavailable." },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
      );
    }

    const pageProduct = productId || variantId ? canonicalProductFor(resolved, productId, variantId) : null;
    if ((productId || variantId) && !pageProduct) {
      return Response.json(
        { enabled: false, available: false, source: "none", reason: "invalid_product_context", ...(cartRequest ? { cart_complete: false } : {}), disable_add_to_cart: true, require_valid_pin: true, message: "This product could not be verified." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (pageProduct) {
      context = {
        ...context,
        productId: pageProduct.id,
        productVendor: pageProduct.vendor,
        productTags: pageProduct.tags,
        collectionHandles: pageProduct.collectionHandles,
      };
    }

    canonicalCartItems = cart.items.flatMap((item) => {
      const product = canonicalProductFor(resolved, item.productId, item.variantId);
      if (!product) return [];
      return [{
        ...item,
        productId: product.id,
        productVendor: product.vendor,
        productTags: product.tags,
        collectionHandles: product.collectionHandles,
      }];
    });
    if (canonicalCartItems.length !== cart.items.length) {
      return Response.json(
        { enabled: false, available: false, source: "none", reason: "invalid_cart", cart_complete: false, disable_add_to_cart: true, require_valid_pin: true, message: "One or more cart products could not be verified." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const setting = await prisma.deliverySetting.findUnique({ where: { shop } });
  if (isServiceOptions) {
    try {
      const options = await getPickupOptions({
        shop, admin: proxyContext.admin, country, postalCode,
        items: cartRequest ? canonicalCartItems : [{ ...context, quantity: quantityRaw }],
        complete: cartRequest ? cart.complete : true, timeZone: setting?.timeZone ?? "UTC",
        pickupLocationId: url.searchParams.get("pickup_location_id"), pickupDate: url.searchParams.get("pickup_date"),
      });
      return Response.json(options, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ pickup_locations: [], message: "Pickup details could not be verified.",
        ...(url.searchParams.has("pickup_location_id") || url.searchParams.has("pickup_date") ? { pickup_selection_valid: false } : {}),
      }, { status: error instanceof RangeError ? 400 : 503, headers: { "Cache-Control": "no-store" } });
    }
  }
  const style = storefrontStyle(setting);

  if (isEstimate) {
    try {
      const estimateInput = { ...context, features: access.features, requireTarget };
      const estimate = cartRequest
        ? await getGeneralCartDeliveryEstimate(estimateInput, canonicalCartItems, { complete: cart.complete })
        : await getGeneralDeliveryEstimate(estimateInput);
      const estimateZoneId = "zone_id" in estimate && typeof estimate.zone_id === "number"
        ? estimate.zone_id
        : null;
      return Response.json({ ...estimate, storefront_style: style, countdown_visible: countdownVisible(setting, { ...context, zoneId: estimateZoneId }, surface, countdownOverride) }, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return Response.json({
        enabled: false,
        available: false,
        source: "none",
        reason: "configuration_error",
        message: "Delivery dates are temporarily unavailable due to an invalid schedule.",
        storefront_style: style,
        countdown_visible: countdownVisible(setting, context, surface, countdownOverride),
      }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }

  if (isInit) {
    const policyInput = { ...context, features: access.features };
    const policy = cartRequest
      ? await checkCartDeliveryPolicy(policyInput, canonicalCartItems, { complete: cart.complete })
      : await checkDeliveryPolicy(policyInput);
    return Response.json(
      {
        available: false,
        source: "none",
        ...policy,
        storefront_style: style,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const deliveryInput = {
    postalCode,
    codRequested: cod,
    features: access.features,
    ...context,
  };
  try {
    const result = cartRequest
      ? await checkCartDelivery(deliveryInput, canonicalCartItems, { complete: cart.complete })
      : await checkDelivery(deliveryInput);
    return Response.json({
      ...result,
      storefront_style: style,
      countdown_visible: countdownVisible(setting, { ...context, zoneId: result.zone_id ?? null }, surface, countdownOverride),
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return Response.json({
      available: false,
      source: "none",
      reason: "configuration_error",
      message: "Delivery dates are temporarily unavailable due to an invalid schedule.",
      storefront_style: style,
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
