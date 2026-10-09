/* eslint-env node */
const errors = [];
const warnings = [];
const env = process.env;
const required = [
  "NODE_ENV", "APP_ENV", "DATABASE_URL", "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL", "SHOPIFY_APP_HANDLE", "SHOPIFY_APP_GID",
  "SHOPIFY_PARTNER_ORG_ID", "SHOPIFY_PARTNER_API_ACCESS_TOKEN",
  "SHOPIFY_BILLING_REQUIRED", "SCOPES", "SUPPORT_EMAIL", "LEGAL_BUSINESS_NAME",
];

for (const name of required) {
  if (!env[name]?.trim()) errors.push(`${name} is required.`);
}
for (const name of ["NODE_ENV", "APP_ENV"]) {
  if (env[name] !== "production") errors.push(`${name} must be production.`);
}
for (const [name, expected] of [["SHOPIFY_BILLING_REQUIRED", "true"]]) {
  if (env[name]?.trim().toLowerCase() !== expected) errors.push(`${name} must be ${expected} in production.`);
}
if (env.SHOPIFY_BILLING_DEV_BYPASS !== undefined && env.SHOPIFY_BILLING_DEV_BYPASS.trim().toLowerCase() !== "false") {
  errors.push("SHOPIFY_BILLING_DEV_BYPASS must be false or unset in production.");
}

try {
  const url = new URL(env.SHOPIFY_APP_URL);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || url.pathname !== "/" || host === "localhost" || host === "::1" || host === "[::1]"
    || /^127\./.test(host) || /(^|\.)(example\.(com|org|net)|example|test|localhost|trycloudflare\.com|ngrok\.io|ngrok-free\.app)$/.test(host)) {
    errors.push("SHOPIFY_APP_URL must be a permanent production HTTPS origin, not a placeholder, loopback or development tunnel.");
  }
} catch {
  errors.push("SHOPIFY_APP_URL must be a valid production HTTPS origin.");
}

for (const name of ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_HANDLE", "SHOPIFY_PARTNER_API_ACCESS_TOKEN", "SUPPORT_EMAIL", "LEGAL_BUSINESS_NAME"]) {
  if (/your[- _]|example\.(com|org|net)|change[- _]?me|placeholder/i.test(env[name] || "")) {
    errors.push(`${name} must not contain an example placeholder.`);
  }
}
if (!/^gid:\/\/shopify\/App\/\d+$/.test(env.SHOPIFY_APP_GID || "")) errors.push("SHOPIFY_APP_GID must be a Shopify App GID.");
if (!/^\d+$/.test(env.SHOPIFY_PARTNER_ORG_ID || "")) errors.push("SHOPIFY_PARTNER_ORG_ID must be numeric.");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SUPPORT_EMAIL || "")) errors.push("SUPPORT_EMAIL must be a valid email address.");

const scopes = new Set((env.SCOPES || "").split(",").map((scope) => scope.trim()));
for (const scope of ["read_products", "read_inventory", "read_locations", "read_orders", "read_themes", "write_app_proxy"]) {
  if (!scopes.has(scope)) errors.push(`SCOPES must include ${scope}.`);
}
if (["read_shipping", "write_orders"].some((scope) => scopes.has(scope))) {
  errors.push("SCOPES includes unused shipping/order permissions; align environment and Shopify configuration before launch.");
}

const databaseUrl = env.DATABASE_URL || "";
if (!databaseUrl.startsWith("file:") || !databaseUrl.slice(5).split("?")[0] || /:memory:|mode=memory/i.test(databaseUrl)) {
  errors.push("DATABASE_URL must identify a persistent SQLite file for the current Prisma schema.");
} else {
  const path = databaseUrl.slice(5).split("?")[0];
  if (!path.startsWith("/")) warnings.push("DATABASE_URL uses a relative SQLite path (resolved relative to the Prisma schema); use an absolute path on a durable volume.");
  if (/(^|\/)(tmp|temp)(\/|$)|(^|\/)dev\.(sqlite|db)$/i.test(path)) warnings.push("DATABASE_URL appears to use temporary/development storage; replace it with a production durable volume.");
  warnings.push("SQLite durability is not verified: confirm a persistent writable volume, backups/restore and a single-instance deployment before launch.");
}

// Diagnostics name settings only; never print credentials, URLs or supplied values.
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
for (const error of errors) console.error(`ERROR: ${error}`);
if (errors.length) process.exitCode = 1;
else console.log("Production environment validation passed; infrastructure and Shopify launch checks remain manual.");
