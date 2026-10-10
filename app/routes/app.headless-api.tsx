import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { Badge, Banner, BlockStack, Button, Card, Checkbox, DataTable, FormLayout, InlineStack, Layout, Page, Select, Text, TextField } from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { requireActiveBilling } from "../services/billing.server";
import { accessForPlan } from "../services/plans.server";
import { HEADLESS_READ_SCOPES, normalizeAllowedOrigins, parseHeadlessScopes, storedAllowedOriginsLabel } from "../utils/headless-tokens";

type ActionResult = { ok: boolean; message: string; token?: string };
type ActionData = ActionResult & { intent: string };
const NO_STORE = { "Cache-Control": "no-store" };

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "delivery:check": "Check availability and dates",
  "delivery:estimate": "Estimate without a postal code",
  "delivery:batch": "Check up to 50 products",
  "delivery:methods": "View shipping methods",
};

function expiryValidationError(value: string): string | undefined {
  const expiry = value.trim();
  if (!expiry) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$/.test(expiry)) {
    return "Use a UTC timestamp such as 2027-01-01T00:00:00Z (without a final period).";
  }
  const date = new Date(expiry);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
    return "Expiry must be a valid future UTC timestamp.";
  }
  if (date.toISOString().slice(0, 16) !== expiry.slice(0, 16)) {
    return "Expiry must be a valid calendar date and time.";
  }
  return undefined;
}

async function copyToken(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

export const headers: HeadersFunction = (args) => {
  const headers = new Headers(boundary.headers(args));
  headers.set("Cache-Control", "no-store");
  return headers;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await requireActiveBilling(request);
  const access = accessForPlan("standard");
  const tokens = await prisma.headlessApiToken.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    // Explicitly select safe metadata; hashes must never reach the browser.
    select: {
      id: true, name: true, tokenType: true, tokenPrefix: true, scopesCsv: true,
      allowedOriginsJson: true, enabled: true, expiresAt: true, lastUsedAt: true,
      createdAt: true, revokedAt: true,
    },
  });
  return data({ access, tokens, scopes: HEADLESS_READ_SCOPES, now: Date.now() }, { headers: NO_STORE });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await requireActiveBilling(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const reply = (result: ActionResult, status = 200) => data({ ...result, intent }, { status, headers: NO_STORE });
  if (!["create", "enable", "disable", "revoke"].includes(intent)) {
    return reply({ ok: false, message: "Unsupported action." }, 400);
  }
  let fields: { name: string; tokenType: "public" | "private"; scopesCsv: string; allowedOriginsJson: string; expiresAt: Date | null } | undefined;
  if (intent === "create") {
    try {
      const name = String(form.get("name") ?? "").trim();
      if (!name || name.length > 100) throw new Error("Enter a token name between 1 and 100 characters.");
      const tokenType = String(form.get("tokenType") ?? "");
      if (tokenType !== "public" && tokenType !== "private") throw new Error("Choose a public or private token.");
      const origins = normalizeAllowedOrigins(String(form.get("allowedOrigins") ?? ""));
      if (tokenType === "public" && !origins.length) throw new Error("Public tokens require at least one allowed origin.");
      if (tokenType === "private" && origins.length) throw new Error("Private tokens must not have allowed origins.");
      const scopes = parseHeadlessScopes(form.getAll("scopes").map(String));
      const expiry = String(form.get("expiresAt") ?? "").trim();
      const expiryError = expiryValidationError(expiry);
      if (expiryError) throw new Error(expiryError);
      const expiresAt = expiry ? new Date(expiry) : null;
      fields = { name, tokenType, scopesCsv: scopes.join(","), allowedOriginsJson: JSON.stringify(origins), expiresAt };
    } catch (error) {
      return reply({ ok: false, message: error instanceof Error ? error.message : "Invalid token fields." }, 400);
    }
  }

  // SQLite serializes write transactions: count and create/enable share the same transaction.
  const result = await prisma.$transaction(async (tx): Promise<ActionResult> => {
    const now = new Date();
    const id = String(form.get("id") ?? "");
    const existing = intent === "create" ? null : await tx.headlessApiToken.findFirst({ where: { id, shop: session.shop } });
    if (intent !== "create" && !existing) return { ok: false, message: "Token not found." };
    if (existing?.revokedAt) return { ok: false, message: "Revoked tokens cannot be changed or re-enabled." };
    if (intent === "enable" && existing?.expiresAt && existing.expiresAt <= now) {
      return { ok: false, message: "Expired tokens cannot be enabled. Create a new token instead." };
    }
    if (intent === "create" || (intent === "enable" && !existing?.enabled)) {
      const active = await tx.headlessApiToken.count({
        where: { shop: session.shop, enabled: true, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      });
      if (active >= 20) return { ok: false, message: "Limit reached: at most 20 active tokens per shop. Disable or revoke a token first." };
    }
    if (intent === "create" && fields) {
      const { generateHeadlessToken } = await import("../utils/headless-tokens.server");
      const generated = generateHeadlessToken(fields.tokenType);
      await tx.headlessApiToken.create({ data: { shop: session.shop, ...fields, tokenHash: generated.tokenHash, tokenPrefix: generated.tokenPrefix } });
      return { ok: true, message: "Token created. Copy it now; it cannot be retrieved again.", token: generated.token };
    }
    await tx.headlessApiToken.updateMany({
      where: { id, shop: session.shop, revokedAt: null },
      data: intent === "revoke" ? { enabled: false, revokedAt: now } : { enabled: intent === "enable" },
    });
    return { ok: true, message: intent === "revoke" ? "Token permanently revoked." : `Token ${intent === "enable" ? "enabled" : "disabled"}.` };
  });
  return reply(result, result.ok ? 200 : 400);
}

export default function HeadlessApiPage() {
  const { access, tokens, scopes, now } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const [name, setName] = useState("");
  const [tokenType, setTokenType] = useState("public");
  const [origins, setOrigins] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["delivery:check"]);
  const [dismissedToken, setDismissedToken] = useState<string | undefined>();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const busy = fetcher.state !== "idle";
  const expiryError = expiryValidationError(expiresAt);
  const activeCount = tokens.filter((token) => token.enabled && !token.revokedAt && (!token.expiresAt || new Date(token.expiresAt).getTime() > now)).length;
  const date = (value: Date | string | null) => value ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") : "Never";
  const createResult = fetcher.data?.intent === "create" ? fetcher.data : undefined;
  const tokenActionResult = fetcher.data?.intent && fetcher.data.intent !== "create" ? fetcher.data : undefined;
  const justCreated = createResult?.ok && createResult.token && createResult.token !== dismissedToken;

  const createdToken = createResult?.token;
  const createdOk = createResult?.ok;
  useEffect(() => {
    if (createdOk && createdToken) {
      setName("");
      setOrigins("");
      setExpiresAt("");
      setCopyStatus("idle");
    }
  }, [createdOk, createdToken]);

  const rows = tokens.map((token) => {
    const expired = token.expiresAt && new Date(token.expiresAt).getTime() <= now;
    const status = token.revokedAt ? "Revoked" : expired ? "Expired" : token.enabled ? "Enabled" : "Disabled";
    return [
      token.name, token.tokenType, token.tokenPrefix, token.scopesCsv,
      storedAllowedOriginsLabel(token.allowedOriginsJson),
      <Badge key={`${token.id}-status`} tone={status === "Enabled" ? "success" : status === "Disabled" ? "attention" : undefined}>{status}</Badge>,
      date(token.createdAt), date(token.expiresAt), date(token.lastUsedAt), date(token.revokedAt),
      <InlineStack key={token.id} gap="200">
        {!token.revokedAt ? <>
          <fetcher.Form method="post">
            <input type="hidden" name="id" value={token.id} />
            <input type="hidden" name="intent" value={token.enabled ? "disable" : "enable"} />
            <Button submit size="slim" disabled={busy || (!token.enabled && (!access.active || Boolean(expired) || activeCount >= 20))}>{token.enabled ? "Disable" : "Enable"}</Button>
          </fetcher.Form>
          <fetcher.Form method="post" onSubmit={(event) => { if (!window.confirm(`Permanently revoke ${token.name}? This cannot be undone.`)) event.preventDefault(); }}>
            <input type="hidden" name="id" value={token.id} /><input type="hidden" name="intent" value="revoke" />
            <Button submit size="slim" tone="critical" disabled={busy}>Revoke</Button>
          </fetcher.Form>
        </> : null}
      </InlineStack>,
    ];
  });

  return (
    <Page title="Headless API" subtitle="Manage API tokens for custom storefronts.">
      <BlockStack gap="500">
        {!access.active ? <Banner tone="warning" action={{ content: "View plans", url: "/app/plans" }}>An active plan is required to create or enable tokens. You can still disable or revoke existing tokens.</Banner> : null}

        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              <Card>
                <fetcher.Form method="post"><input type="hidden" name="intent" value="create" />
                  <FormLayout>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">Create token</Text>
                      <Badge>{`${activeCount}/20 active`}</Badge>
                    </InlineStack>
                    <TextField label="Token name" name="name" value={name} onChange={setName} autoComplete="off" maxLength={100} requiredIndicator helpText="Example: Production storefront" />
                    <Select label="Token type" name="tokenType" value={tokenType} onChange={(value) => { setTokenType(value); setOrigins(""); }} options={[{ label: "Public — browser apps", value: "public" }, { label: "Private — servers", value: "private" }]} />
                    {tokenType === "public" ? (
                      <Banner tone="info">Public tokens must use approved websites.</Banner>
                    ) : (
                      <Banner tone="warning">Keep private tokens on your server.</Banner>
                    )}
                    {tokenType === "public" ? <TextField label="Allowed websites" name="allowedOrigins" value={origins} onChange={setOrigins} autoComplete="off" multiline={3} requiredIndicator placeholder={"https://mystore.com\nhttps://www.mystore.com"} helpText="Enter one HTTPS website per line." /> : null}
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">Permissions</Text>
                      {scopes.map((scope) => <Checkbox key={scope} label={`${scope} — ${SCOPE_DESCRIPTIONS[scope] ?? ""}`} name="scopes" value={scope} checked={selectedScopes.includes(scope)} onChange={(checked) => setSelectedScopes((current) => checked ? [...current, scope] : current.filter((item) => item !== scope))} />)}
                      {!selectedScopes.length ? <Text as="p" tone="critical" variant="bodySm">Select at least one scope.</Text> : null}
                    </BlockStack>
                    <TextField label="Expiry (optional, UTC)" name="expiresAt" value={expiresAt} onChange={setExpiresAt} autoComplete="off" placeholder="2027-01-01T00:00:00Z" helpText="Leave blank for no expiry." error={expiryError} />
                    {createResult ? <Banner tone={createResult.ok ? "success" : "critical"}>{createResult.message}</Banner> : null}
                    {justCreated ? (
                      <Card><BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h2" variant="headingMd">Copy your token now</Text>
                          <Badge tone="warning">Shown once</Badge>
                        </InlineStack>
                        <Text as="p" tone="subdued">This token is shown once. Save it securely.</Text>
                        <TextField label="New token (shown once)" value={createResult.token!} readOnly autoComplete="off" />
                        <InlineStack gap="200" blockAlign="center">
                          <Button variant="primary" onClick={async () => {
                            try { await copyToken(createResult.token!); setCopyStatus("copied"); }
                            catch { setCopyStatus("failed"); }
                          }}>{copyStatus === "copied" ? "Copied" : "Copy token"}</Button>
                          <Button onClick={() => setDismissedToken(createResult.token)}>I have saved this token</Button>
                          <Text as="span" tone={copyStatus === "failed" ? "critical" : "subdued"} variant="bodySm" aria-live="polite">
                            {copyStatus === "copied" ? "Token copied." : copyStatus === "failed" ? "Copy failed. Select manually." : ""}
                          </Text>
                        </InlineStack>
                      </BlockStack></Card>
                    ) : null}
                    <Button submit variant="primary" loading={busy} disabled={!access.active || activeCount >= 20 || !selectedScopes.length || Boolean(expiryError)}>Generate token</Button>
                    {activeCount >= 20 ? <Text as="p" tone="critical" variant="bodySm">Limit reached. Disable or revoke an old token first.</Text> : null}
                  </FormLayout>
                </fetcher.Form>
              </Card>

              <Card><BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Tokens</Text>
                  <Badge>{`${tokens.length} total`}</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">Disable temporarily or revoke permanently.</Text>
                {tokenActionResult ? <Banner tone={tokenActionResult.ok ? "success" : "critical"}>{tokenActionResult.message}</Banner> : null}
                <div className="headless-table__scroll">
                  {rows.length ? <DataTable columnContentTypes={Array.from({ length: 11 }, () => "text" as const)} headings={["Name", "Type", "Prefix", "Read scopes", "Allowed origins", "Status", "Created", "Expires", "Last used", "Revoked", "Actions"]} rows={rows} /> : (
                    <div className="headless-empty">
                      <Text as="p" variant="headingMd">No tokens yet</Text>
                      <Text as="p" tone="subdued">Create a token to connect your storefront or server.</Text>
                    </div>
                  )}
                </div>
              </BlockStack></Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card><BlockStack gap="300">
                <Text as="h2" variant="headingMd">Test a token</Text>
                <Text as="p" tone="subdued">Send a test request from your storefront or server.</Text>
                <code className="incode-code">POST /api/v1/public/delivery/check + Bearer TOKEN + Origin: https://mystore.com + country IN postal_code 400001</code>
                <code className="incode-code">POST /api/v1/private/delivery/check + Bearer TOKEN from server, same JSON body</code>
              </BlockStack></Card>
              <Card><BlockStack gap="200">
                <Text as="h2" variant="headingMd">Rotation checklist</Text>
                <Text as="p" tone="subdued">Create a replacement, update your integration, test it, then revoke the old token.</Text>
              </BlockStack></Card>
              <Card><BlockStack gap="200">
                <Text as="h2" variant="headingMd">Limits</Text>
                <Text as="p" tone="subdued">Up to 20 active tokens. Expired and revoked tokens cannot be enabled again.</Text>
              </BlockStack></Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
