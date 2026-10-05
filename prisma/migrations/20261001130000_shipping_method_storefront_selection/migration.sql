ALTER TABLE "DeliverySetting" ADD COLUMN "shippingMethodDisplayStyle" TEXT NOT NULL DEFAULT 'visual';

ALTER TABLE "ShippingMethodRule" ADD COLUMN "description" TEXT;
ALTER TABLE "ShippingMethodRule" ADD COLUMN "customMessage" TEXT;
