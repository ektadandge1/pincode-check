export type LocationPriorityMode = "manual" | "highest_stock";

export function selectFulfillmentLocation<T extends { shopifyLocationId: string; priority: number }>(
  rules: T[],
  inventoryLevels: Array<{ locationId: string; available: number }>,
  requestedQuantity: number,
  continueSelling: boolean,
  mode: LocationPriorityMode,
): T | null {
  const availableByLocation = new Map(inventoryLevels.map((level) => [level.locationId, level.available]));
  const eligible = rules.filter((rule) =>
    continueSelling || (availableByLocation.get(rule.shopifyLocationId) ?? 0) >= requestedQuantity,
  );
  if (mode === "highest_stock") {
    eligible.sort((a, b) =>
      (availableByLocation.get(b.shopifyLocationId) ?? 0) - (availableByLocation.get(a.shopifyLocationId) ?? 0)
      || a.priority - b.priority,
    );
  }
  return eligible[0] ?? null;
}
