import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Link,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return {
    shop: session.shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export default function AdditionalPage() {
  const { shop, apiKey } = useLoaderData<typeof loader>();
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/delivery-checker&target=mainSection`;

  return (
    <Page title="Help">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                Setup checklist
              </Text>
              <Text as="p" tone="subdued">
                Use these steps to turn on delivery availability checks for your
                product pages.
              </Text>
              <List type="number">
                <List.Item>Configure cutoff time, weekends, and holidays.</List.Item>
                <List.Item>Upload serviceable country and postal code coverage by CSV.</List.Item>
                <List.Item>Add manual overrides for priority locations.</List.Item>
                <List.Item>
                  Add the Delivery availability checker app block to the product template in
                  the Theme Editor.
                </List.Item>
                <List.Item>
                  Test a valid serviceable postal code and an unavailable postal code on a
                  product page before publishing.
                </List.Item>
              </List>
              <InlineStack gap="300">
                <Button url={themeEditorUrl} target="_blank" variant="primary">
                  Add block in Theme Editor
                </Button>
                <Button url="/app/delivery-settings">Open delivery settings</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                CSV format
              </Text>
              <Text as="p" tone="subdued">
                Required columns are country, postal_code, and delivery_days.
                Optional columns are serviceable, cod_available, city, state,
                and zone.
              </Text>
              <InlineStack>
                <Link url="/app/delivery-settings">Manage delivery settings</Link>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
