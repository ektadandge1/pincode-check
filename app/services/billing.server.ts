import { redirect } from "react-router";
import prisma from "../db.server";
import {
  BILLING_PLANS,
  type BillingPlan,
  getBillingTestMode,
  getPlanFeatures,
  isBillingPlan,
} from "./plans.server";

export type BillingContext = {
  check: (options?: { plans?: string[]; isTest?: boolean }) => Promise<{
    hasActivePayment: boolean;
    appSubscriptions?: BillingSubscription[];
  }>;
};

export type ActiveBilling = {
  plan: BillingPlan | null;
  hasActivePayment: boolean;
  subscriptionId: string | null;
  features: ReturnType<typeof getPlanFeatures>;
};

type BillingSubscription = { id: string; name: string; status?: string };

export async function getActiveBilling(shop: string, billing: BillingContext): Promise<ActiveBilling> {
  const check = await billing.check({ plans: [...BILLING_PLANS], isTest: getBillingTestMode() });
  const appSubscriptions = (check.appSubscriptions ?? []) as BillingSubscription[];
  const subscription = appSubscriptions.find((item) => isBillingPlan(item.name));
  const plan = subscription && isBillingPlan(subscription.name) ? subscription.name : null;

  if (check.hasActivePayment && plan) {
    await prisma.appSubscription.upsert({
      where: { shop },
      create: {
        shop,
        plan,
        shopifySubscriptionId: subscription?.id,
        status: subscription?.status ?? "active",
      },
      update: {
        plan,
        shopifySubscriptionId: subscription?.id,
        status: subscription?.status ?? "active",
      },
    });
  }

  return {
    plan,
    hasActivePayment: check.hasActivePayment && Boolean(plan),
    subscriptionId: subscription?.id ?? null,
    features: getPlanFeatures(plan),
  };
}

export async function requireActiveBilling(shop: string, billing: BillingContext, pathname: string) {
  const activeBilling = await getActiveBilling(shop, billing);
  const billingExempt = pathname === "/app/plans" || pathname.startsWith("/app/billing");

  if (!activeBilling.hasActivePayment && !billingExempt) {
    throw redirect("/app/plans");
  }

  return activeBilling;
}

export function requireFeature(activeBilling: ActiveBilling, feature: keyof ActiveBilling["features"]) {
  if (!activeBilling.features[feature]) {
    throw new Response("Upgrade your plan to use this feature.", { status: 402 });
  }
}
