export const BASIC_PLAN = "basic" as const;
export const ADVANCED_PLAN = "advanced" as const;
export type PlanKey = typeof BASIC_PLAN | typeof ADVANCED_PLAN;

export type PlanFeatures = {
  exactRules: boolean;
  csvImport: boolean;
  deliveryDates: boolean;
  cod: boolean;
  schedule: boolean;
  patterns: boolean;
  zones: boolean;
  targeting: boolean;
  cartProtection: boolean;
  inventory: boolean;
  courier: boolean;
  deliveryOptions: boolean;
  customMessages: boolean;
  googleSheets: boolean;
  export: boolean;
  analytics: boolean;
};

export const BASIC_FEATURES: PlanFeatures = {
  exactRules: true,
  csvImport: true,
  deliveryDates: true,
  cod: true,
  schedule: true,
  patterns: false,
  zones: false,
  targeting: false,
  cartProtection: false,
  inventory: false,
  courier: false,
  deliveryOptions: false,
  customMessages: false,
  googleSheets: false,
  export: false,
  analytics: false,
};

export const ADVANCED_FEATURES: PlanFeatures = Object.fromEntries(
  Object.keys(BASIC_FEATURES).map((feature) => [feature, true]),
) as PlanFeatures;

export const PLAN_DETAILS = {
  basic: {
    key: BASIC_PLAN,
    name: "Basic",
    price: "$9.99",
    description: "Reliable delivery checks for stores using exact postal-code coverage.",
    features: [
      "Unlimited exact postal and ZIP code rules",
      "CSV and manual coverage imports",
      "Delivery dates and COD availability",
      "Cutoff, weekend, and holiday schedules",
      "Country-aware storefront checker",
    ],
  },
  advanced: {
    key: ADVANCED_PLAN,
    name: "Advanced",
    price: "$29.99",
    description: "Advanced targeting, automation, protection, and delivery analytics.",
    features: [
      "Everything in Basic",
      "ZIP ranges, wildcards, and priority zones",
      "Product, collection, and tag targeting",
      "Valid-PIN and unavailable-location cart protection",
      "Inventory and optional courier-aware checks",
      "Google Sheets, CSV export, and analytics",
    ],
  },
} as const;

export type PlanAccess = {
  active: boolean;
  plan: PlanKey | null;
  planName: string;
  features: PlanFeatures;
  trialEndsAt: string | null;
  cancelAtEndOfCycle: boolean;
  billingPeriod: string | null;
};

export const NO_PLAN_ACCESS: PlanAccess = {
  active: false,
  plan: null,
  planName: "No active plan",
  features: Object.fromEntries(
    Object.keys(BASIC_FEATURES).map((feature) => [feature, false]),
  ) as PlanFeatures,
  trialEndsAt: null,
  cancelAtEndOfCycle: false,
  billingPeriod: null,
};

function configuredHandles(plan: PlanKey): string[] {
  const envName = plan === BASIC_PLAN
    ? "SHOPIFY_BASIC_PLAN_HANDLES"
    : "SHOPIFY_ADVANCED_PLAN_HANDLES";
  const fallback = plan;
  return String(process.env[envName] ?? fallback)
    .split(",")
    .map((handle) => handle.trim().toLowerCase())
    .filter(Boolean);
}

export function planFromItemHandles(handles: string[]): PlanKey | null {
  const normalized = new Set(handles.map((handle) => handle.trim().toLowerCase()));
  if (configuredHandles(ADVANCED_PLAN).some((handle) => normalized.has(handle))) {
    return ADVANCED_PLAN;
  }
  if (configuredHandles(BASIC_PLAN).some((handle) => normalized.has(handle))) {
    return BASIC_PLAN;
  }
  return null;
}

export function accessForPlan(plan: PlanKey): PlanAccess {
  return {
    active: true,
    plan,
    planName: PLAN_DETAILS[plan].name,
    features: plan === ADVANCED_PLAN ? ADVANCED_FEATURES : BASIC_FEATURES,
    trialEndsAt: null,
    cancelAtEndOfCycle: false,
    billingPeriod: "EVERY_30_DAYS",
  };
}

export function storefrontPlanUrl(shop: string): string {
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "incode-track";
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/charges/${encodeURIComponent(appHandle)}/pricing_plans`;
}

export function requireFeature(access: PlanAccess, feature: keyof PlanFeatures): void {
  if (!access.active) {
    throw new Response("Select a plan to continue.", { status: 402 });
  }
  if (!access.features[feature]) {
    throw new Response("This feature requires the Advanced plan.", { status: 403 });
  }
}
