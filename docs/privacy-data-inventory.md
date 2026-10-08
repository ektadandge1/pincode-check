# Privacy Data Inventory

This inventory describes the current Prisma schema and write paths, not a Shopify compliance certification. Recheck it whenever the schema, logging, integrations or storefront attributes change.

| App-Owned Storage | Contents | Deletion |
| --- | --- | --- |
| Session | Shop, scopes, OAuth credentials and optional merchant/staff user ID, name, email, locale and account flags | Uninstall and shop redaction |
| Zone, PostalCode, DeliverySetting, DeliveryTarget | Merchant coverage, delivery settings, product/collection/tag targeting and free-text messages | Shop redaction |
| FulfillmentLocationRule, ShippingMethodRule | Location identifiers, delivery/pickup settings, app-defined shipping options and messages | Shop redaction |
| ImportJob, ImportError | Import counts/status, errors and raw failed CSV rows; import errors have mandatory foreign-key ownership through job IDs | Shop redaction; deleting a job cascades to its errors |
| PostalCodeSearchEvent | Shop, country, masked postal region, numeric product/variant IDs, availability/COD/days/source and timestamp; city/state columns exist but the current writer leaves them null | Shop redaction; opportunistic age pruning |
| HeadlessApiToken | Hash/prefix, shop, name, type, scopes, origins, usage/expiry/revocation timestamps; no raw token in this table | Revoked on uninstall; deleted on shop redaction |
| HeadlessRateLimit | Counters/expiry keyed by `shop:<shop>:<type>:<window>` or `token:<id>:<window>` | Expired buckets pruned during API requests; shop redaction deletes shop prefix and each stored token ID prefix |

There is no customer identity/address/order/payment/checkout table or customer ID/email association on lookup events. Merchant staff identity in Session is personal data, and raw import rows or arbitrary free-text configuration can contain merchant-supplied personal data. Do not import customer lists or place credentials/personal data in custom messages. No claim is made that all stored information is anonymous.

The current lookup writer masks postal codes and retains numeric product/variant IDs. Its 90-day cutoff is applied on every hundredth process-local write, only for the shop being written. It is not scheduled retention enforcement: inactive shops can retain older events until subsequent cleanup or shop redaction. Merchant coverage PostalCode rows retain complete merchant-defined postal rules, unlike masked shopper lookup events.

## Webhook Behavior

All topics authenticate through Shopify webhook authentication before touching data. `customers/data_request` and `customers/redact` return HTTP 200 because the app has no customer-linked record set to retrieve/delete. They neither export a fictitious customer dataset nor remove all merchant configuration based on a customer request.

`app/uninstalled` atomically deletes sessions and revokes headless tokens without relying on an active session, then acknowledges. Merchant settings/rules/imports/analytics remain pending Shopify's `shop/redact`; there is no general immediate-uninstall deletion guarantee. `shop/redact` deletes all current app-owned shop rows in an interactive transaction, including import errors and headless counters. Token IDs are read inside that transaction before token deletion so their buckets can be removed. Import errors cascade when their owning jobs are deleted; a late importer error write for a deleted job fails the foreign-key constraint. The ownership migration discards historical orphan errors whose owning job, and thus shop identity, no longer exists while preserving errors with valid jobs. Both routes evict the process-local plan cache before persistence operations; redaction also evicts delivery-result caches before and after deletion. Database failures propagate rather than acknowledging a failed cleanup. Cache invalidation is process-local; the launch topology is a single application instance.

Shopify cart attributes written by delivery widgets may contain postal/selection/estimate information and may appear on Shopify orders. These are Shopify-owned records, not stored customer records in this app database. The authenticated pickup-orders view uses `read_orders` to query recent pickup selections and customer fulfillment details live from Shopify; it does not persist that response. The app cannot erase or export Shopify-owned order records through its privacy route. Shopify and the merchant must handle those records under their applicable obligations.

## Operational Boundaries

- Full request input is processed transiently for delivery checks; do not enable request-body or credential logging at the host/proxy.
- Optional courier serviceability requests send postal/context data to the configured provider; validate provider terms and disclosures before enabling credentials.
- Database backups, host logs and third-party retention are not deleted by a Prisma webhook transaction. Define restricted access, retention/expiry and redaction-aware restore procedures before launch.
- Verify public privacy/support pages and Partner Dashboard declarations match this inventory and the production host's actual logging and backup policies. This inventory does not certify legal compliance.
