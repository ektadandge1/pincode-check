import type { ProductEstimateBatchItem } from "../utils/targeting.server";

type ProxyAdmin = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type CanonicalProduct = {
  id: string;
  vendor: string;
  tags: string[];
  collectionHandles: string[];
};

function shopifyGid(kind: "Product" | "ProductVariant", value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (/^[0-9]+$/.test(raw)) return `gid://shopify/${kind}/${raw}`;
  return new RegExp(`^gid://shopify/${kind}/[0-9]+$`).test(raw) ? raw : null;
}

export async function resolveShopifyProductContexts(
  admin: ProxyAdmin | undefined,
  inputs: Array<{ productId?: string | null; variantId?: string | null }>,
) {
  if (!admin) throw new Error("Shopify product context is unavailable.");
  const ids = [...new Set(inputs.flatMap((input) => [
    shopifyGid("Product", input.productId),
    shopifyGid("ProductVariant", input.variantId),
  ]).filter((value): value is string => Boolean(value)))];
  if (!ids.length) return { products: new Map<string, CanonicalProduct>(), variants: new Map<string, CanonicalProduct>() };
  if (ids.length > 50) throw new RangeError("Too many Shopify product contexts.");

  const response = await admin.graphql(`#graphql
    query DeliveryCheckerProductContexts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id vendor tags
          collections(first: 100) { nodes { handle } pageInfo { hasNextPage } }
        }
        ... on ProductVariant {
          id
          product {
            id vendor tags
            collections(first: 100) { nodes { handle } pageInfo { hasNextPage } }
          }
        }
      }
    }
  `, { variables: { ids } });
  if (!response.ok) throw new Error(`Shopify returned HTTP ${response.status} while resolving product context.`);
  const json = await response.json() as {
    data?: { nodes?: Array<null | {
      id: string;
      vendor?: string;
      tags?: string[];
      collections?: { nodes?: Array<{ handle?: string }>; pageInfo?: { hasNextPage: boolean } };
      product?: {
        id: string;
        vendor?: string;
        tags?: string[];
        collections?: { nodes?: Array<{ handle?: string }>; pageInfo?: { hasNextPage: boolean } };
      };
    }> };
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) throw new Error(json.errors.map((error) => error.message).filter(Boolean).join(" "));

  const products = new Map<string, CanonicalProduct>();
  const variants = new Map<string, CanonicalProduct>();
  const normalize = (product: NonNullable<NonNullable<NonNullable<typeof json.data>["nodes"]>[number]>) => {
    if (product.collections?.pageInfo?.hasNextPage) {
      throw new Error("Shopify product collection context exceeds 100 collections.");
    }
    return {
      id: product.id,
      vendor: String(product.vendor ?? "").slice(0, 100),
      tags: (product.tags ?? []).map(String),
      collectionHandles: (product.collections?.nodes ?? []).flatMap((collection) => collection.handle ? [collection.handle] : []),
    };
  };
  for (const node of json.data?.nodes ?? []) {
    if (!node) continue;
    if (node.product) {
      const product = normalize(node.product);
      variants.set(node.id, product);
      products.set(product.id, product);
    } else {
      products.set(node.id, normalize(node));
    }
  }
  return { products, variants };
}

export function canonicalProductFor(
  resolved: Awaited<ReturnType<typeof resolveShopifyProductContexts>>,
  productId?: string | null,
  variantId?: string | null,
) {
  const productGid = shopifyGid("Product", productId);
  const variantGid = shopifyGid("ProductVariant", variantId);
  if ((productId && !productGid) || (variantId && !variantGid)) return null;
  const fromProduct = productGid ? resolved.products.get(productGid) : undefined;
  const fromVariant = variantGid ? resolved.variants.get(variantGid) : undefined;
  if (productGid && !fromProduct) return null;
  if (variantGid && (!fromVariant || (fromProduct && fromVariant.id !== fromProduct.id))) return null;
  return fromProduct ?? fromVariant ?? null;
}

export function canonicalBatchItems(items: ProductEstimateBatchItem[], resolved: Awaited<ReturnType<typeof resolveShopifyProductContexts>>) {
  return items.flatMap((item) => {
    const product = canonicalProductFor(resolved, item.productId, null);
    return product ? [{
      ...item,
      productId: product.id,
      productVendor: product.vendor,
      productTags: product.tags,
      collectionHandles: product.collectionHandles,
    }] : [];
  });
}
