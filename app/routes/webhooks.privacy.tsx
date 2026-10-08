import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { clearDeliveryCheckCaches } from "../services/delivery-checker.server";
import { clearPlanAccessCache } from "../services/plan-access.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (topic === "SHOP_REDACT") {
    clearDeliveryCheckCaches(shop);
    clearPlanAccessCache(shop);
    await db.$transaction(async (tx) => {
      const tokens = await tx.headlessApiToken.findMany({ where: { shop }, select: { id: true } });
      // Cascading ownership also rejects late error writes for deleted jobs.
      await tx.importJob.deleteMany({ where: { shop } });
      await tx.postalCodeSearchEvent.deleteMany({ where: { shop } });
      await tx.postalCode.deleteMany({ where: { shop } });
      await tx.deliveryTarget.deleteMany({ where: { shop } });
      await tx.serviceAvailabilityRule.deleteMany({ where: { shop } });
      await tx.fulfillmentLocationRule.deleteMany({ where: { shop } });
      await tx.shippingMethodRule.deleteMany({ where: { shop } });
      await tx.zone.deleteMany({ where: { shop } });
      await tx.deliverySetting.deleteMany({ where: { shop } });
      // Rate-limit keys contain shop/token IDs rather than a shop column.
      await tx.headlessRateLimit.deleteMany({ where: { OR: [
        { key: { startsWith: `shop:${shop}:` } },
        ...tokens.map(({ id }) => ({ key: { startsWith: `token:${id}:` } })),
      ] } });
      await tx.headlessApiToken.deleteMany({ where: { shop } });
      await tx.session.deleteMany({ where: { shop } });
    });
    clearDeliveryCheckCaches(shop);
  }

  // Customer topics are acknowledged: no customer ID/email/order association is
  // stored. Merchant sessions and masked lookup regions are shop-scoped;
  // cart/order attributes written through the storefront remain Shopify-owned.

  return new Response(null, { status: 200 });
};
