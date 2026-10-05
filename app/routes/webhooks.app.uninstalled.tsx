import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { clearPlanAccessCache } from "../services/partner-api.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  // Uninstall webhooks are idempotent and can arrive after a session expires.
  await db.session.deleteMany({ where: { shop } });
  clearPlanAccessCache(shop);

  return new Response(null, { status: 200 });
};
