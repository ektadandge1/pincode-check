ALTER TABLE "DeliverySetting" ADD COLUMN "deliveryWindowDays" INTEGER NOT NULL DEFAULT 2;
UPDATE "DeliverySetting"
SET "successMessage" = 'Receive your order between {min_delivery_date} and {max_delivery_date}. {cod_message}{delivery_charge_message}'
WHERE "successMessage" = 'Delivery by {date}. {cod_message}{delivery_charge_message}';
