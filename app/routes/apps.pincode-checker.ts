import type { LoaderFunctionArgs } from "react-router";
import { checkPincodeDelivery, parseCodRequestParam } from "../services/pincode-checker.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const pincode = url.searchParams.get("pincode") ?? "";
  const cod = parseCodRequestParam(url.searchParams.get("cod"));
  const shop = url.searchParams.get("shop") ?? undefined;

  const result = await checkPincodeDelivery({ pincode, codRequested: cod, shop });
  return Response.json(result, {
    headers: {
      "Cache-Control": "private, max-age=0, s-maxage=60",
    },
  });
}
