import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireActiveBilling } from "../services/billing.server";
import { resolvePlanAccess } from "../services/plan-access.server";
import { requireFeature } from "../services/plans.server";

function csvValue(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await requireActiveBilling(request);
  const access = await resolvePlanAccess({ shop: session.shop, admin });
  requireFeature(access, "export");
  const rows = await prisma.postalCode.findMany({
    where: { shop: session.shop },
    orderBy: [{ country: "asc" }, { patternType: "asc" }, { postalCode: "asc" }],
    include: {
      zoneGroup: { select: { name: true } },
    },
  });

  const headers = [
    "country",
    "postal_code",
    "pattern_type",
    "delivery_days",
    "serviceable",
    "cod_available",
    "delivery_charge",
    "currency",
    "city",
    "state",
    "zone",
    "same_day",
    "next_day",
    "express",
  ];

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.country,
        row.postalCode,
        row.patternType,
        row.deliveryDays,
        row.serviceable,
        row.codAvailable,
        row.deliveryCharge ?? "",
        row.currency ?? "",
        row.city ?? "",
        row.state ?? "",
        row.zoneGroup?.name ?? row.zone ?? "",
        row.sameDayAvailable,
        row.nextDayAvailable,
        row.expressAvailable,
      ]
        .map(csvValue)
        .join(","),
    ),
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="incode-track-delivery-coverage.csv"`,
    },
  });
}
