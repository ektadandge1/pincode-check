import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (topic === "SHOP_REDACT") {
    const importJobs = await db.importJob.findMany({ where: { shop }, select: { id: true } });
    await db.$transaction([
      db.importError.deleteMany({ where: { importJobId: { in: importJobs.map((job) => job.id) } } }),
      db.importJob.deleteMany({ where: { shop } }),
      db.postalCodeSearchEvent.deleteMany({ where: { shop } }),
      db.postalCode.deleteMany({ where: { shop } }),
      db.deliveryTarget.deleteMany({ where: { shop } }),
      db.fulfillmentLocationRule.deleteMany({ where: { shop } }),
      db.shippingMethodRule.deleteMany({ where: { shop } }),
      db.zone.deleteMany({ where: { shop } }),
      db.deliverySetting.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
    ]);
  }

  return new Response(null, { status: 200 });
};
