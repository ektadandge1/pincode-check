export const BASIC_PLAN = "Basic";
export const STARTER_PLAN = "Starter";
export const ADVANCED_PLAN = "Advanced";

export const BILLING_PLANS = [BASIC_PLAN, STARTER_PLAN, ADVANCED_PLAN] as const;
export type BillingPlan = (typeof BILLING_PLANS)[number];

export const PLAN_DETAILS: Record<BillingPlan, {
  price: string;
  description: string;
  features: string[];
}> = {
  [BASIC_PLAN]: {
    price: "$7.99/month",
    description: "For small stores that need a reliable product-page delivery checker.",
    features: [
      "Product page delivery checker",
      "Country and postal/ZIP code support",
      "Manual records and CSV import",
      "Custom delivery days and COD status",
      "Holiday, weekend, and cutoff rules",
      "Up to 2,000 records",
    ],
  },
  [STARTER_PLAN]: {
    price: "$19.99/month",
    description: "For growing stores managing delivery coverage with spreadsheets.",
    features: [
      "Everything in Basic",
      "CSV export and failed-row reports",
      "Google Sheet manual sync",
      "Delivery charges and custom messages",
      "Add-to-Cart blocking",
      "Basic analytics",
      "Up to 100,000 records",
    ],
  },
  [ADVANCED_PLAN]: {
    price: "$49.99/month",
    description: "For high-volume stores that need higher limits and advanced operations.",
    features: [
      "Everything in Starter",
      "Higher record limits",
      "Advanced analytics ready",
      "Priority operations workflow",
      "API and automation roadmap access",
    ],
  },
};

export type PlanFeatures = {
  maxPostalCodes: number;
  csvExport: boolean;
  googleSheetSync: boolean;
  importReports: boolean;
  customMessages: boolean;
  deliveryCharges: boolean;
  disableAddToCart: boolean;
  analytics: boolean;
};

export const PLAN_FEATURES: Record<BillingPlan, PlanFeatures> = {
  [BASIC_PLAN]: {
    maxPostalCodes: 2_000,
    csvExport: false,
    googleSheetSync: false,
    importReports: false,
    customMessages: false,
    deliveryCharges: false,
    disableAddToCart: true,
    analytics: false,
  },
  [STARTER_PLAN]: {
    maxPostalCodes: 100_000,
    csvExport: true,
    googleSheetSync: true,
    importReports: true,
    customMessages: true,
    deliveryCharges: true,
    disableAddToCart: true,
    analytics: true,
  },
  [ADVANCED_PLAN]: {
    maxPostalCodes: 500_000,
    csvExport: true,
    googleSheetSync: true,
    importReports: true,
    customMessages: true,
    deliveryCharges: true,
    disableAddToCart: true,
    analytics: true,
  },
};

export function isBillingPlan(value: string | null | undefined): value is BillingPlan {
  return BILLING_PLANS.includes(value as BillingPlan);
}

export function getPlanFeatures(plan: string | null | undefined): PlanFeatures {
  return isBillingPlan(plan) ? PLAN_FEATURES[plan] : PLAN_FEATURES[BASIC_PLAN];
}

export function getBillingTestMode() {
  if (process.env.SHOPIFY_BILLING_TEST) {
    return process.env.SHOPIFY_BILLING_TEST === "true";
  }
  return process.env.NODE_ENV !== "production";
}
