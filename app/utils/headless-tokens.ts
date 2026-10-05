import { createHash, randomBytes } from "node:crypto";

export const HEADLESS_READ_SCOPES = [
  "delivery:check",
  "delivery:estimate",
  "delivery:batch",
  "delivery:methods",
] as const;

export type HeadlessReadScope = (typeof HEADLESS_READ_SCOPES)[number];

export function hashHeadlessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateHeadlessToken(type: "public" | "private") {
  if (type !== "public" && type !== "private") {
    throw new Error("Token type must be public or private.");
  }
  const token = `hdt_${type}_${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashHeadlessToken(token),
    tokenPrefix: token.slice(0, `hdt_${type}_`.length + 8),
  };
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

export function parseHeadlessScopes(raw: string | readonly string[]): HeadlessReadScope[] {
  const values = typeof raw === "string" ? raw.split(",") : raw;
  const scopes = values.map((scope) => scope.trim());
  if (!scopes.length || scopes.some((scope) => !HEADLESS_READ_SCOPES.includes(scope as HeadlessReadScope))) {
    throw new Error("Select at least one supported read-only delivery scope. Write scopes are not supported.");
  }
  return [...new Set(scopes)] as HeadlessReadScope[];
}
