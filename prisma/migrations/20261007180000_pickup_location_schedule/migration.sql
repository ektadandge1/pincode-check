ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "pickupPhone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "pickupPreparationDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "pickupWeekdaysCsv" TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6';
ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "pickupBlockedDatesCsv" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FulfillmentLocationRule" ADD COLUMN "pickupAdvanceDays" INTEGER NOT NULL DEFAULT 30;
