export const STANDARD_PLAN_KEY = "standard" as const;
export type PlanKey = typeof STANDARD_PLAN_KEY;

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

export const STANDARD_FEATURES: PlanFeatures = {
  exactRules: true,
  csvImport: true,
  deliveryDates: true,
  cod: true,
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
    Object.keys(STANDARD_FEATURES).map((feature) => [feature, false]),
  ) as PlanFeatures,
  trialEndsAt: null,
  cancelAtEndOfCycle: false,
  billingPeriod: null,
};

export function accessForPlan(plan: PlanKey): PlanAccess {
  return {
    active: true,
    plan,
    planName: "Standard",
    features: STANDARD_FEATURES,
    trialEndsAt: null,
    cancelAtEndOfCycle: false,
    billingPeriod: "EVERY_30_DAYS",
  };
}

export function requireFeature(access: PlanAccess, feature: keyof PlanFeatures): void {
  if (!access.active || !access.features[feature]) {
    throw new Response("An active Standard subscription is required.", { status: 402 });
  }
}
