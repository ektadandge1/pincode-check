# Incode Track

Incode Track is a Shopify public app that adds a country-aware postal and ZIP code delivery checker to product pages through a theme app extension.

## Features

- Embedded Shopify admin built with App Bridge and Polaris.
- Theme app extension for product-page postal and ZIP code checks.
- App proxy endpoint for storefront delivery availability requests.
- Shop-scoped postal code records and delivery settings (unlimited rows).
- **Unlimited zones** with priority ordering for overlapping rules.
- **ZIP ranges** (`10000-10999`) and **wildcards** (`123*`, `SW1A*`) with specificity-based matching.
- **Product, collection, and tag targeting** with priority-based overrides.
- **Require valid PIN before Add to Cart** (shop-wide and per-targeting rule).
- CSV import and manual postal rule management (exact, range, and wildcard rows).
- CSV export, Google Sheet manual sync, and import validation reports.
- Holiday, weekend, cutoff, COD, and inventory-aware delivery rules.
- Delivery charges, custom storefront messages, Add-to-Cart blocking, and basic lookup analytics.
- **Product, collection, and tag targeting** with priority-based overrides.
- **Require valid PIN before Add to Cart** (shop-wide and per-targeting rule).
- Mandatory Shopify privacy compliance webhooks.

## Plans

Incode Track uses Shopify App Pricing. Shopify hosts plan selection, processes all
charges, and manages upgrades, downgrades, proration, cancellation, and trial
reuse. Both plans include a 7-day trial.

### Basic - $9.99 USD/month

- Product-page delivery checker
- Unlimited exact postal and ZIP code rules
- CSV and manual imports
- Delivery estimates and COD availability
- Cutoff, weekend, and holiday schedules

### Advanced - $29.99 USD/month

- Everything in Basic
- ZIP ranges, wildcards, and priority zones
- Product, collection, and tag targeting
- Valid-PIN and unavailable-location Add-to-Cart controls
- Inventory and optional courier-aware checks
- Delivery charges and speed options
- Google Sheet sync, CSV export, and privacy-safe analytics

Advanced records are retained but become dormant after a downgrade to Basic.
They are restored if the merchant upgrades again.

## Shopify Requirements Covered Locally

- Public app distribution configured with `AppDistribution.AppStore`.
- Minimal Admin API scopes: `read_products,write_app_proxy`.
- GraphQL Admin API only.
- Latest supported local API version configured as `2026-04`.
- OAuth/session-token embedded app flow through Shopify app tooling.
- App Bridge script and React navigation.
- Polaris admin UI.
- Theme app extension instead of manual theme edits.
- App proxy for storefront data.
- Mandatory compliance webhooks: `customers/data_request`, `customers/redact`, and `shop/redact`.
- Public `/privacy` and `/support` pages for listing links.

## Production Setup

1. Set production environment variables from `.env.example` and run `npm run env:check`.
2. Configure Shopify App Pricing in the Partner Dashboard using the exact plan
   and item handles `basic` and `advanced`, with a 7-day trial on each plan.
3. Replace the `https://example.com` application and redirect URLs in `shopify.app.toml` with the production HTTPS domain.
4. Provision durable database storage. Local SQLite is not suitable for an ephemeral or multi-instance deployment without a persistent storage strategy.
5. Run `npm run setup` in production to generate Prisma Client and apply migrations.
6. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `shopify app build`.
7. Deploy the app and release the Shopify app configuration and theme extension.
8. Configure and verify the Shopify App Store listing using `APP_STORE_SUBMISSION.md`.

## Commands

- `npm run dev` starts Shopify CLI development mode.
- `npm run typecheck` runs React Router type generation and TypeScript checks.
- `npm run lint` runs ESLint.
- `npm run build` creates the production build.
- `npm run setup` runs Prisma generation and migrations.
- `npm run start` serves the production build.

## Storefront CSV Format

Supported columns:

```csv
country,postal_code,delivery_days,serviceable,cod_available,delivery_charge,currency,city,state,zone,same_day,next_day,express
US,10001,2,true,false,8,USD,New York,New York,metro,false,true,true
US,10000-10999,3,true,false,10,USD,NY metro range,,metro,false,false,false
IN,4*,2,true,true,40,INR,Rural Maharashtra,,rural,false,true,false
GB,SW1A*,3,false,false,5,GBP,London SW postcodes,,london,false,false,true
```

`country`, `postal_code`, and `delivery_days` are required. Other columns are optional.

- `postal_code` may be an **exact** code, a **range** (`start-end`), or a **wildcard** (`123*`).
- `zone` is optional; values auto-create zones and group rules.
- Matching order: exact code → most specific wildcard → narrowest range; zone priority breaks ties (lower wins).
- Legacy India CSVs that use `pincode` are still accepted and treated as `IN`.
- Optional `pattern_type` column (`exact`|`range`|`wildcard`) must match the pattern if provided.

## Targeting and Add-to-Cart lock

- Targeting rules match **product ID**, **collection handle**, or **product tag** from the storefront widget context.
- Match precedence: product → collection → tag; lower `priority` wins inside a kind; disabled rules are ignored.
- **Require valid PIN before Add to Cart**: shop-wide default, overridable by the highest-precedence matching target (`true` locks, `false` exempts).
- When locked, Add to Cart stays disabled until a serviceable delivery check succeeds. Editing the postal code or variant re-locks until the next successful check.
- The theme block sends `productId`, `productTags`, and `collections` on each app-proxy check (`init=1` loads the initial lock policy).
