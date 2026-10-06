import type { PostalCode } from "@prisma/client";

export const BULK_RULE_FIELDS = [
  "deliveryDays", "serviceable", "codAvailable", "deliveryCharge", "currency",
  "sameDayAvailable", "nextDayAvailable", "expressAvailable", "city", "state",
] as const;

type BulkField = (typeof BULK_RULE_FIELDS)[number];
type RulePatch = Partial<Pick<PostalCode, BulkField>>;

export function parseZoneRulePatch(form: FormData): RulePatch {
  const patch: RulePatch = {};
  for (const field of BULK_RULE_FIELDS) {
    if (form.get(`apply_${field}`) !== "true") continue;
    const raw = String(form.get(field) ?? "").trim();
    if (field === "deliveryDays") {
      const days = Number(raw);
      if (!raw || !Number.isInteger(days) || days < 0 || days > 60) {
        throw new Error("Delivery days should be between 0 and 60.");
      }
      patch.deliveryDays = days;
    } else if (field === "deliveryCharge") {
      const charge = raw ? Number(raw) : null;
      if (charge !== null && (!Number.isFinite(charge) || charge < 0)) {
        throw new Error("Delivery charge requires a positive amount and 3-letter currency.");
      }
      patch.deliveryCharge = charge;
    } else if (field === "currency") {
      const currency = raw.toUpperCase() || null;
      if (currency && !/^[A-Z]{3}$/.test(currency)) {
        throw new Error("Currency must be a 3-letter ISO code such as USD.");
      }
      patch.currency = currency;
    } else if (field === "city" || field === "state") {
      patch[field] = raw || null;
    } else {
      if (raw !== "true" && raw !== "false") throw new Error(`Choose Yes or No for ${field}.`);
      patch[field] = raw === "true";
    }
  }
  if (Object.keys(patch).length === 0) throw new Error("Choose at least one field to apply.");
  return patch;
}

export function validatePatchedRule(
  rule: Pick<PostalCode, "deliveryCharge" | "currency">,
  patch: RulePatch,
) {
  const charge = patch.deliveryCharge === undefined ? rule.deliveryCharge : patch.deliveryCharge;
  const currency = patch.currency === undefined ? rule.currency : patch.currency;
  if (charge !== null && (!Number.isFinite(charge) || charge < 0 || !currency || !/^[A-Z]{3}$/.test(currency))) {
    throw new Error("Delivery charge requires a positive amount and 3-letter currency. Apply a currency too, or clear the charge.");
  }
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Currency must be a 3-letter ISO code such as USD.");
  }
}
