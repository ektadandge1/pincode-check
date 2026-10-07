export type VariantInventoryResult = {
  sellableQuantity: number;
  continueSelling: boolean;
  levels: Array<{ locationId: string; available: number; active: boolean; fulfillsOnlineOrders: boolean }>;
};

export async function checkVariantInventory(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> } | undefined,
  variantId: string,
): Promise<VariantInventoryResult | null> {
  if (!admin) return null;
  const id = /^[0-9]+$/.test(variantId) ? `gid://shopify/ProductVariant/${variantId}` : variantId;
  if (!/^gid:\/\/shopify\/ProductVariant\/[0-9]+$/.test(id)) return null;
  try {
    const response = await admin.graphql(`#graphql
      query VariantInventoryForEdd($id: ID!) {
        productVariant(id: $id) {
          inventoryPolicy
          sellableOnlineQuantity
          inventoryItem {
            inventoryLevels(first: 100) {
              pageInfo { hasNextPage }
              nodes {
                quantities(names: ["available"]) { name quantity }
                location { id isActive fulfillsOnlineOrders }
              }
            }
          }
        }
      }`, { variables: { id } });
    if (!response.ok) return null;
    const json = await response.json() as {
      errors?: unknown[];
      data?: { productVariant?: {
        sellableOnlineQuantity?: number;
        inventoryPolicy?: string;
        inventoryItem?: { inventoryLevels?: {
          pageInfo?: { hasNextPage?: boolean };
          nodes?: Array<{
            quantities?: Array<{ name?: string; quantity?: number }>;
            location?: { id?: string; isActive?: boolean; fulfillsOnlineOrders?: boolean };
          }>;
        } };
      } };
    };
    const variant = json.data?.productVariant;
    const connection = variant?.inventoryItem?.inventoryLevels;
    if (json.errors?.length || !variant || !Number.isFinite(variant.sellableOnlineQuantity)
      || !["CONTINUE", "DENY"].includes(variant.inventoryPolicy ?? "")
      || connection?.pageInfo?.hasNextPage !== false || !Array.isArray(connection.nodes)) return null;
    const levels: VariantInventoryResult["levels"] = [];
    for (const level of connection.nodes) {
      const location = level.location;
      const available = level.quantities?.find((quantity) => quantity.name === "available")?.quantity;
      if (!location?.id || typeof location.isActive !== "boolean" || typeof location.fulfillsOnlineOrders !== "boolean"
        || typeof available !== "number" || !Number.isFinite(available)) return null;
      levels.push({ locationId: location.id, available, active: location.isActive, fulfillsOnlineOrders: location.fulfillsOnlineOrders });
    }
    return { sellableQuantity: variant.sellableOnlineQuantity!, continueSelling: variant.inventoryPolicy === "CONTINUE", levels };
  } catch {
    // Transport, GraphQL and malformed responses must not become stock claims.
    return null;
  }
}
