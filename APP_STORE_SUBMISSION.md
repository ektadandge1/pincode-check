# ETADeliverPickup App Store Submission Notes

Use these values in the Shopify Partner Dashboard after the production domain is ready.

These are draft submission instructions, not evidence of a live deployment, completed review or Shopify approval. Record actual results in `LAUNCH_CHECKLIST.md` before submission.

## Release Gate

Do not submit the app while any item below is incomplete:

- Replace every `https://example.com` value in `shopify.app.toml` with the final HTTPS domain.
- Host the web process and database on durable production infrastructure. The repository defaults to SQLite for local development; a container without a persistent volume will lose sessions and merchant data.
- Replace development values from `.env.example`, including real support email/legal identity and Partner API credentials with Manage apps permission. Set `NODE_ENV=production`, `APP_ENV=production`, `SHOPIFY_BILLING_REQUIRED=true` and `SHOPIFY_BILLING_DEV_BYPASS=false` (or unset).
- Run `npm run env:check`, `npm run setup`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `shopify app build` successfully.
- Verify install, reinstall, and uninstall flows in Chrome incognito mode.
- Verify all three mandatory privacy webhook topics against the production endpoint.
- Test Standard plan selection, approval, cancellation, trial, reinstall, and the `/app/plans` welcome redirect through Shopify App Pricing.
- Confirm Shopify App Pricing shows Standard at $9 USD monthly with a 7-day trial. Separate non-production development/review installations use Shopify's no-charge testing with no bypass while exercising paid flows; do not change the public production flags for review.
- Add the theme app block to a test product template and test desktop and mobile storefront behavior.
- Measure storefront Lighthouse performance before and after enabling the app block. The reduction must remain within Shopify's current App Store requirement.

Temporary `trycloudflare.com` development tunnels are not production URLs and must not be submitted for review.

## App Listing

App name: ETADeliverPickup

App card subtitle: Show delivery availability by postal or ZIP code on product pages.

App introduction: Help shoppers check delivery availability by country and postal or ZIP code before buying.

App details: ETADeliverPickup adds a product-page delivery availability checker through a Shopify theme app extension. Merchants can upload serviceable countries and postal codes, set delivery days, manage holidays and weekends, configure COD availability, target rules by product, collection, vendor, or tag, and optionally use inventory-aware delivery messages for selected variants.

Feature ideas:
- Add a postal and ZIP code checker to product pages without theme code edits.
- Upload serviceable country/postal-code coverage by CSV or enter records manually.
- Export CSV records, sync from a published Google Sheet CSV URL, and review failed import rows.
- Show estimated delivery dates using cutoff, weekend, and holiday rules.
- Display COD availability for each serviceable postal code.
- Show delivery charges and custom storefront messages.
- Disable Add to Cart when delivery is unavailable.
- Require a valid postal or ZIP code before Add to Cart, with product-targeted overrides.
- Exclude selected products or other targets from delivery estimates.
- Offer configured express, same-day, next-day, local delivery, and pickup options when eligible.
- View privacy-safe delivery lookup analytics.
- Optionally check selected variant inventory before showing delivery estimates.

Suggested category: Store design or Shipping and delivery, depending on available Partner Dashboard categories.

Sales channel requirement: Merchant must have Online Store.

Geographic requirement: Built for global postal and ZIP code coverage. India-only Shiprocket checks are optional and disabled unless credentials are configured.

Languages supported: English.

Pricing method: Shopify App Pricing (never off-platform billing).

### Standard

- Price: $9 USD every 30 days
- Free trial: 7 days
- Billing API plan name: `Standard`
- Approval return route: `/app/plans`
- Includes exact rules, ranges, wildcards, zones, product targeting,
  Add-to-Cart/PIN controls, inventory/courier checks, delivery options,
  Google Sheets, export, and analytics.

Do not place prices or trial claims in listing images, icon, app introduction,
app details, or feature text. Pricing belongs only in Shopify's designated
Pricing details section. Keep the in-app plan page and Partner Dashboard values
identical.

Requested scopes: `read_products,read_inventory,read_locations,read_orders,read_themes,write_app_proxy`.

Scope reasons: `read_products` reads product/variant targeting context; `read_inventory` reads selected-variant/location inventory; `read_locations` reads fulfillment locations; `read_orders` lets merchants review pickup selections and customer fulfillment details on the Delivery & pickup page; `read_themes` reads the published theme's app-embed activation state so the Overview can report Active accurately; `write_app_proxy` enables the storefront app proxy. Shipping methods are app-owned rules and no write-order permission is used. Align TOML and Partner configuration before release; documentation is not the deployed scope configuration.

Protected customer data: The pickup-orders view queries recent Shopify orders live and may display customer name, email, phone and shipping address to an authenticated merchant. The app does not copy those order/customer records into its database. Request the applicable protected customer data fields in Partner Dashboard and confirm the declaration against current Shopify policy. Merchant OAuth sessions can contain staff user IDs, names/emails and credentials. Lookup events retain masked postal regions and product/variant IDs, not customer IDs. See `docs/privacy-data-inventory.md`.

Protected-data declaration details: `read_orders` is used only by the authenticated Delivery & pickup admin view to show live fulfillment information for merchant-selected pickup/delivery orders. The app does not write orders, persist customer records, expose order data to storefront shoppers, or use order data for advertising, profiling, or unrelated analytics. Request and justify only the protected fields required by the current Shopify Partner Dashboard form, and provide the public privacy URL before submission.

Shopify cart/order attributes created by storefront delivery selections remain Shopify-owned. The app privacy webhook does not search, export or erase those Shopify records. Customer data-request/redact topics acknowledge no customer-linked records in the app database; shop redaction deletes app-owned shop data and rate-limit buckets. Verify the live public privacy page matches these boundaries before submission.

Third-party data processors: If India courier provider credentials are configured, Indian postal code serviceability checks can be sent to the configured courier provider. If no courier provider is configured, checks use only merchant-uploaded postal code records.

Privacy policy URL: https://YOUR_DOMAIN/privacy

Support URL: https://YOUR_DOMAIN/support

Demo store URL: Link directly to a product page where the Delivery availability checker block is installed.

## Review Testing Instructions

1. Install the app on the development store from Shopify.
2. Open the app in Shopify admin.
3. On the Plans page, start the Standard trial and approve the Shopify test charge.
4. Confirm Shopify redirects to `/app/plans` and shows Standard as active.
5. Go to Delivery control.
6. Add a postal code manually, for example `US, 10001, 2 delivery days, serviceable`.
7. Open Help and click Add block in Theme Editor.
8. Save the app block on the product template.
9. Open a product page on the storefront.
10. Select `United States`, enter `10001`, and confirm the app shows a successful delivery estimate.
11. Enter an unavailable postal code and confirm the app shows the unavailable message.
12. Enable Add-to-Cart blocking and confirm the add button disables after an unavailable lookup.
13. Open Analytics and confirm the lookup records a masked region and product/variant context without customer ID/email association; inspect the database rather than inferring all stored fields from the UI.
14. Submit the plan form again and confirm no duplicate charge is created.
15. Cancel the subscription in Shopify and confirm paid admin routes redirect to
    Plans while proxy/API routes return HTTP 402.

Analytics displays shortened postal regions and stores product and variant IDs. Its writer uses a 90-day cutoff with opportunistic cleanup on every hundredth process-local lookup write for the current shop, so inactive shops may retain older events. Do not advertise a guaranteed 90-day maximum without scheduled cleanup. The current writer does not retain the complete shopper-entered postal code.

## Required Dashboard Items

- Public distribution selected.
- Production URLs set to the hosted HTTPS domain.
- Compliance webhooks configured and reachable.
- Emergency developer contact configured.
- App icon uploaded as 1200 x 1200 PNG or JPEG.
- Three to six screenshots uploaded at 1600 x 900.
- Demo screencast in English or with English subtitles.
- Standard is configured in Shopify App Pricing as $9 USD monthly with a 7-day trial.
- Shopify hosts subscription approval, trial handling, invoicing, and development-store test charges.
- Billing is required in production with `SHOPIFY_BILLING_REQUIRED=true`.
- No screenshot, icon, app details, or feature-list text includes pricing.

## Current Shopify Review Rules

- Use Shopify Billing API for every app charge; never send merchants to an
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
