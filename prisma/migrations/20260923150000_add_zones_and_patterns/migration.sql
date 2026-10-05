CREATE TABLE "Zone" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Zone_shop_name_key" ON "Zone"("shop", "name");
CREATE INDEX "Zone_shop_country_idx" ON "Zone"("shop", "country");

ALTER TABLE "PostalCode" ADD COLUMN "patternType" TEXT NOT NULL DEFAULT 'exact';
ALTER TABLE "PostalCode" ADD COLUMN "rangeStart" TEXT;
ALTER TABLE "PostalCode" ADD COLUMN "rangeEnd" TEXT;
ALTER TABLE "PostalCode" ADD COLUMN "zoneId" INTEGER;

CREATE INDEX "PostalCode_shop_country_patternType_idx" ON "PostalCode"("shop", "country", "patternType");
