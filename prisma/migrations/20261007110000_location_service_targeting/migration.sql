ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "serviceTargetMode" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "serviceTargetValuesCsv" TEXT NOT NULL DEFAULT '';
