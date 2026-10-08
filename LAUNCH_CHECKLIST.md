# Launch Checklist

Status: **Not approved for launch by this document.** All items start unverified. Local tests are not evidence of a live Shopify install, deployed webhooks, production storage or App Store approval. Assign an owner and record date, environment, build/release ID and evidence for each gate; never attach secrets, customer data or raw tokens.

## Known Blockers

- The public privacy page now describes opportunistic retention, merchant sessions, product/variant analytics context, and Shopify-owned cart/order attributes. The release owner must verify it against the production host's actual logging and backup policies.
- TOML scopes now match the implemented product/inventory/location/order/proxy features. Protected customer data approval, production domains and released Partner configuration still require verification; local configuration changes do not grant scopes to installed shops.
- Live install/billing/webhook tests, durable storage/restore verification, performance evidence and Shopify review/approval remain unverified by this implementation task.

## Code-Complete Locally

- [x] Public privacy and support routes require production contact/legal identity instead of silently publishing blank or generic production details.
- [x] Mandatory privacy, uninstall, and scope-update webhook handlers authenticate through Shopify; shop redaction deletes current app-owned records and revokes storefront API tokens.
- [x] Production environment validation rejects missing identity, billing, scope, URL, and persistence settings without printing supplied secrets.
- [x] Local automated tests, typecheck, application build, and Shopify extension build pass on the current release tree.

## Prerequisites

- [ ] Release owner releases TOML scopes `read_products,read_inventory,read_locations,read_orders,write_app_proxy`, obtains applicable protected customer data approval, and verifies reauthorization on an existing install.
- [ ] In Partner Dashboard, declare protected customer data use for `read_orders`: authenticated merchants can view live order customer name, email, phone, and shipping address for pickup/delivery fulfillment; the app does not persist those Shopify order records.
- [ ] Final HTTPS domain, OAuth redirects, app proxy, app handle, compliance topics and uninstall webhook match the released Shopify configuration. No example URLs or temporary tunnels remain.
- [ ] Production secrets are supplied through the host's secret manager. Support email and legal business identity are real; public support/privacy pages are reachable and match the data inventory.
- [ ] Production environment has `NODE_ENV=production`, `APP_ENV=production`, billing test `false`, billing required `true`, dev bypass `false` or unset. Run `node scripts/check-env.mjs` against deployment-injected values without loading a developer `.env`. Resolve warnings with infrastructure evidence.
- [ ] SQLite uses an absolute `file:` path on a persistent writable volume and a single app instance. Verify volume survives restart/redeploy and has adequate capacity, restricted access and monitoring. Do not use an ephemeral container filesystem or horizontal replicas for this SQLite launch.
- [ ] Document backup frequency, encrypted retention/access, restore test, rollback and redaction-aware backup restoration. Define how inactive-shop analytics are aged out; current 90-day cleanup is opportunistic, not a guaranteed maximum.
- [ ] Release owner reviews migrations and runs the approved production migration procedure during deployment. This implementation task does not run migrations or deploy.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` and `shopify app build` on the release tree. Record results and investigate failures, including concurrent/unrelated changes.
- [ ] Separate non-production test installation uses test billing and dev bypass `false` to exercise real Shopify approval flows without real charges. Public production retains safe enforced flags; coordinate reviewer access with current Shopify guidance.

## Functional Matrix

Record Pass/Fail/Blocked with sanitized evidence for every row on the release candidate. Browser tests require both desktop and mobile, and Theme Editor checks require save/reload as well as preview.

| Area | Test | Required Result |
| --- | --- | --- |
| Install/auth | Fresh install, existing-install scope update, Chrome incognito, expired session, reinstall | Embedded admin opens, required scopes granted, no redirect loop or cross-shop data |
| Billing | Test approval/trial, decline, duplicate submit, return redirect, cancel, expiry, reinstall | One intended charge; no unauthorized paid access; admin redirects to Plans, proxy/API return 402 when inactive |
| Production billing | Missing/test-enabled/required-disabled/bypass-enabled settings using isolated fixtures | CLI nonzero; runtime rejects unsafe production config, including NODE_ENV production with APP_ENV development |
| Postal coverage | Exact/range/wildcard, overlapping zone priorities, countries, invalid/unavailable input | Correct specificity and serviceability, safe validation and isolated shop data |
| Imports | CSV success/errors/export, raw failed rows, manual Google Sheet sync | Accurate counts/errors, shop isolation and no unintended customer data imported |
| Targeting | Product/collection/tag, disabled/excluded/scheduled rule, tampered client context | Authoritative product context and intended precedence; no forged targeting bypass |
| Inventory/locations | Variant switch, quantity, tracked/untracked, continue/deny selling, zero/positive/negative stock, enabled/disabled locations | Correct eligibility and priority, no stale variant result; fail safely on API errors |
| Dates/countdown | Cutoff before/after, timezone, weekends/holidays, targeting surfaces, settings update | Consistent ETA/countdown visibility; no expired or stale estimate |
| Storefront lifecycle | Product/cart/cards, two widgets, section reload, quick view, cart quantity/variant change, mobile | No duplicate listeners, stale response or cross-widget state; keyboard/accessibility works |
| Cart controls | Required PIN, unavailable PIN, change after success, local delivery/pickup/standard selection | Buttons unlock/relock correctly; Shopify attributes update/clear without stale selection; no claim of server-enforced checkout restriction |
| Headless API | Public allowed/disallowed origin, private browser request, scope/expiry/revocation, limits, two shops | Expected authorization/CORS/status; private secrets absent from browser; counters do not leak tenants |
| Customer webhooks | Signed data_request/redact, invalid signature | Valid requests acknowledge no customer-linked app dataset; invalid auth performs no mutation; Shopify attributes unchanged |
| Shop redaction | Seed every current table in two shops, token/shop rate buckets, import errors; send twice | Only target shop removed; all target buckets/errors removed; cache evicted; retry is safe; inspect DB directly |
| Uninstall | Send with no active session, repeat, persistence failure/retry | Sessions gone, tokens revoked, local plan cache evicted; failure not acknowledged; reinstall does not revive revoked tokens |
| Privacy/retention | Inspect analytics writer/schema, inactive shop, backup/log policy, cart/order attributes | Masked regions with product/variant IDs documented; no promise of scheduled 90-day deletion; Shopify-owned attribute and merchant-session boundaries disclosed |
| Operations | Restart/redeploy, database restore, failed webhook, provider outage, health/alert checks | Durable data, safe rollback, observable retries; logs contain no secrets or customer/request bodies |
| Performance/review | Lighthouse before/after on representative theme, listing/demo/reviewer access | Record current Shopify threshold evidence; claims and pricing match actual functionality; no approval claim before Shopify decision |

## Submission Gate

- [ ] Complete `APP_STORE_SUBMISSION.md` Dashboard items, demo product, English screencast and reviewer instructions with access to all advertised features.
- [ ] Verify current Shopify requirements and protected-data declarations against final code; obtain any required approval rather than assuming it from local scope choices.
- [ ] Confirm all functional rows have evidence or an explicitly accepted non-launch-blocking rationale. Security, privacy, billing, durability and required Shopify configuration failures block launch.
- [ ] Record release owner sign-off and Shopify review decision separately. Do not label the app live/approved based on this checklist or test output.
