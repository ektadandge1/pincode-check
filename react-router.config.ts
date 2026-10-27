import type { Config } from "@react-router/dev/config";

const developmentActionOrigins = process.env.NODE_ENV === "production"
  ? []
  : ["null", "*.trycloudflare.com"];

export default {
  // TLS terminates at Caddy, so the Node request origin may differ from the
  // browser's HTTPS origin. Allow the exact app host, not arbitrary origins.
  allowedActionOrigins: ["zippin.bmconsulting.in", "admin.shopify.com", ...developmentActionOrigins],
} satisfies Config;
