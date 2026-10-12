import {
  authenticate,
  STARTUP_PLAN,
  STARTUP_PLAN_NAME,
} from "../shopify.server";
import { isBillingRequired } from "./billing-config.server";

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
  const response = await admin.graphql(`#graphql
    query ActiveAppSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          test
          trialDays
          createdAt
          currentPeriodEnd
        }
      }
    }
  `);
  const payload = (await response.json()) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: ActiveAppSubscription[] } };
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || payload.errors?.length || !payload.data?.currentAppInstallation) {
    throw new Error(payload.errors?.[0]?.message ?? "Unable to verify the Shopify subscription.");
  }
  return (payload.data.currentAppInstallation.activeSubscriptions ?? [])
    .filter((subscription) => subscription.status === "ACTIVE" && subscription.name === STARTUP_PLAN);
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
        message: `An active ${STARTUP_PLAN_NAME} subscription is required.`,
      },
      { status: 402, headers: { "Cache-Control": "no-store" } },
    ));
  }

  throw context.redirect("/app/plans");
}

export function billingRequiredResponse(): Response {
  return Response.json(
    {
      error: "BILLING_REQUIRED",
      message: `An active ${STARTUP_PLAN_NAME} subscription is required.`,
    },
    { status: 402, headers: { "Cache-Control": "no-store" } },
  );
}
