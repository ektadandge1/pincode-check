const required = [
  "DATABASE_URL",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SHOPIFY_APP_HANDLE",
  "SHOPIFY_PARTNER_ORG_ID",
  "SHOPIFY_PARTNER_API_ACCESS_TOKEN",
  "SHOPIFY_APP_GID",
  "SCOPES",
  "SUPPORT_EMAIL",
  "LEGAL_BUSINESS_NAME",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
}

const appUrl = new URL(process.env.SHOPIFY_APP_URL);
if (appUrl.protocol !== "https:" || appUrl.hostname === "example.com") {
  throw new Error("SHOPIFY_APP_URL must be the production HTTPS application URL.");
}

const scopes = new Set(process.env.SCOPES.split(",").map((scope) => scope.trim()));
for (const requiredScope of ["read_products", "read_shipping", "write_app_proxy"]) {
  if (!scopes.has(requiredScope)) {
    throw new Error(`SCOPES must include ${requiredScope}.`);
  }
}

console.log("Production environment is configured.");
