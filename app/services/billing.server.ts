import { redirect } from "react-router";
import {
  authenticate,
  STANDARD_PLAN,
} from "../shopify.server";
import { isBillingRequired, isBillingTestMode } from "./billing-config.server";

export { isBillingRequired, isBillingTestMode } from "./billing-config.server";

type AdminAuthContext = Awaited<ReturnType<typeof authenticate.admin>>;
type BillingContext = AdminAuthContext["billing"];
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

type BillingSource = BillingContext | AdminClient;

function isBillingContext(source: BillingSource): source is BillingContext {
  return "check" in source;
}

export async function getActiveAppSubscriptions(
  source: BillingSource,
): Promise<ActiveAppSubscription[]> {
  if (isBillingContext(source)) {
    const { appSubscriptions } = await source.check({
      plans: [STANDARD_PLAN],
      isTest: isBillingTestMode(),
    });
    return appSubscriptions.filter((subscription) => subscription.status === "ACTIVE");
  }

  const response = await source.graphql(`#graphql
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
      subscription.status === "ACTIVE" &&
      (isBillingTestMode() || !subscription.test),
  );
}

export async function hasActiveBilling(source: BillingSource): Promise<boolean> {
  return (await getActiveAppSubscriptions(source)).length > 0;
}

export async function requireActiveBilling(
  request: Request,
  options: { api?: boolean } = {},
): Promise<AdminAuthContext> {
  const context = await authenticate.admin(request);
  if (!isBillingRequired() || await hasActiveBilling(context.billing)) return context;

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
