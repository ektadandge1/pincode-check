import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { clearPlanAccessCache } from "../services/plan-access.server";
import { clearDeliveryCheckCaches } from "../services/delivery-checker.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  // Uninstall webhooks are idempotent and can arrive after a session expires.
  clearPlanAccessCache(shop);
  clearDeliveryCheckCaches(shop);
  await db.$transaction([
    db.session.deleteMany({ where: { shop } }),
    db.headlessApiToken.updateMany({ where: { shop }, data: { enabled: false, revokedAt: new Date() } }),
  ]);
  return new Response(null, { status: 200 });
};
