const defaultAppName = "ETADeliverPickup";

function productionValue(name: string, required = true): string {
  const value = process.env[name]?.trim() ?? "";
  if (required && process.env.NODE_ENV === "production" && !value) {
    throw new Error(`${name} must be configured in production.`);
  }
  return value;
}

export function privacyContact() {
  const privacyEmail = productionValue("PRIVACY_EMAIL", false);
  const supportEmail = productionValue("SUPPORT_EMAIL", false);
  if (process.env.NODE_ENV === "production" && !privacyEmail && !supportEmail) {
    throw new Error("PRIVACY_EMAIL or SUPPORT_EMAIL must be configured in production.");
  }
  const contactEmail = privacyEmail || supportEmail;
  const legalBusinessName = productionValue("LEGAL_BUSINESS_NAME") || defaultAppName;
  return { contactEmail, legalBusinessName };
}

export function supportContact() {
  return { contactEmail: productionValue("SUPPORT_EMAIL") };
}
