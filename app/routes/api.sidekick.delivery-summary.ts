import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { resolvePlanAccess } from "../services/partner-api.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session, cors } = await authenticate.admin(request);
  const shop = session.shop;
  const access = await resolvePlanAccess({ shop, admin });
  const [settings, postalRules, zones, targets, locations, shippingMethods, recentChecks, availableChecks] = await Promise.all([
    prisma.deliverySetting.findUnique({ where: { shop } }),
    prisma.postalCode.count({ where: { shop } }),
    prisma.zone.count({ where: { shop, enabled: true } }),
    prisma.deliveryTarget.count({ where: { shop, enabled: true } }),
    prisma.fulfillmentLocationRule.count({ where: { shop, enabled: true } }),
    prisma.shippingMethodRule.count({ where: { shop, enabled: true } }),
    prisma.postalCodeSearchEvent.count({ where: { shop, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    prisma.postalCodeSearchEvent.count({ where: { shop, available: true, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);

  return cors(Response.json({
    shop,
    plan: {
      name: access.planName,
      advanced: access.plan === "advanced",
    },
    configuration: {
      postalRules,
      activeZones: access.features.zones ? zones : 0,
      activeProductRules: access.features.targeting ? targets : 0,
      activeFulfillmentLocations: access.features.inventory ? locations : 0,
      activeShippingMethods: access.features.deliveryOptions ? shippingMethods : 0,
      inventoryAware: access.features.inventory && (settings?.inventoryAwareEnabled ?? false),
      processingDays: settings?.processingDays ?? 0,
      defaultTransitDays: settings?.fallbackDays ?? 5,
      cutoffHour: settings?.cutoffHour24 ?? 14,
      timeZone: settings?.timeZone ?? "UTC",
    },
    performanceLast30Days: {
      checks: recentChecks,
      availableChecks,
      availabilityRate: recentChecks ? Math.round((availableChecks / recentChecks) * 1000) / 10 : null,
    },
    results: [
      { url: "app://delivery-settings" },
      { url: "app://locations" },
      { url: "app://shipping-methods" },
      { url: "app://analytics" },
    ],
  }));
}
