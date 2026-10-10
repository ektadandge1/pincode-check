BEGIN TRANSACTION;

CREATE TABLE "new_FulfillmentLocationRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "shopifyLocationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "processingDays" INTEGER,
    "transitDays" INTEGER,
    "localDeliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "localDeliveryCountry" TEXT NOT NULL DEFAULT '',
    "localDeliveryPostalCodesCsv" TEXT NOT NULL DEFAULT '',
    "localDeliveryCoverageMode" TEXT NOT NULL DEFAULT 'postal',
    "localDeliveryZoneIdsCsv" TEXT NOT NULL DEFAULT '',
    "pickupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pickupInstructions" TEXT NOT NULL DEFAULT '',
    "pickupPhone" TEXT NOT NULL DEFAULT '',
    "pickupPreparationDays" INTEGER NOT NULL DEFAULT 0,
    "pickupWeekdaysCsv" TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
    "pickupBlockedDatesCsv" TEXT NOT NULL DEFAULT '',
    "pickupAdvanceDays" INTEGER NOT NULL DEFAULT 30,
    "localDeliveryTargetMode" TEXT NOT NULL DEFAULT 'all',
    "localDeliveryTargetValuesCsv" TEXT NOT NULL DEFAULT '',
    "pickupTargetMode" TEXT NOT NULL DEFAULT 'all',
    "pickupTargetValuesCsv" TEXT NOT NULL DEFAULT '',
    "localDeliveryServiceRuleId" INTEGER,
    "pickupServiceRuleId" INTEGER,
    "serviceTargetMode" TEXT NOT NULL DEFAULT 'all',
    "serviceTargetValuesCsv" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FulfillmentLocationRule_localDeliveryServiceRuleId_fkey" FOREIGN KEY ("localDeliveryServiceRuleId") REFERENCES "ServiceAvailabilityRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FulfillmentLocationRule_pickupServiceRuleId_fkey" FOREIGN KEY ("pickupServiceRuleId") REFERENCES "ServiceAvailabilityRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_FulfillmentLocationRule" (
    "id", "shop", "shopifyLocationId", "name", "enabled", "priority", "processingDays", "transitDays",
    "localDeliveryEnabled", "localDeliveryCountry", "localDeliveryPostalCodesCsv", "localDeliveryCoverageMode", "localDeliveryZoneIdsCsv",
    "pickupEnabled", "pickupInstructions", "pickupPhone", "pickupPreparationDays", "pickupWeekdaysCsv", "pickupBlockedDatesCsv", "pickupAdvanceDays",
    "localDeliveryTargetMode", "localDeliveryTargetValuesCsv", "pickupTargetMode", "pickupTargetValuesCsv",
    "serviceTargetMode", "serviceTargetValuesCsv", "createdAt", "updatedAt"
)
SELECT
    "id", "shop", "shopifyLocationId", "name", "enabled", "priority", "processingDays", "transitDays",
    "localDeliveryEnabled", "localDeliveryCountry", "localDeliveryPostalCodesCsv", "localDeliveryCoverageMode", "localDeliveryZoneIdsCsv",
    "pickupEnabled", "pickupInstructions", "pickupPhone", "pickupPreparationDays", "pickupWeekdaysCsv", "pickupBlockedDatesCsv", "pickupAdvanceDays",
    "localDeliveryTargetMode", "localDeliveryTargetValuesCsv", "pickupTargetMode", "pickupTargetValuesCsv",
    "serviceTargetMode", "serviceTargetValuesCsv", "createdAt", "updatedAt"
FROM "FulfillmentLocationRule";

DROP TABLE "FulfillmentLocationRule";
ALTER TABLE "new_FulfillmentLocationRule" RENAME TO "FulfillmentLocationRule";
CREATE UNIQUE INDEX "FulfillmentLocationRule_shop_shopifyLocationId_key" ON "FulfillmentLocationRule"("shop", "shopifyLocationId");
CREATE INDEX "FulfillmentLocationRule_shop_enabled_priority_idx" ON "FulfillmentLocationRule"("shop", "enabled", "priority");
CREATE INDEX "FulfillmentLocationRule_localDeliveryServiceRuleId_idx" ON "FulfillmentLocationRule"("localDeliveryServiceRuleId");
CREATE INDEX "FulfillmentLocationRule_pickupServiceRuleId_idx" ON "FulfillmentLocationRule"("pickupServiceRuleId");

COMMIT;
