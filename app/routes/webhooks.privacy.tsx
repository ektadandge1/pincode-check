import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (topic === "shop/redact") {
    await db.$transaction([
      db.postalCode.deleteMany({ where: { shop } }),
      db.deliverySetting.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
    ]);
  }

  return new Response(null, { status: 200 });
};
