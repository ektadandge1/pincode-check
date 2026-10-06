import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireActiveBilling } from "../services/billing.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await requireActiveBilling(request);
  const params = new URL(request.url).searchParams;
  const zoneId = Number(params.get("zoneId"));
  const requestedPage = Number(params.get("page") ?? 1);
  const search = (params.get("search") ?? "").trim().slice(0, 100);
  const pageSize = 25;
  if (!Number.isSafeInteger(zoneId) || zoneId <= 0 || !Number.isSafeInteger(requestedPage) || requestedPage <= 0) {
    return { ok: false as const, message: "Invalid zone or page.", zoneId, search };
  }
  return prisma.$transaction(async (tx) => {
    const zone = await tx.zone.findFirst({ where: { id: zoneId, shop: session.shop } });
    if (!zone) return { ok: false as const, message: "Zone not found.", zoneId, search };
    const where = {
      shop: session.shop,
      zoneId,
      ...(search ? { OR: [
        { postalCode: { contains: search } }, { country: { contains: search.toUpperCase() } },
        { city: { contains: search } }, { state: { contains: search } },
      ] } : {}),
    };
    const total = await tx.postalCode.count({ where });
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const rules = await tx.postalCode.findMany({
      where,
      orderBy: [{ country: "asc" }, { postalCode: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { ok: true as const, zoneId, zone, rules, total, page, pageSize, search };
  });
}
