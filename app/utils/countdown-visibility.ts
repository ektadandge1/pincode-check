type CountdownSetting = {
  countdownEnabled: boolean;
  countdownDisplaySurfacesCsv: string;
  countdownTargetMode: string;
  countdownProductIdsCsv: string;
  countdownCollectionHandlesCsv: string;
  countdownZoneIdsCsv: string;
};

export function countdownVisible(
  setting: CountdownSetting | null,
  context: { productId?: string; collectionHandles?: string[]; zoneId?: number | null },
  surface: string,
): boolean {
  if (!setting?.countdownEnabled) return false;
  const values = (csv: string) => csv.split(",").map((value) => value.trim()).filter(Boolean);
  if (!values(setting.countdownDisplaySurfacesCsv).includes(surface)) return false;
  if (setting.countdownTargetMode === "products") {
    const productId = (value: string) => /^(?:gid:\/\/shopify\/Product\/)?([0-9]+)$/.exec(value.trim())?.[1];
    const id = productId(context.productId ?? "");
    return Boolean(id && values(setting.countdownProductIdsCsv).some((value) => productId(value) === id));
  }
  if (setting.countdownTargetMode === "collections") {
    const selected = new Set(values(setting.countdownCollectionHandlesCsv));
    return (context.collectionHandles ?? []).some((handle) => selected.has(handle));
  }
  if (setting.countdownTargetMode === "zones") {
    return context.zoneId != null && values(setting.countdownZoneIdsCsv).includes(String(context.zoneId));
  }
  return true;
}
