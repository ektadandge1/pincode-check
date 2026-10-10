type AdminClient = {
  graphql: (query: string) => Promise<Response>;
};

export type PartnerSubscription = {
  billingPeriod: string;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  currentBillingCycle: { startTime: string; endTime: string } | null;
};

function partnerConfig() {
  const organizationId = process.env.SHOPIFY_PARTNER_ORG_ID?.trim() ?? "";
  const accessToken = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN?.trim() ?? "";
  const appId = process.env.SHOPIFY_APP_GID?.trim() ?? "";
  if (!/^\d+$/.test(organizationId)) throw new Error("SHOPIFY_PARTNER_ORG_ID must be a numeric Partner organization ID.");
  if (!accessToken) throw new Error("SHOPIFY_PARTNER_API_ACCESS_TOKEN is required for billing verification.");
  if (!/^gid:\/\/shopify\/App\/\d+$/.test(appId)) throw new Error("SHOPIFY_APP_GID must be a Shopify App GID.");
  return { organizationId, accessToken, appId };
}

export async function getPartnerSubscription(admin: AdminClient): Promise<PartnerSubscription | null> {
  const shopResponse = await admin.graphql(`#graphql
    query ShopBillingIdentity {
      shop { id }
    }
  `);
  const shopPayload = (await shopResponse.json()) as {
    data?: { shop?: { id?: string } };
    errors?: Array<{ message?: string }>;
  };
  const shopId = shopPayload.data?.shop?.id;
  if (!shopResponse.ok || shopPayload.errors?.length || !shopId) {
    throw new Error(shopPayload.errors?.[0]?.message ?? "Unable to resolve the Shopify shop for billing.");
  }

  const { organizationId, accessToken, appId } = partnerConfig();
  const response = await fetch(`https://partners.shopify.com/${organizationId}/api/2026-07/graphql.json`, {
    method: "POST",
    signal: AbortSignal.timeout(8_000),
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: `#graphql
        query ActiveSubscription($appId: ID!, $shopId: ID!) {
          activeSubscription(appId: $appId, shopId: $shopId) {
            billingPeriod
            cancelAtEndOfCycle
            trialEndsAt
            currentBillingCycle { startTime endTime }
          }
        }
      `,
      variables: { appId, shopId },
    }),
  });
  const payload = (await response.json()) as {
    data?: { activeSubscription?: PartnerSubscription | null };
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(payload.errors?.[0]?.message ?? "Unable to verify the Shopify subscription.");
  }
  return payload.data.activeSubscription ?? null;
}
