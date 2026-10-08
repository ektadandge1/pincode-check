import { redirect } from "react-router";
import {
  authenticate,
  STANDARD_PLAN,
} from "../shopify.server";
import { isBillingRequired } from "./billing-config.server";

export { isBillingRequired } from "./billing-config.server";

type AdminAuthContext = Awaited<ReturnType<typeof authenticate.admin>>;
type AdminClient = AdminAuthContext["admin"];

export type ActiveAppSubscription = {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  createdAt: string;
  currentPeriodEnd: string;
};

export async function getActiveAppSubscriptions(
  admin: AdminClient,
): Promise<ActiveAppSubscription[]> {
  const response = await admin.graphql(`#graphql
    query ActiveAppSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          test
          trialDays
          createdAt
          currentPeriodEnd
        }
      }
    }
  `);
  const payload = (await response.json()) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: ActiveAppSubscription[] } };
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message ?? "Unable to verify Shopify billing.");
  }

  return (payload.data?.currentAppInstallation?.activeSubscriptions ?? []).filter(
    (subscription) =>
      subscription.name === STANDARD_PLAN &&
      subscription.status === "ACTIVE",
  );
}

export async function hasActiveBilling(admin: AdminClient): Promise<boolean> {
  return (await getActiveAppSubscriptions(admin)).length > 0;
}

export async function requireActiveBilling(
  request: Request,
  options: { api?: boolean } = {},
): Promise<AdminAuthContext> {
  const context = await authenticate.admin(request);
  if (!isBillingRequired() || await hasActiveBilling(context.admin)) return context;

  if (options.api) {
    throw context.cors(Response.json(
      {
        error: "BILLING_REQUIRED",
        message: `An active ${STANDARD_PLAN} subscription is required.`,
      },
      { status: 402, headers: { "Cache-Control": "no-store" } },
    ));
  }

  throw redirect("/app/plans");
}

export function billingRequiredResponse(): Response {
  return Response.json(
    {
      error: "BILLING_REQUIRED",
      message: `An active ${STANDARD_PLAN} subscription is required.`,
    },
    { status: 402, headers: { "Cache-Control": "no-store" } },
  );
}
