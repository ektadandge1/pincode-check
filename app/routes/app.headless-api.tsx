import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { Badge, Banner, BlockStack, Button, Card, Checkbox, DataTable, FormLayout, InlineStack, Page, Select, Text, TextField } from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { resolvePlanAccess } from "../services/plan-access.server";
import { authenticate } from "../shopify.server";
import { NO_PLAN_ACCESS } from "../services/plans.server";
import { generateHeadlessToken, HEADLESS_READ_SCOPES, normalizeAllowedOrigins, parseHeadlessScopes, storedAllowedOriginsLabel } from "../utils/headless-tokens";

type ActionData = { ok: boolean; message: string; token?: string };
const NO_STORE = { "Cache-Control": "no-store" };

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
  const { admin, session } = await authenticate.admin(request);
  const access = await resolvePlanAccess({ shop: session.shop, admin }).catch(() => NO_PLAN_ACCESS);
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
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const reply = (result: ActionData, status = 200) => data(result, { status, headers: NO_STORE });
  if (!["create", "enable", "disable", "revoke"].includes(intent)) {
    return reply({ ok: false, message: "Unsupported action." }, 400);
  }
  if (intent === "create" || intent === "enable") {
    const access = await resolvePlanAccess({ shop: session.shop, admin });
    if (!access.active) return reply({ ok: false, message: "An active plan is required to create or enable tokens." }, 403);
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
      if (expiry && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$/.test(expiry)) {
        throw new Error("Expiry must be a UTC timestamp, for example 2027-01-01T00:00:00Z.");
      }
      const expiresAt = expiry ? new Date(expiry) : null;
      if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
        throw new Error("Expiry must be a valid future UTC timestamp.");
      }
      if (expiresAt && expiresAt.toISOString().slice(0, 16) !== expiry.slice(0, 16)) {
        throw new Error("Expiry must be a valid calendar date and time.");
      }
      fields = { name, tokenType, scopesCsv: scopes.join(","), allowedOriginsJson: JSON.stringify(origins), expiresAt };
    } catch (error) {
      return reply({ ok: false, message: error instanceof Error ? error.message : "Invalid token fields." }, 400);
    }
  }

  // SQLite serializes write transactions: count and create/enable share the same transaction.
  const result = await prisma.$transaction(async (tx): Promise<ActionData> => {
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
  const activeCount = tokens.filter((token) => token.enabled && !token.revokedAt && (!token.expiresAt || new Date(token.expiresAt).getTime() > now)).length;
  const date = (value: Date | string | null) => value ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") : "Never";

  const rows = tokens.map((token) => {
    const expired = token.expiresAt && new Date(token.expiresAt).getTime() <= now;
    const status = token.revokedAt ? "Revoked" : expired ? "Expired" : token.enabled ? "Enabled" : "Disabled";
    return [
      token.name, token.tokenType, token.tokenPrefix, token.scopesCsv,
      storedAllowedOriginsLabel(token.allowedOriginsJson),
      <Badge key={`${token.id}-status`} tone={status === "Enabled" ? "success" : undefined}>{status}</Badge>,
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
    <Page title="Headless API tokens" subtitle="Manage public browser tokens and private server tokens for read-only delivery integrations.">
      <BlockStack gap="400">
        <Banner tone="info" title="Read-only release">
          These tokens authorize delivery checks, estimates, batches, and methods through /api/v1/public/delivery or /api/v1/private/delivery. They cannot write data or change Shopify checkout rates. To rotate a token, create a replacement, update your integration, then revoke the old token.
        </Banner>
        {!access.active ? <Banner tone="warning" action={{ content: "View plans", url: "/app/plans" }}>An active plan is required to create or enable tokens. You can still disable or revoke existing tokens.</Banner> : null}
        {fetcher.data ? <Banner tone={fetcher.data.ok ? "success" : "critical"}>{fetcher.data.message}</Banner> : null}
        {fetcher.data?.token && fetcher.data.token !== dismissedToken ? (
          <Card><BlockStack gap="300">
            <Text as="h2" variant="headingMd">Copy your token now</Text>
            <Text as="p">Only its hash is stored. After leaving or dismissing this display, the token cannot be retrieved.</Text>
            <TextField label="New token (shown once)" value={fetcher.data.token} readOnly autoComplete="off" />
            <InlineStack gap="200" blockAlign="center">
              <Button variant="primary" onClick={async () => {
                try {
                  await copyToken(fetcher.data!.token!);
                  setCopyStatus("copied");
                } catch {
                  setCopyStatus("failed");
                }
              }}>{copyStatus === "copied" ? "Copied" : "Copy token"}</Button>
              <Button onClick={() => setDismissedToken(fetcher.data?.token)}>I have saved this token</Button>
              <Text as="span" tone={copyStatus === "failed" ? "critical" : "subdued"} variant="bodySm" aria-live="polite">
                {copyStatus === "copied" ? "Token copied to clipboard." : copyStatus === "failed" ? "Copy failed. Select the token and copy it manually." : ""}
              </Text>
            </InlineStack>
          </BlockStack></Card>
        ) : null}
        <Card>
          <fetcher.Form method="post"><input type="hidden" name="intent" value="create" />
            <FormLayout>
              <Text as="h2" variant="headingMd">Create token ({activeCount}/20 active)</Text>
              <TextField label="Token name" name="name" value={name} onChange={setName} autoComplete="off" maxLength={100} requiredIndicator />
              <Select label="Token type" name="tokenType" value={tokenType} onChange={(value) => { setTokenType(value); setOrigins(""); }} options={[{ label: "Public (browser)", value: "public" }, { label: "Private (server only)", value: "private" }]} />
              <Text as="p">Public tokens are visible to shoppers; origin restrictions are not a substitute for keeping private tokens secret. Never embed a private token in browser code.</Text>
              {tokenType === "public" ? <TextField label="Allowed origins" name="allowedOrigins" value={origins} onChange={setOrigins} autoComplete="off" multiline={3} requiredIndicator helpText="Exact HTTPS origins, separated by commas or newlines. No paths, trailing slashes, or wildcards. HTTP localhost with an optional port is allowed for development." /> : <Text as="p" tone="subdued">Private tokens have no allowed origins and are for server-to-server use only.</Text>}
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Read scopes</Text>
                {scopes.map((scope) => <Checkbox key={scope} label={scope} name="scopes" value={scope} checked={selectedScopes.includes(scope)} onChange={(checked) => setSelectedScopes((current) => checked ? [...current, scope] : current.filter((item) => item !== scope))} />)}
              </BlockStack>
              <TextField label="Expiry (optional, UTC)" name="expiresAt" value={expiresAt} onChange={setExpiresAt} autoComplete="off" placeholder="2027-01-01T00:00:00Z" helpText="Leave empty for no expiry. Expired tokens cannot be re-enabled." />
              <Button submit variant="primary" loading={busy} disabled={!access.active || activeCount >= 20}>Generate token</Button>
            </FormLayout>
          </fetcher.Form>
        </Card>
        <Card><BlockStack gap="300">
          <Text as="h2" variant="headingMd">Token metadata</Text>
          <Text as="p" tone="subdued">Only prefixes and metadata are listed. Disable is reversible; revoke is permanent. Disabled, expired, and revoked tokens do not count toward the active limit.</Text>
          {rows.length ? <DataTable columnContentTypes={Array.from({ length: 11 }, () => "text" as const)} headings={["Name", "Type", "Prefix", "Read scopes", "Allowed origins", "Status", "Created", "Expires", "Last used", "Revoked", "Actions"]} rows={rows} /> : <Text as="p">No tokens created.</Text>}
        </BlockStack></Card>
      </BlockStack>
    </Page>
  );
}
