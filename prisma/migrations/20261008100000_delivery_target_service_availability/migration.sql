ALTER TABLE "DeliveryTarget" ADD COLUMN "shippingAvailable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DeliveryTarget" ADD COLUMN "localDeliveryAvailable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DeliveryTarget" ADD COLUMN "pickupAvailable" BOOLEAN NOT NULL DEFAULT true;
