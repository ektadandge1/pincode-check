type LocationResult = {
  fulfillment_location_id?: string;
  fulfillment_location_name?: string;
  pickup_available?: boolean;
  pickup_instructions?: string;
  local_delivery_available?: boolean;
};

export function cartLocationOptions(results: LocationResult[], complete: boolean) {
  const first = results[0];
  const sameLocation = complete && Boolean(first?.fulfillment_location_id)
    && results.every((result) => result.fulfillment_location_id === first.fulfillment_location_id);
  const pickup = sameLocation && results.every((result) => result.pickup_available === true);
  return {
    fulfillment_location_id: sameLocation ? first.fulfillment_location_id : undefined,
    fulfillment_location_name: sameLocation ? first.fulfillment_location_name : undefined,
    pickup_available: pickup,
    pickup_instructions: pickup ? first.pickup_instructions : undefined,
    local_delivery_available: complete && results.length > 0 && results.every((result) => result.local_delivery_available === true),
  };
}

export function commonCartShippingMethods<T extends { handle: string; kind: string; estimated_date: string }>(
  results: Array<{ shipping_methods?: T[] }>,
  pickupAvailable: boolean,
): T[] {
  return (results[0]?.shipping_methods ?? []).flatMap((method) => {
    if (method.kind === "pickup" && !pickupAvailable) return [];
    const matching = results.map((result) => result.shipping_methods?.find((candidate) => candidate.handle === method.handle && candidate.kind === method.kind));
    if (matching.some((candidate) => !candidate)) return [];
    return [[...matching].sort((a, b) => b!.estimated_date.localeCompare(a!.estimated_date))[0]!];
  });
}
