# Incode Track App Store Submission Notes

Use these values in the Shopify Partner Dashboard after the production domain is ready.

## App Listing

App name: Incode Track

App card subtitle: Show delivery availability by postal or ZIP code on product pages.

App introduction: Help shoppers check delivery availability by country and postal or ZIP code before buying.

App details: Incode Track adds a product-page delivery availability checker through a Shopify theme app extension. Merchants can upload serviceable countries and postal codes, set delivery days, manage holidays and weekends, configure COD availability, and optionally use inventory-aware delivery messages for selected variants.

Feature ideas:
- Add a postal and ZIP code checker to product pages without theme code edits.
- Upload serviceable country/postal-code coverage by CSV or enter records manually.
- Show estimated delivery dates using cutoff, weekend, and holiday rules.
- Display COD availability for each serviceable postal code.
- Optionally check selected variant inventory before showing delivery estimates.

Suggested category: Store design or Shipping and delivery, depending on available Partner Dashboard categories.

Sales channel requirement: Merchant must have Online Store.

Geographic requirement: Built for global postal and ZIP code coverage. India-only Shiprocket checks are optional and disabled unless credentials are configured.

Languages supported: English.

Pricing: Use Shopify App Pricing in the Partner Dashboard. If no paid plans are needed for the first release, submit as a free app.

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
3. Go to Delivery settings.
4. Add a postal code manually, for example `US, 10001, 2 delivery days, serviceable`.
5. Open Help and click Add block in Theme Editor.
6. Save the app block on the product template.
7. Open a product page on the storefront.
8. Select `United States`, enter `10001`, and confirm the app shows a successful delivery estimate.
9. Enter an invalid postal code like `123` and confirm the app shows a validation message.
10. Optional: enable inventory-aware delivery estimates and test a selected product variant.

## Required Dashboard Items

- Public distribution selected.
- Production URLs set to the hosted HTTPS domain.
- Compliance webhooks configured and reachable.
- Emergency developer contact configured.
- App icon uploaded as 1200 x 1200 PNG or JPEG.
- Three to six screenshots uploaded at 1600 x 900.
- Demo screencast in English or with English subtitles.
- Pricing configured with Shopify App Pricing or marked free.
