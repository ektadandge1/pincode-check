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

export async function requireActiveBilling(
  request: Request,
  options: { api?: boolean } = {},
): Promise<AdminAuthContext> {
  const context = await authenticate.admin(request);
  if (!isBillingRequired() || await hasActiveBilling(context.admin)) return context;

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
