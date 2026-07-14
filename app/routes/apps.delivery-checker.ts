import type { LoaderFunctionArgs } from "react-router";
import { checkDelivery, parseCodRequestParam } from "../services/delivery-checker.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const proxyContext = await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const country = url.searchParams.get("country") ?? undefined;
  const postalCode =
    url.searchParams.get("postal_code") ??
    url.searchParams.get("postalCode") ??
    url.searchParams.get("pincode") ??
    "";
  const cod = parseCodRequestParam(url.searchParams.get("cod"));
  const variantId = url.searchParams.get("variantId") ?? undefined;
  const quantityRaw = Number(url.searchParams.get("qty") ?? "1");
  const quantity = Number.isFinite(quantityRaw) ? quantityRaw : 1;
  const shop = proxyContext.session?.shop ?? (url.searchParams.get("shop") ?? undefined);

  const result = await checkDelivery({
    country,
    postalCode,
    codRequested: cod,
    shop,
    variantId,
    quantity,
    admin: proxyContext.admin,
  });
  return Response.json(result, {
    headers: {
      "Cache-Control": "private, max-age=0, s-maxage=60",
    },
  });
}
