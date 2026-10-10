import {
  clearBillingStatusCache,
  getCachedBillingStatus,
  isBillingRequired,
} from "./billing.server";
import { accessForPlan, NO_PLAN_ACCESS, type PlanAccess } from "./plans.server";

type AdminClient = Parameters<typeof getCachedBillingStatus>[0]["admin"];
const cache = new Map<string, { expiresAt: number; access: PlanAccess }>();

export async function resolvePlanAccess({
  shop,
  admin,
  forceRefresh = false,
}: {
  shop: string;
  admin?: AdminClient;
  forceRefresh?: boolean;
}): Promise<PlanAccess> {
  if (!isBillingRequired()) return accessForPlan("standard");
  if (!admin) return NO_PLAN_ACCESS;
  const cached = cache.get(shop);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.access;

  const access = await getCachedBillingStatus({ shop, admin, forceRefresh })
    ? accessForPlan("standard")
    : NO_PLAN_ACCESS;
  cache.set(shop, {
    access,
    expiresAt: Date.now() + (access.active ? 60_000 : 10_000),
  });
  return access;
}

export function clearPlanAccessCache(shop: string): void {
  cache.delete(shop);
  clearBillingStatusCache(shop);
}
