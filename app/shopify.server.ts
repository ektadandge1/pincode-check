import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

export const STARTUP_PLAN = "startup" as const;
export const STARTUP_PLAN_NAME = "Startup" as const;
export const STARTUP_PLAN_PRICE = 7;
export const STARTUP_PLAN_CURRENCY = "USD" as const;
export const STARTUP_PLAN_TRIAL_DAYS = 7;

const shopifyConfig = {
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  billing: {
    [STARTUP_PLAN]: {
      trialDays: STARTUP_PLAN_TRIAL_DAYS,
      lineItems: [
        {
          amount: STARTUP_PLAN_PRICE,
          currencyCode: STARTUP_PLAN_CURRENCY,
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
} satisfies Parameters<typeof shopifyApp>[0];

const shopify = shopifyApp(shopifyConfig);

// Privacy and uninstall handlers only need verified webhook data, not an Admin
// API token. Refreshing an expired token after uninstall can fail because Shopify
// has already revoked it, preventing these handlers from ever acknowledging it.
// Keep SDK HMAC validation and session storage, but skip refresh for these routes.
export const authenticateWebhookOnly = shopifyApp({
  ...shopifyConfig,
  future: { expiringOfflineAccessTokens: false },
}).authenticate;

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
