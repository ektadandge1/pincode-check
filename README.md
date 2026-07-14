# Incode Track

Incode Track is a Shopify public app that adds a country-aware postal and ZIP code delivery checker to product pages through a theme app extension.

## Features

- Embedded Shopify admin built with App Bridge and Polaris.
- Theme app extension for product-page postal and ZIP code checks.
- App proxy endpoint for storefront delivery availability requests.
- Shop-scoped, country-scoped postal code records and delivery settings.
- CSV import and manual postal code management.
- Holiday, weekend, cutoff, COD, and inventory-aware delivery rules.
- Mandatory Shopify privacy compliance webhooks.

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

1. Set production environment variables from `.env.example`.
2. Replace the `https://example.com` application and redirect URLs in `shopify.app.toml` with the production HTTPS domain.
3. Run `npm run setup` in production to generate Prisma Client and apply migrations.
4. Deploy the app and release the Shopify app configuration and theme extension.
5. Configure the Shopify App Store listing using `APP_STORE_SUBMISSION.md`.

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
country,postal_code,delivery_days,serviceable,cod_available,city,state,zone
US,10001,2,true,false,New York,New York,metro
GB,SW1A 1AA,3,true,false,London,England,metro
IN,400001,2,true,true,Mumbai,Maharashtra,metro
```

`country`, `postal_code`, and `delivery_days` are required. Other columns are optional. Legacy India CSVs that use `pincode` are still accepted and treated as `IN`.
