import type { PostalCode } from "@prisma/client";

export const BULK_RULE_FIELDS = [
  "deliveryDays", "serviceable", "city", "state",
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
