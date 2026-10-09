type PricingUrlOptions = {
  shop: string;
  appHandle: string;
};

export function shopifyPricingUrl({ shop, appHandle }: PricingUrlOptions): string {
  const shopMatch = shop.trim().toLowerCase().match(/^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/);
  if (!shopMatch) {
    throw new Error("Shopify shop domain is invalid.");
  }
  const normalizedHandle = appHandle.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(normalizedHandle)) {
    throw new Error("SHOPIFY_APP_HANDLE must be the app URL handle from Shopify App Pricing.");
  }
  return `https://admin.shopify.com/store/${encodeURIComponent(shopMatch[1])}/charges/${encodeURIComponent(normalizedHandle)}/pricing_plans`;
}
