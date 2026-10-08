import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useNavigation, useRouteError } from "react-router";
import { NavMenu } from "@shopify/app-bridge-react";
import enTranslations from "@shopify/polaris/locales/en.json";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { requireActiveBilling } from "../services/billing.server";
import { accessForPlan, NO_PLAN_ACCESS } from "../services/plans.server";
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
  const pathname = new URL(request.url).pathname;
  const isPlansRoute = pathname.replace(/\/+$/, "") === "/app/plans";
  const billingExempt = isPlansRoute || pathname.replace(/\/+$/, "") === "/app/headless-api";
  const context = billingExempt
    ? await authenticate.admin(request)
    : await requireActiveBilling(request);
  const access = billingExempt ? NO_PLAN_ACCESS : accessForPlan("standard");

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", access, shop: context.session.shop };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const navigating = navigation.state !== "idle";

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisProvider i18n={enTranslations} linkComponent={PolarisLink}>
        <NavMenu>
          <a href="/app" rel="home">
            Home
          </a>
          <a href="/app/delivery-settings">Delivery settings</a>
          <a href="/app/storefront-customization">Storefront style</a>
          <a href="/app/locations">Delivery &amp; pickup</a>
          <a href="/app/service-rules">Service rules</a>
          <a href="/app/analytics">Analytics</a>
          <a href="/app/headless-api">Headless API</a>
          <a href="/app/plans">Plans</a>
          <a href="/app/additional">Setup guide</a>
        </NavMenu>
        <div className={`incode-route-progress${navigating ? " is-active" : ""}`} aria-hidden={!navigating}>
          <span />
        </div>
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
