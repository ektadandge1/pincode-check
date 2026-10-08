CREATE TABLE "ServiceAvailabilityRule" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "shop" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetKind" TEXT NOT NULL,
  "targetValue" TEXT NOT NULL,
  "countryCode" TEXT,
  "stateRegion" TEXT,
  "inventoryMode" TEXT NOT NULL DEFAULT 'any',
  "activationMode" TEXT NOT NULL DEFAULT 'always',
  "activeFromLocal" TEXT,
  "activeUntilLocal" TEXT,
  "weekdaysCsv" TEXT NOT NULL DEFAULT '',
  "startTimeLocal" TEXT,
  "endTimeLocal" TEXT,
  "shippingAvailable" BOOLEAN NOT NULL DEFAULT true,
  "localDeliveryAvailable" BOOLEAN NOT NULL DEFAULT true,
  "pickupAvailable" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "ServiceAvailabilityRule_shop_name_key" ON "ServiceAvailabilityRule"("shop", "name");
CREATE INDEX "ServiceAvailabilityRule_shop_targetKind_targetValue_idx" ON "ServiceAvailabilityRule"("shop", "targetKind", "targetValue");
CREATE INDEX "ServiceAvailabilityRule_shop_enabled_priority_idx" ON "ServiceAvailabilityRule"("shop", "enabled", "priority");
INSERT INTO "ServiceAvailabilityRule" ("shop", "name", "targetKind", "targetValue", "countryCode", "stateRegion", "inventoryMode", "activationMode", "activeFromLocal", "activeUntilLocal", "weekdaysCsv", "startTimeLocal", "endTimeLocal", "shippingAvailable", "localDeliveryAvailable", "pickupAvailable", "enabled", "priority", "createdAt", "updatedAt")
SELECT "shop", 'Service availability: ' || "name", "targetKind", "targetValue", "countryCode", "stateRegion", "inventoryMode", "activationMode", "activeFromLocal", "activeUntilLocal", "weekdaysCsv", "startTimeLocal", "endTimeLocal", "shippingAvailable", "localDeliveryAvailable", "pickupAvailable", "enabled", "priority", "createdAt", "updatedAt"
FROM "DeliveryTarget";
