function envFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either "true" or "false".`);
}

export function isBillingTestMode(): boolean {
  // Safe by default: real charges require an explicit opt-in.
  return envFlag("SHOPIFY_BILLING_TEST", true);
}

export function isBillingRequired(): boolean {
  if (
    process.env.APP_ENV === "development"
    && envFlag("SHOPIFY_BILLING_DEV_BYPASS", true)
  ) {
    return false;
  }
  return envFlag("SHOPIFY_BILLING_REQUIRED", true);
}
