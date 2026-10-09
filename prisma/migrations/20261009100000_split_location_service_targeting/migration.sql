ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "localDeliveryTargetMode" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "localDeliveryTargetValuesCsv" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "pickupTargetMode" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "pickupTargetValuesCsv" TEXT NOT NULL DEFAULT '';

UPDATE "FulfillmentLocationRule"
SET
  "localDeliveryTargetMode" = "serviceTargetMode",
  "localDeliveryTargetValuesCsv" = "serviceTargetValuesCsv",
  "pickupTargetMode" = "serviceTargetMode",
  "pickupTargetValuesCsv" = "serviceTargetValuesCsv";
