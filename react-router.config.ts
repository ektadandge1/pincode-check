import type { Config } from "@react-router/dev/config";

const developmentActionOrigins = process.env.NODE_ENV === "production"
  ? []
  : ["null", "*.trycloudflare.com"];

export default {
  allowedActionOrigins: ["admin.shopify.com", ...developmentActionOrigins],
} satisfies Config;
