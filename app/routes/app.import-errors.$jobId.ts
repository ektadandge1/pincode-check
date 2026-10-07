import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { requireActiveBilling } from "../services/billing.server";
import { importErrorCsvValue } from "../utils/postal-import";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await requireActiveBilling(request);
  const jobId = Number(params.jobId);
  if (!Number.isInteger(jobId)) {
    return new Response("Invalid import job.", { status: 400 });
  }

  const job = await prisma.importJob.findFirst({ where: { id: jobId, shop: session.shop } });
  if (!job) {
    return new Response("Import job not found.", { status: 404 });
  }

  const errors = await prisma.importError.findMany({
    where: { importJobId: job.id },
    orderBy: { rowNumber: "asc" },
  });

  const lines = [
    "row_number,reason,raw_row",
    ...errors.map((error) => [error.rowNumber, error.reason, error.rawRow].map(importErrorCsvValue).join(",")),
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="incode-track-import-${job.id}-errors.csv"`,
    },
  });
}
