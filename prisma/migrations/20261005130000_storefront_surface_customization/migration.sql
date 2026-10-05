ALTER TABLE "DeliverySetting" ADD COLUMN "storefrontFieldBackground" TEXT NOT NULL DEFAULT '#ffffff';
ALTER TABLE "DeliverySetting" ADD COLUMN "storefrontFieldBorderColor" TEXT NOT NULL DEFAULT '#d7d9dd';
ALTER TABLE "DeliverySetting" ADD COLUMN "storefrontResultBackground" TEXT NOT NULL DEFAULT '#171717';
ALTER TABLE "DeliverySetting" ADD COLUMN "storefrontResultTextColor" TEXT NOT NULL DEFAULT '#ffffff';
ALTER TABLE "DeliverySetting" ADD COLUMN "storefrontCountdownBackground" TEXT NOT NULL DEFAULT '#06451f';
ALTER TABLE "DeliverySetting" ADD COLUMN "storefrontCountdownDigitColor" TEXT NOT NULL DEFAULT '#ff6500';
ALTER TABLE "DeliverySetting" ADD COLUMN "storefrontCountdownTextColor" TEXT NOT NULL DEFAULT '#ffffff';
ALTER TABLE "DeliverySetting" ADD COLUMN "storefrontCountdownTitle" TEXT NOT NULL DEFAULT 'Order cutoff countdown';
