import {
  accessForPlan,
  NO_PLAN_ACCESS,
  planFromItemHandles,
  type PlanAccess,
  type PlanKey,
} from "./plans.server";

type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type ActiveSubscription = {
  billingPeriod: string;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  items: Array<{ handle: string }>;
};

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { expiresAt: number; access: PlanAccess }>();

function developmentAccess(): PlanAccess | null {
  if (process.env.NODE_ENV === "production") return null;
  const plan = String(process.env.BILLING_DEV_PLAN ?? "advanced").toLowerCase();
  if (plan === "none") return NO_PLAN_ACCESS;
  if (plan === "basic" || plan === "advanced") return accessForPlan(plan as PlanKey);
  return accessForPlan("advanced");
}

async function getShopId(admin: AdminClient): Promise<string> {
  const response = await admin.graphql(`#graphql
    query ShopIdForAppPricing {
      shop { id }
    }
  `);
  if (!response.ok) throw new Error("Unable to resolve the shop for billing.");
  const json = (await response.json()) as { data?: { shop?: { id?: string } }; errors?: unknown };
  const shopId = json.data?.shop?.id;
  if (!shopId || json.errors) throw new Error("Shopify did not return a shop ID for billing.");
  return shopId;
}

async function fetchActiveSubscription(shopId: string): Promise<ActiveSubscription | null> {
  const organizationId = process.env.SHOPIFY_PARTNER_ORG_ID;
  const accessToken = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN;
  const appId = process.env.SHOPIFY_APP_GID;
  if (!organizationId || !accessToken || !appId) {
    throw new Error("Shopify App Pricing is not configured. Set Partner API billing environment variables.");
  }

  const response = await fetch(
    `https://partners.shopify.com/${encodeURIComponent(organizationId)}/api/2026-07/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `query ActivePlan($appId: ID!, $shopId: ID!) {
          activeSubscription(appId: $appId, shopId: $shopId) {
            billingPeriod
            cancelAtEndOfCycle
            trialEndsAt
            items { handle }
          }
        }`,
        variables: { appId, shopId },
      }),
    },
  );
  const json = (await response.json()) as {
    data?: { activeSubscription?: ActiveSubscription | null };
    errors?: unknown;
  };
  if (!response.ok || json.errors) {
    throw new Error(`Partner API billing check failed: ${JSON.stringify(json.errors ?? response.status)}`);
  }
  return json.data?.activeSubscription ?? null;
}

export async function resolvePlanAccess({
  shop,
  admin,
  forceRefresh = false,
}: {
  shop: string;
  admin?: AdminClient;
  forceRefresh?: boolean;
}): Promise<PlanAccess> {
  const devAccess = developmentAccess();
  if (devAccess) return devAccess;
  if (!admin) return NO_PLAN_ACCESS;

  const cached = cache.get(shop);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.access;

  const shopId = await getShopId(admin);
  const subscription = await fetchActiveSubscription(shopId);
  if (!subscription) {
    cache.set(shop, { expiresAt: Date.now() + 30_000, access: NO_PLAN_ACCESS });
    return NO_PLAN_ACCESS;
  }

  const plan = planFromItemHandles(subscription.items.map((item) => item.handle));
  if (!plan) throw new Error("The active Shopify subscription uses an unknown plan item handle.");

  const access: PlanAccess = {
    ...accessForPlan(plan),
    trialEndsAt: subscription.trialEndsAt,
    cancelAtEndOfCycle: subscription.cancelAtEndOfCycle,
    billingPeriod: subscription.billingPeriod,
  };
  cache.set(shop, { expiresAt: Date.now() + CACHE_TTL_MS, access });
  return access;
}

export function clearPlanAccessCache(shop: string): void {
  cache.delete(shop);
}
