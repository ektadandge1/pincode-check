# Incode Track App Store Submission Notes

Use these values in the Shopify Partner Dashboard after the production domain is ready.

## Release Gate

Do not submit the app while any item below is incomplete:

- Replace every `https://example.com` value in `shopify.app.toml` with the final HTTPS domain.
- Host the web process and database on durable production infrastructure. The repository defaults to SQLite for local development; a container without a persistent volume will lose sessions and merchant data.
- Set every required value from `.env.example`, including a real support email and legal business name.
- Run `npm run env:check`, `npm run setup`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `shopify app build` successfully.
- Verify install, reinstall, and uninstall flows in Chrome incognito mode.
- Verify all three mandatory privacy webhook topics against the production endpoint.
- Configure Shopify App Pricing and test Basic approval, Advanced approval,
  upgrade, downgrade, cancellation, trial, reinstall, and welcome-link redirects.
- Create a Partner API client with **Manage apps** permission and set the billing
  environment variables documented in `.env.example`.
- Add the theme app block to a test product template and test desktop and mobile storefront behavior.
- Measure storefront Lighthouse performance before and after enabling the app block. The reduction must remain within Shopify's current App Store requirement.

Temporary `trycloudflare.com` development tunnels are not production URLs and must not be submitted for review.

## App Listing

App name: Incode Track

App card subtitle: Show delivery availability by postal or ZIP code on product pages.

App introduction: Help shoppers check delivery availability by country and postal or ZIP code before buying.

App details: Incode Track adds a product-page delivery availability checker through a Shopify theme app extension. Merchants can upload serviceable countries and postal codes, set delivery days, manage holidays and weekends, configure COD availability, and optionally use inventory-aware delivery messages for selected variants.

Feature ideas:
- Add a postal and ZIP code checker to product pages without theme code edits.
- Upload serviceable country/postal-code coverage by CSV or enter records manually.
- Export CSV records, sync from a published Google Sheet CSV URL, and review failed import rows.
- Show estimated delivery dates using cutoff, weekend, and holiday rules.
- Display COD availability for each serviceable postal code.
- Show delivery charges and custom storefront messages.
- Disable Add to Cart when delivery is unavailable.
- View privacy-safe delivery lookup analytics.
- Optionally check selected variant inventory before showing delivery estimates.

Suggested category: Store design or Shipping and delivery, depending on available Partner Dashboard categories.

Sales channel requirement: Merchant must have Online Store.

Geographic requirement: Built for global postal and ZIP code coverage. India-only Shiprocket checks are optional and disabled unless credentials are configured.

Languages supported: English.

Pricing method: Shopify App Pricing (not manual Billing API and never off-platform billing).

### Basic

- Price: $9.99 USD every 30 days
- Free trial: 7 days
- Plan handle: `basic`
- Recurring item handle: `basic`
- Welcome link: `/app/plans`
- Exact postal/ZIP rules, CSV/manual import, delivery dates, COD, cutoff,
  weekends, holidays, and the storefront checker.

### Advanced

- Price: $29.99 USD every 30 days
- Free trial: 7 days
- Plan handle: `advanced`
- Recurring item handle: `advanced`
- Welcome link: `/app/plans`
- Everything in Basic plus ranges, wildcards, zones, product targeting,
  Add-to-Cart/PIN controls, inventory/courier checks, delivery options,
  Google Sheets, export, and analytics.

Do not place prices or trial claims in listing images, icon, app introduction,
app details, or feature text. Pricing belongs only in Shopify's designated
Pricing details section. Keep the in-app plan page and Partner Dashboard values
identical.

Requested scopes: `read_products,write_app_proxy`.

Scope reason: `read_products` supports optional selected-variant inventory checks. `write_app_proxy` is required for the storefront app proxy endpoint used by the product-page delivery checker.

Protected customer data: Not required. The app does not store customer names, addresses, emails, phone numbers, orders, payments, or checkout information.

Third-party data processors: If India courier provider credentials are configured, Indian postal code serviceability checks can be sent to the configured courier provider. If no courier provider is configured, checks use only merchant-uploaded postal code records.

Privacy policy URL: https://YOUR_DOMAIN/privacy

Support URL: https://YOUR_DOMAIN/support

Demo store URL: Link directly to a product page where the Delivery availability checker block is installed.

## Review Testing Instructions

1. Install the app on the development store from Shopify.
2. Open the app in Shopify admin.
3. On Shopify's hosted plan page, select Advanced. Development stores owned by
   the same Partner organization can test paid plans at no charge.
4. Confirm Shopify redirects to `/app/plans` and shows Advanced as active.
5. Go to Delivery control.
6. Add a postal code manually, for example `US, 10001, 2 delivery days, serviceable`.
7. Open Help and click Add block in Theme Editor.
8. Save the app block on the product template.
9. Open a product page on the storefront.
10. Select `United States`, enter `10001`, and confirm the app shows a successful delivery estimate.
11. Enter an unavailable postal code and confirm the app shows the unavailable message.
12. Enable Add-to-Cart blocking and confirm the add button disables after an unavailable lookup.
13. Open Analytics and confirm the lookup was recorded without customer personal data.
14. Open Plans, switch to Basic through Shopify's hosted page, and confirm
    Advanced controls become unavailable without deleting saved configuration.
15. Switch back to Advanced and confirm the saved configuration becomes active.

Analytics displays shortened postal regions and retains lookup events for up to 90 days. It does not retain the complete shopper-entered postal code or product variant ID.

## Required Dashboard Items

- Public distribution selected.
- Production URLs set to the hosted HTTPS domain.
- Compliance webhooks configured and reachable.
- Emergency developer contact configured.
- App icon uploaded as 1200 x 1200 PNG or JPEG.
- Three to six screenshots uploaded at 1600 x 900.
- Demo screencast in English or with English subtitles.
- Pricing configured with Shopify App Pricing or marked free.
- Basic and Advanced each have exactly a 7-day trial and accurate feature text.
- Merchants can upgrade and downgrade without contacting support or reinstalling.
- Production Partner API client has **Manage apps** permission and its token is
  stored only in server-side environment variables.
- No screenshot, icon, app details, or feature-list text includes pricing.

## Current Shopify Review Rules

- Use Shopify App Pricing for every app charge; never send merchants to an
  external payment system.
- Authenticate immediately with OAuth/session tokens and work in Chrome
  incognito without third-party cookies.
- Use GraphQL Admin API only and request only required scopes.
- Keep the app fully embedded with current App Bridge and Polaris UI.
- Provide functional reviewer credentials, an English screencast, exact setup
  steps, a demo product URL, and access to all paid features.
- Use the theme app extension only; never ask reviewers or merchants to edit
  theme code manually.
- Ensure the widget works in Theme Editor, desktop, and mobile storefronts.
- Keep Lighthouse reduction within 10 points using Shopify's weighted test.
- Use factual listing claims with no guarantees, testimonials, ratings, or
  unsupported statistics.
- Select “Merchant must have online store” in listing eligibility.
- Keep support, privacy, production HTTPS URLs, emergency developer contact,
  and mandatory privacy webhooks live throughout review.
