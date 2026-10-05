ALTER TABLE "DeliveryTarget" ADD COLUMN "countryCode" TEXT;
ALTER TABLE "DeliveryTarget" ADD COLUMN "stateRegion" TEXT;
ALTER TABLE "DeliveryTarget" ADD COLUMN "inventoryMode" TEXT NOT NULL DEFAULT 'any';
ALTER TABLE "DeliveryTarget" ADD COLUMN "customSuccessMessage" TEXT;
ALTER TABLE "DeliveryTarget" ADD COLUMN "activationMode" TEXT NOT NULL DEFAULT 'always';
ALTER TABLE "DeliveryTarget" ADD COLUMN "activeFromLocal" TEXT;
ALTER TABLE "DeliveryTarget" ADD COLUMN "activeUntilLocal" TEXT;
ALTER TABLE "DeliveryTarget" ADD COLUMN "weekdaysCsv" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DeliveryTarget" ADD COLUMN "startTimeLocal" TEXT;
ALTER TABLE "DeliveryTarget" ADD COLUMN "endTimeLocal" TEXT;

CREATE INDEX "DeliveryTarget_shop_enabled_priority_idx" ON "DeliveryTarget"("shop", "enabled", "priority");
