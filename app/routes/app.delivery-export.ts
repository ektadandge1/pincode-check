import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

function csvValue(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const rows = await prisma.postalCode.findMany({
    where: { shop: session.shop },
    orderBy: [{ country: "asc" }, { postalCode: "asc" }],
  });

  const headers = [
    "country",
    "postal_code",
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
        row.deliveryDays,
        row.serviceable,
        row.codAvailable,
        row.deliveryCharge ?? "",
        row.currency ?? "",
        row.city ?? "",
        row.state ?? "",
        row.zone ?? "",
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
