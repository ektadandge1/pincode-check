CREATE TABLE "HeadlessApiToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenType" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "scopesCsv" TEXT NOT NULL,
    "allowedOriginsJson" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATETIME,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME
);

CREATE UNIQUE INDEX "HeadlessApiToken_tokenHash_key" ON "HeadlessApiToken"("tokenHash");
CREATE INDEX "HeadlessApiToken_shop_revokedAt_enabled_idx" ON "HeadlessApiToken"("shop", "revokedAt", "enabled");

-- Shared counters can be incremented/reset atomically by the API in the database.
CREATE TABLE "HeadlessRateLimit" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL,
    "resetsAt" DATETIME NOT NULL
);

CREATE INDEX "HeadlessRateLimit_resetsAt_idx" ON "HeadlessRateLimit"("resetsAt");
