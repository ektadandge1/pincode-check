export const STOREFRONT_CUSTOM_CSS_LIMIT = 5_000;

export function isSafeStorefrontCss(value: string): boolean {
  return value.length <= STOREFRONT_CUSTOM_CSS_LIMIT
    && !/@import|url\s*\(|expression\s*\(|javascript:|<\/?(?:script|style)/i.test(value);
}
