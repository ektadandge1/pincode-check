-- Shopify App Pricing and the Partner API are authoritative. Local subscription
-- state can become stale, so remove the abandoned billing cache table.
DROP TABLE IF EXISTS "AppSubscription";
