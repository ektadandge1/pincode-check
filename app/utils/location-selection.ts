export type LocationPriorityMode = "manual" | "highest_stock";

export function selectedLocationOptions(
  location: { shopifyLocationId: string; name: string; pickupEnabled: boolean; pickupInstructions: string | null } | null,
  localDeliveryAvailable: boolean,
) {
  return {
    fulfillment_location_id: location?.shopifyLocationId,
    fulfillment_location_name: location?.name,
    local_delivery_available: Boolean(location && localDeliveryAvailable),
    pickup_available: location?.pickupEnabled ?? false,
    pickup_instructions: location?.pickupEnabled ? location.pickupInstructions || undefined : undefined,
  };
}

export function selectFulfillmentLocation<T extends { shopifyLocationId: string; priority: number }>(
  rules: T[],
  inventoryLevels: Array<{ locationId: string; available: number; active?: boolean; fulfillsOnlineOrders?: boolean }>,
  requestedQuantity: number,
  continueSelling: boolean,
  mode: LocationPriorityMode,
): T | null {
  const availableByLocation = new Map(inventoryLevels
    .filter((level) => level.active !== false && level.fulfillsOnlineOrders !== false && Number.isFinite(level.available))
    .map((level) => [level.locationId, level.available]));
  const eligible = rules.filter((rule) =>
    availableByLocation.has(rule.shopifyLocationId)
    && (continueSelling || availableByLocation.get(rule.shopifyLocationId)! >= requestedQuantity),
  );
  if (mode === "highest_stock") {
    eligible.sort((a, b) =>
      (availableByLocation.get(b.shopifyLocationId) ?? 0) - (availableByLocation.get(a.shopifyLocationId) ?? 0)
      || a.priority - b.priority,
    );
  }
  return eligible[0] ?? null;
}
