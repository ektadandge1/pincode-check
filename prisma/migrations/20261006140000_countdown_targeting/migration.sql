ALTER TABLE "DeliverySetting" ADD COLUMN "countdownEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DeliverySetting" ADD COLUMN "countdownTargetMode" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "DeliverySetting" ADD COLUMN "countdownProductIdsCsv" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DeliverySetting" ADD COLUMN "countdownCollectionHandlesCsv" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DeliverySetting" ADD COLUMN "countdownDisplaySurfacesCsv" TEXT NOT NULL DEFAULT 'product';
