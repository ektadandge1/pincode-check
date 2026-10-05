# Headless Delivery API

This documents the current implementation in `app/services/headless-api.server.ts`, `app/utils/headless-request.ts`, `app/utils/headless-tokens.ts`, and the token management page at `/app/headless-api`.

The API provides read-only delivery checks, general estimates, product-card batches, and shipping-method results. Tokens do not authorize mutations of merchant configuration, products, orders, or Shopify checkout rates. The service does write internal rate-limit counters and successful-use timestamps. It requires an installed app with an offline session and an active subscription; delivery behavior uses the shop's settings and plan features.

## Endpoints

Use the deployed app origin, not the shop's storefront origin, as the API base URL. Every operation requires `POST` with `Content-Type: application/json`.

| Path | Required scope | Result in `data` |
| --- | --- | --- |
| `/api/v1/{public\|private}/delivery/check` | `delivery:check` | The delivery check result, including `available` and applicable delivery details. |
| `/api/v1/{public\|private}/delivery/estimate` | `delivery:estimate` | General delivery estimate; not postal-code serviceability. |
| `/api/v1/{public\|private}/delivery/batch` | `delivery:batch` | Array of `{ key, estimate }` product-card results. |
| `/api/v1/{public\|private}/delivery/methods` | `delivery:methods` | `{ available, shipping_methods }` from a delivery check. |

Choose either `public` or `private` in the path. Unknown token types or operations return 404. Other HTTP methods return 405 with `Allow: POST, OPTIONS`. Only public endpoints support browser preflight; private `OPTIONS` requests return 403.

## Authentication And Origins

Public requests use `X-Incode-Public-Token: hdt_public_...` and must include an `Origin` exactly matching the token's allowlist. Public tokens are visible to shoppers. **Origin restrictions are browser CORS controls, not proof of caller identity: a non-browser caller can spoof the Origin header.** Do not use a public token or its allowlist to protect secrets or privileged operations.

Private requests use `Authorization: Bearer hdt_private_...`. Keep these tokens in server-side secrets, never browser bundles or client-side environment variables. Private requests with any nonempty `Origin` header return `private_token_browser_use` (403); omit that header for server-to-server requests. This check is not a substitute for protecting the token.

Allowed public origins must be exact HTTPS origins, for example `https://store.example` or `https://store.example:8443`. HTTP is accepted only for `localhost`, optionally with a port. The utility splits on whitespace or commas and deduplicates. Paths, trailing slashes, wildcards, credentials, queries, fragments, noncanonical origin strings, and HTTP IP addresses are rejected. The UI requires at least one origin for public tokens and none for private tokens.

Public preflight reflects a nonempty, non-`null` Origin and permits `POST, OPTIONS` and `Content-Type, X-Incode-Public-Token`. It does not authenticate a token or validate its allowlist; the actual POST performs those checks. Successful origin validation adds `Access-Control-Allow-Origin` and exposes `X-Request-ID, Retry-After`. Errors before origin validation may not be readable by browser JavaScript through CORS.

## Token Management

Open **Headless API** in the embedded app. Create a named public or private token, select at least one of the four read scopes, supply origins for public tokens, and optionally specify a future UTC expiry such as `2027-01-01T00:00:00Z`. Names must be 1 to 100 characters after trimming. There are no write scopes.

Generated tokens contain 32 cryptographically random bytes encoded as base64url after the type prefix. Only a SHA-256 hash is stored for authentication, along with a display prefix and metadata. The complete secret is shown only in the creation response and cannot be retrieved later.

The UI supports Generate token, Enable/Disable, and permanent Revoke. Creating or enabling requires active plan access. Disabled, expired, and revoked tokens are rejected by the API and do not count toward the limit of 20 active tokens per shop. Expired tokens cannot be enabled; revoked tokens cannot be changed or re-enabled. Disabling is reversible. There is no token-edit or built-in rotation action.

Rotation is manual: create a replacement, update the integration, then revoke the old token. Both tokens can remain valid during that manual migration; there is no managed grace period or automatic rotation. App uninstall disables and revokes the shop's tokens.

The metadata table shows name, type, prefix, scopes, origins, status, creation, expiry, last successful use, and revocation timestamps. `lastUsedAt` updates only after a successful operation. It is not a request log, usage dashboard, health monitor, or alerting feature. There is no separate shop-wide API enable switch in this implementation; token Enable/Disable controls individual credentials.

## Request Fields

For `check`, `methods`, and `estimate`, send a JSON object with only these fields:

| Field | Validation and default |
| --- | --- |
| `country` | Required valid two-letter ISO country code, uppercased without trimming. |
| `postal_code` | For `check` and `methods`, required nonblank string with at most 30 characters before trimming. The service additionally validates the country-specific postal format. For `estimate`, optional; if provided must be a string of at most 30 characters. |
| `product_id` | Optional numeric ID **string** or `gid://shopify/Product/<digits>`. |
| `variant_id` | Optional numeric ID **string** or `gid://shopify/ProductVariant/<digits>`. |
| `quantity` | Integer number from 1 through 999. Missing defaults to 1. Null, strings and booleans are rejected. |
| `cod_requested` | Optional boolean. Missing defaults to false; `null`, numbers, and strings are rejected. |

Arrays, null, primitives, and unknown fields are rejected. IDs are not trimmed or coerced; wrong-resource GIDs, signs, decimals, and suffixes are rejected. Syntax alone does not prove an ID exists: supplied products and variants must be verified against Shopify, and a supplied product/variant pair must match. Product vendor, tags, and collection context are resolved server-side, not accepted from the caller.

An estimate returns `enabled: false` and `matched_target` for an excluded target. Otherwise it includes `enabled: true`, order/dispatch/estimated dates and labels, the maximum estimated date, delivery date range, processing/transit days, and matched target. It is not a guarantee that a postal code is serviceable. `cod_requested` affects delivery checks where applicable; it does not turn a general estimate into a COD availability check.

### Batch

```json
{
  "country": "IN",
  "items": [
    { "key": "card-1", "product_id": "123" },
    { "key": "card-2", "product_id": "gid://shopify/Product/456" }
  ]
}
```

Only `country` and `items` are allowed at the top level. Each item must be an object containing only `key` and `product_id`; a product ID is required. No postal codes, variants, quantities, COD flags, or caller-supplied product metadata are accepted for batch items. All retained products must be verified against Shopify.

The limit is **1 to 24 submitted items**. Keys must be distinct lowercase strings matching `[a-z0-9][a-z0-9-]{0,99}`. Empty batches and duplicate keys are rejected. Batch estimates use the default quantity of 1.

## Examples

Server-to-server delivery check (environment variables are example integration secrets, not app configuration switches):

```sh
curl "$APP_ORIGIN/api/v1/private/delivery/check" \
  -H "Authorization: Bearer $HEADLESS_PRIVATE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"country":"IN","postal_code":"110001","product_id":"123","quantity":1,"cod_requested":false}'
```

Browser request from an allowlisted storefront origin:

```js
const response = await fetch(`${appOrigin}/api/v1/public/delivery/estimate`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Incode-Public-Token": publicToken,
  },
  body: JSON.stringify({ country: "IN", product_id: "123" }),
});
const result = await response.json();
```

The browser supplies Origin automatically. Check both HTTP status and `result.success`; a successful delivery check can still have `data.available: false`.

## Responses And Errors

Successful operations return HTTP 200:

```json
{ "success": true, "data": {}, "request_id": "<UUID>" }
```

`data` above is a placeholder for the operation's result, not a fixed empty object. Errors use this envelope:

```json
{
  "success": false,
  "error": { "code": "invalid_quantity", "message": "quantity must be an integer between 1 and 999." },
  "request_id": "<UUID>"
}
```

Responses include `Cache-Control: no-store`, `X-Request-ID`, `Vary: Origin`, and `X-Content-Type-Options: nosniff`. Public preflight returns 204 without a JSON body. Request IDs correlate a response but do not imply an implemented logging or monitoring system.

| HTTP status | Error codes |
| --- | --- |
| 400 | `invalid_request`, `invalid_json`, `invalid_country`, `invalid_postal_code`, `invalid_product_context`, `invalid_quantity`, `invalid_batch` |
| 401 | `invalid_token` (including disabled, revoked, expired, or wrong-type tokens) |
| 402 | `subscription_required` |
| 403 | `origin_denied`, `private_token_browser_use`, `scope_denied`, `app_not_installed` |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 413 | `body_too_large` |
| 415 | `invalid_content_type` |
| 429 | `rate_limited` |
| 503 | `temporarily_unavailable` for unexpected failures |

## Limits And Deployment

- Request bodies are limited to **64 KiB (65,536 bytes)**, measured while reading the body stream, not by trusting Content-Length.
- Rate limits are **120 requests per token per minute** and **10,000 requests per shop per token type per day**. Public and private daily budgets are separate so public traffic cannot exhaust private capacity.
- Counters are stored transactionally in the database, so workers using the same database share limits. Separate databases do not share counters. Multi-instance deployment requires a genuinely shared database; independent SQLite copies are not shared storage.
- Limits use fixed Unix-time minute/day buckets, not rolling windows. Daily buckets reset at UTC midnight. Authenticated, origin-allowed, scope-allowed requests consume limits before installation, subscription, body, and operation validation, so later failures can count. Preflight does not consume limits.
- A 429 includes `Retry-After: 60`, even when the daily limit caused it. This is not the exact daily reset time. No remaining-quota or reset headers are implemented.

There is no sandbox/test-token mode or separate test API in this release. Treat calls to the deployed production endpoint as production reads: they use real shop settings, Shopify product verification, any configured delivery dependencies, rate counters, and last-used metadata. Use minimal controlled requests for production smoke checks; do not assume a test flag bypasses billing or limits.

Deploy the API route and service with the app, apply the Prisma migration for headless token/rate-limit tables, and retain access to the shop's offline session. Creating a token does not itself deploy an endpoint. No additional API feature switch, monitoring integration, automatic rotation, or checkout mutation is provided here.

## Targeted Unit Tests

```sh
node --test --experimental-strip-types tests/headless-request.test.mjs
npx tsx scripts/verify-headless-api.mjs
```

Unit tests exercise request validation. The integration script exercises the actual HTTP handler with database-backed synthetic tokens, including revocation, expiry, origins, scopes, and missing installations. Neither test calls live Shopify; live successful-delivery smoke testing requires an installed test store.
