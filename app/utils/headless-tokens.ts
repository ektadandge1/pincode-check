export const HEADLESS_READ_SCOPES = [
  "delivery:check",
  "delivery:estimate",
  "delivery:batch",
  "delivery:methods",
] as const;

export type HeadlessReadScope = (typeof HEADLESS_READ_SCOPES)[number];

export function hashHeadlessToken(token: string): string {
  // Browser-safe fallback (tests / client). Server uses headless-tokens.server.ts with node:crypto.
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fallback-${(hash >>> 0).toString(16)}`;
}

export function normalizeAllowedOrigins(raw: string): string[] {
  if (!raw.trim()) return [];
  const origins = raw.split(/[\s,]+/).filter(Boolean).map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Allowed origins must be exact HTTPS origins (HTTP localhost is allowed).");
    }
    // Comparing the entire input rejects paths, credentials, wildcards and URL parser repairs.
    if (
      value !== url.origin ||
      url.hostname.includes("*") ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))
    ) {
      throw new Error("Allowed origins must be exact HTTPS origins (HTTP localhost is allowed).");
    }
    return url.origin;
  });
  return [...new Set(origins)];
}

export function storedAllowedOriginsLabel(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((origin) => typeof origin !== "string")) return "Invalid legacy metadata";
    return parsed.join(", ") || "None (server only)";
  } catch {
    return "Invalid legacy metadata";
  }
}

export function parseHeadlessScopes(raw: string | readonly string[]): HeadlessReadScope[] {
  const values = typeof raw === "string" ? raw.split(",") : raw;
  const scopes = values.map((scope) => scope.trim());
  if (!scopes.length || scopes.some((scope) => !HEADLESS_READ_SCOPES.includes(scope as HeadlessReadScope))) {
    throw new Error("Select at least one supported read-only delivery scope. Write scopes are not supported.");
  }
  return [...new Set(scopes)] as HeadlessReadScope[];
}
