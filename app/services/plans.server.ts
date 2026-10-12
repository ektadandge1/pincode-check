export const STARTUP_PLAN_KEY = "startup" as const;
export type PlanKey = typeof STARTUP_PLAN_KEY;

export type PlanFeatures = {
  exactRules: boolean;
  csvImport: boolean;
  deliveryDates: boolean;
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

export const STARTUP_FEATURES: PlanFeatures = {
  exactRules: true,
  csvImport: true,
  deliveryDates: true,
  schedule: true,
  patterns: true,
  zones: true,
  targeting: true,
  cartProtection: true,
  inventory: true,
  courier: true,
  deliveryOptions: true,
  customMessages: true,
  googleSheets: true,
  export: true,
  analytics: true,
};

// Keep the feature export stable for service callers; the paid plan is Startup.
export const STANDARD_FEATURES = STARTUP_FEATURES;

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
    Object.keys(STARTUP_FEATURES).map((feature) => [feature, false]),
  ) as PlanFeatures,
  trialEndsAt: null,
  cancelAtEndOfCycle: false,
  billingPeriod: null,
};

export function accessForPlan(plan: PlanKey): PlanAccess {
  return {
    active: true,
    plan,
    planName: "Startup",
    features: STARTUP_FEATURES,
    trialEndsAt: null,
    cancelAtEndOfCycle: false,
    billingPeriod: "EVERY_30_DAYS",
  };
}

export function requireFeature(access: PlanAccess, feature: keyof PlanFeatures): void {
  if (!access.active || !access.features[feature]) {
    throw new Response("An active Startup subscription is required.", { status: 402 });
  }
}
