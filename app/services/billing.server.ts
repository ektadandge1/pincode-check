import { redirect } from "react-router";
import {
  authenticate,
  STANDARD_PLAN,
} from "../shopify.server";
import { isBillingRequired } from "./billing-config.server";
import { getPartnerSubscription } from "./partner-billing.server";

export { isBillingRequired } from "./billing-config.server";

type AdminAuthContext = Awaited<ReturnType<typeof authenticate.admin>>;
type AdminClient = AdminAuthContext["admin"];
const billingStatusCache = new Map<string, { active: boolean; expiresAt: number }>();
const billingStatusRequests = new Map<string, Promise<boolean>>();

export type ActiveAppSubscription = {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  createdAt: string;
  currentPeriodEnd: string;
};

export async function getActiveAppSubscriptions(
  admin: AdminClient,
): Promise<ActiveAppSubscription[]> {
  const subscription = await getPartnerSubscription(admin);
  if (!subscription) return [];
  return [{
    id: "shopify-app-pricing",
    name: STANDARD_PLAN,
    status: "ACTIVE",
    test: false,
    trialDays: subscription.trialEndsAt ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / 86_400_000)) : 0,
    createdAt: subscription.currentBillingCycle?.startTime ?? "",
    currentPeriodEnd: subscription.currentBillingCycle?.endTime ?? subscription.trialEndsAt ?? "",
  }];
}

export async function hasActiveBilling(admin: AdminClient): Promise<boolean> {
  return (await getActiveAppSubscriptions(admin)).length > 0;
}

export async function getCachedBillingStatus({
  shop,
  admin,
  forceRefresh = false,
}: {
  shop: string;
  admin: AdminClient;
  forceRefresh?: boolean;
}): Promise<boolean> {
  const now = Date.now();
  const cached = billingStatusCache.get(shop);
  if (!forceRefresh && cached && cached.expiresAt > now) return cached.active;

  const pending = billingStatusRequests.get(shop);
  if (!forceRefresh && pending) return pending;

  const request = hasActiveBilling(admin).then((active) => {
    billingStatusCache.set(shop, {
      active,
      expiresAt: Date.now() + (active ? 60_000 : 10_000),
    });
    return active;
  }).finally(() => {
    if (billingStatusRequests.get(shop) === request) billingStatusRequests.delete(shop);
  });
  billingStatusRequests.set(shop, request);
  return request;
}

export function clearBillingStatusCache(shop: string): void {
  billingStatusCache.delete(shop);
  billingStatusRequests.delete(shop);
}

export async function requireActiveBilling(
  request: Request,
  options: { api?: boolean } = {},
): Promise<AdminAuthContext> {
  const context = await authenticate.admin(request);
  if (!isBillingRequired() || await getCachedBillingStatus({
    shop: context.session.shop,
    admin: context.admin,
  })) return context;

  if (options.api) {
    throw context.cors(Response.json(
      {
        error: "BILLING_REQUIRED",
        message: `An active ${STANDARD_PLAN} subscription is required.`,
      },
      { status: 402, headers: { "Cache-Control": "no-store" } },
    ));
  }

  throw redirect("/app/plans");
}

export function billingRequiredResponse(): Response {
  return Response.json(
    {
      error: "BILLING_REQUIRED",
      message: `An active ${STANDARD_PLAN} subscription is required.`,
    },
    { status: 402, headers: { "Cache-Control": "no-store" } },
  );
}
