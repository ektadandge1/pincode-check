ALTER TABLE "DeliverySetting" ADD COLUMN "processingDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeliverySetting" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE "DeliverySetting" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';

ALTER TABLE "DeliveryTarget" ADD COLUMN "processingDays" INTEGER;
ALTER TABLE "DeliveryTarget" ADD COLUMN "transitDays" INTEGER;
ALTER TABLE "DeliveryTarget" ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false;
