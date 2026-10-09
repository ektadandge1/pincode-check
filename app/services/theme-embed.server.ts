type AdminGraphqlClient = {
  graphql: (query: string) => Promise<Response>;
};

type ThemeSettings = {
  current?: {
    blocks?: Record<string, { type?: unknown; disabled?: unknown }>;
  };
};

export function themeEmbedEnabled(
  settingsJson: string,
  appHandle: string,
  blockHandle: string,
): boolean {
  try {
    const settings = JSON.parse(settingsJson) as ThemeSettings;
    const blockPath = `/apps/${appHandle}/blocks/${blockHandle}/`;
    return Object.values(settings.current?.blocks ?? {}).some((block) => (
      typeof block.type === "string"
      && block.type.includes(blockPath)
      && block.disabled !== true
    ));
  } catch {
    return false;
  }
}

export async function isPublishedThemeEmbedEnabled(
  admin: AdminGraphqlClient,
  appHandle: string,
  blockHandle: string,
): Promise<boolean> {
  try {
    const response = await admin.graphql(`#graphql
      query PublishedThemeAppEmbed {
        themes(first: 1, roles: [MAIN]) {
          nodes {
            files(first: 1, filenames: ["config/settings_data.json"]) {
              nodes {
                body {
                  ... on OnlineStoreThemeFileBodyText {
                    content
                  }
                }
              }
            }
          }
        }
      }
    `);
    const payload = await response.json() as {
      data?: {
        themes?: {
          nodes?: Array<{
            files?: { nodes?: Array<{ body?: { content?: unknown } }> };
          }>;
        };
      };
    };
    const content = payload.data?.themes?.nodes?.[0]?.files?.nodes?.[0]?.body?.content;
    return typeof content === "string" && themeEmbedEnabled(content, appHandle, blockHandle);
  } catch (error) {
    console.error("Unable to read published theme app embed status", error);
    return false;
  }
}
