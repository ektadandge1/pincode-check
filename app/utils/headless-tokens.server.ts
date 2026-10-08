import { createHash, randomBytes } from "node:crypto";
import { hashHeadlessToken as hashFallback } from "./headless-tokens.ts";

export function hashHeadlessToken(token: string): string {
  try {
    return createHash("sha256").update(token, "utf8").digest("hex");
  } catch {
    return hashFallback(token);
  }
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
