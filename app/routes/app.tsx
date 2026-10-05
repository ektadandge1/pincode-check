import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, redirect, useLoaderData, useRouteError } from "react-router";
import { NavMenu } from "@shopify/app-bridge-react";
import enTranslations from "@shopify/polaris/locales/en.json";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { resolvePlanAccess } from "../services/partner-api.server";
import { requiresDocumentNavigation } from "../utils/navigation";

type PolarisLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  url: string;
  external?: boolean;
  children?: ReactNode;
};

function PolarisLink({ url, external, children, ...props }: PolarisLinkProps) {
  if (requiresDocumentNavigation(url, { external, target: props.target, download: props.download })) {
    return <a href={url} {...props}>{children}</a>;
  }
  return <Link to={url} {...props}>{children}</Link>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const access = await resolvePlanAccess({ shop: session.shop, admin });
  const pathname = new URL(request.url).pathname;
  if (!access.active && pathname !== "/app/plans") {
    throw redirect("/app/plans");
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", access };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisProvider i18n={enTranslations} linkComponent={PolarisLink}>
        <NavMenu>
          <a href="/app" rel="home">
            Home
          </a>
          <a href="/app/delivery-settings">Delivery control</a>
          <a href="/app/storefront-customization">Storefront style</a>
          <a href="/app/locations">Locations</a>
          <a href="/app/shipping-methods">Shipping methods</a>
          <a href="/app/analytics">Analytics</a>
          <a href="/app/plans">Plans</a>
          <a href="/app/additional">Help</a>
        </NavMenu>
        <div className="incode-admin-shell">
          <Outlet />
        </div>
      </PolarisProvider>
    </ShopifyAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
