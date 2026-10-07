function envFlag(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be either "true" or "false".`);
}

export function isBillingTestMode(): boolean {
  assertProductionBilling();
  // Safe by default: real charges require an explicit opt-in.
  return envFlag("SHOPIFY_BILLING_TEST", true);
}

export function isBillingRequired(): boolean {
  assertProductionBilling();
  if (
    process.env.NODE_ENV !== "production"
    && process.env.APP_ENV === "development"
    && envFlag("SHOPIFY_BILLING_DEV_BYPASS", true)
  ) {
    return false;
  }
  return envFlag("SHOPIFY_BILLING_REQUIRED", true);
}

function assertProductionBilling(): void {
  if (process.env.NODE_ENV !== "production" && process.env.APP_ENV !== "production") return;
  if (process.env.SHOPIFY_BILLING_TEST?.trim().toLowerCase() !== "false") {
    throw new Error("SHOPIFY_BILLING_TEST must be explicitly false in production.");
  }
  if (process.env.SHOPIFY_BILLING_REQUIRED?.trim().toLowerCase() !== "true") {
    throw new Error("SHOPIFY_BILLING_REQUIRED must be explicitly true in production.");
  }
  if (envFlag("SHOPIFY_BILLING_DEV_BYPASS", false)) {
    throw new Error("SHOPIFY_BILLING_DEV_BYPASS must be false or unset in production.");
  }
}
