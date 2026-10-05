import type { Config } from "@react-router/dev/config";

// Shopify's embedded development proxy can forward actions with either an
// opaque origin or the public Cloudflare tunnel origin. The request is still
// authenticated by Shopify App Bridge and `authenticate.admin`.
export default {
  allowedActionOrigins: ["null", "*.trycloudflare.com", "admin.shopify.com"],
} satisfies Config;
