import { redirect } from "react-router";

// Keep existing bookmarks and open Shopify tabs from landing on a 404 after this page was removed.
export function loader() {
  return redirect("/app/delivery-settings");
}

export default function RemovedShippingMethodsPage() {
  return null;
}
