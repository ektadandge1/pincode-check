export type LocationTargetService = "local_delivery" | "pickup";

type LocationTargetRule = {
  localDeliveryTargetMode?: string | null;
  localDeliveryTargetValuesCsv?: string | null;
  pickupTargetMode?: string | null;
  pickupTargetValuesCsv?: string | null;
  serviceTargetMode?: string | null;
  serviceTargetValuesCsv?: string | null;
};

type LocationTargetInput = {
  productId?: string | null;
  productTags?: string[] | null;
  collectionHandles?: string[] | null;
  zoneId?: number | null;
};

export function locationTarget(rule: LocationTargetRule, service: LocationTargetService) {
  const mode = service === "local_delivery" ? rule.localDeliveryTargetMode : rule.pickupTargetMode;
  const valuesCsv = service === "local_delivery" ? rule.localDeliveryTargetValuesCsv : rule.pickupTargetValuesCsv;
  return {
    mode: mode || rule.serviceTargetMode || "all",
    values: new Set((valuesCsv ?? rule.serviceTargetValuesCsv ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)),
  };
}

export function matchesLocationTarget(rule: LocationTargetRule, service: LocationTargetService, input: LocationTargetInput): boolean {
  const target = locationTarget(rule, service);
  if (target.mode === "all") return true;
  if (target.mode === "zone") return input.zoneId !== null && input.zoneId !== undefined && target.values.has(String(input.zoneId));
  if (target.mode === "product") return Boolean(input.productId && target.values.has(String(input.productId).replace(/\D/g, "")));
  if (target.mode === "collection") return (input.collectionHandles ?? []).some((handle) => target.values.has(String(handle).toLowerCase()));
  if (target.mode === "tag") return (input.productTags ?? []).some((tag) => target.values.has(String(tag).toLowerCase()));
  return false;
}

export function locationTargetMode(rule: LocationTargetRule, service: LocationTargetService): string {
  return locationTarget(rule, service).mode;
}
