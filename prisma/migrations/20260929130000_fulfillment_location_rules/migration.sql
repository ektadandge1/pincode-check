CREATE TABLE "FulfillmentLocationRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "shopifyLocationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "processingDays" INTEGER,
    "transitDays" INTEGER,
    "localDeliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "localDeliveryPostalCodesCsv" TEXT NOT NULL DEFAULT '',
    "pickupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pickupInstructions" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "FulfillmentLocationRule_shop_shopifyLocationId_key"
ON "FulfillmentLocationRule"("shop", "shopifyLocationId");

CREATE INDEX "FulfillmentLocationRule_shop_enabled_priority_idx"
ON "FulfillmentLocationRule"("shop", "enabled", "priority");
