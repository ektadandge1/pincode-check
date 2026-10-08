type ShopifyPricingUrlOptions = {
  shop: string;
  appHandle: string;
};

export function shopifyPricingUrl({ shop, appHandle }: ShopifyPricingUrlOptions): string {
  const shopHandle = shop.trim().replace(/\.myshopify\.com$/i, "");
  const normalizedAppHandle = appHandle.trim();

  if (!/^[a-z0-9][a-z0-9-]*$/i.test(shopHandle)) {
    throw new Error("Cannot create the Shopify pricing URL because the shop domain is invalid.");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(normalizedAppHandle)) {
    throw new Error("SHOPIFY_APP_HANDLE must be the app URL handle from the Shopify Partner Dashboard.");
  }

  return new URL(
    `/store/${encodeURIComponent(shopHandle)}/charges/${encodeURIComponent(normalizedAppHandle)}/pricing_plans`,
    "https://admin.shopify.com",
  ).toString();
}
