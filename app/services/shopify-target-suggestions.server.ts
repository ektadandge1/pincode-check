export type TargetSuggestion = { label: string; value: string };
export type ShopifyTargetSuggestions = Record<"product" | "collection" | "vendor" | "tag", TargetSuggestion[]>;

type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

async function readConnection<T>(
  admin: AdminClient,
  resource: "products" | "collections" | "productVendors" | "productTags",
): Promise<T[]> {
  const values: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const fields = resource === "products"
      ? "nodes { id title handle }"
      : resource === "collections"
        ? "nodes { handle title }"
        : "nodes";
    const sort = resource === "products" || resource === "collections" ? ", sortKey: TITLE" : "";
    const response = await admin.graphql(`#graphql
      query TargetSuggestions($after: String) {
        ${resource}(first: 250, after: $after${sort}) {
          ${fields}
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { variables: { after: cursor } });
    const payload = await response.json() as {
      data?: Record<string, { nodes?: T[]; pageInfo?: PageInfo }>;
      errors?: Array<{ message?: string }>;
    };
    const connection = payload.data?.[resource];
    if (!response.ok || payload.errors?.length || !Array.isArray(connection?.nodes) || !connection.pageInfo) {
      throw new Error(payload.errors?.[0]?.message ?? `Unable to load Shopify ${resource}.`);
    }
    values.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return values;
    const next = connection.pageInfo.endCursor;
    if (!next || next === cursor || seenCursors.has(next)) {
      throw new Error(`Shopify ${resource} pagination did not advance.`);
    }
    seenCursors.add(next);
    cursor = next;
  } while (cursor);
  return values;
}

export async function loadShopifyTargetSuggestionsForKind(
  admin: AdminClient,
  kind: keyof ShopifyTargetSuggestions,
): Promise<TargetSuggestion[]> {
  if (kind === "product") {
    return (await readConnection<{ id: string; title: string; handle: string }>(admin, "products")).map((product) => ({
      label: `${product.title} · ${product.handle}`,
      value: product.id.replace(/^gid:\/\/shopify\/Product\//, ""),
    }));
  }
  if (kind === "collection") {
    return (await readConnection<{ handle: string; title: string }>(admin, "collections")).map((collection) => ({
      label: `${collection.title} · ${collection.handle}`,
      value: collection.handle.toLowerCase(),
    }));
  }
  const values = await readConnection<string>(admin, kind === "vendor" ? "productVendors" : "productTags");
  const unique = new Map<string, TargetSuggestion>();
  for (const value of values) {
    const label = value.trim();
    const normalized = label.toLowerCase();
    if (label && !unique.has(normalized)) unique.set(normalized, { label, value: normalized });
  }
  return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export async function loadShopifyTargetSuggestions(admin: AdminClient): Promise<ShopifyTargetSuggestions> {
  const [product, collection, vendor, tag] = await Promise.all([
    loadShopifyTargetSuggestionsForKind(admin, "product"),
    loadShopifyTargetSuggestionsForKind(admin, "collection"),
    loadShopifyTargetSuggestionsForKind(admin, "vendor"),
    loadShopifyTargetSuggestionsForKind(admin, "tag"),
  ]);
  return { product, collection, vendor, tag };
}
