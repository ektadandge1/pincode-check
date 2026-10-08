ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "localDeliveryCoverageMode" TEXT NOT NULL DEFAULT 'postal';
ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "localDeliveryZoneIdsCsv" TEXT NOT NULL DEFAULT '';
