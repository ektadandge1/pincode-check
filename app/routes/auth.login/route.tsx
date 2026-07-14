import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import enTranslations from "@shopify/polaris/locales/en.json";
import {
  AppProvider as PolarisProvider,
  BlockStack,
  Card,
  Page,
  Text,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { errors } = actionData || loaderData;

  return (
    <ShopifyAppProvider embedded={false}>
      <PolarisProvider i18n={enTranslations}>
        <Page narrowWidth title="Log in">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Start installation from Shopify
              </Text>
              <Text as="p" tone="subdued">
                Public app installs must begin from Shopify App Store, Shopify
                admin, or Partner Dashboard surfaces. Open the app from Shopify
                with your shop context to continue OAuth authentication.
              </Text>
              {errors.shop ? (
                <Text as="p" tone="critical">
                  {errors.shop}
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        </Page>
      </PolarisProvider>
    </ShopifyAppProvider>
  );
}
