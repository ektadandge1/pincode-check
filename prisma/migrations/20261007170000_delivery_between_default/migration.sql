UPDATE "DeliverySetting"
SET "successMessage" = 'Delivery between {min_delivery_date} and {max_delivery_date}. {cod_message}{delivery_charge_message}'
WHERE "successMessage" IN (
  'Receive your order between {min_delivery_date} and {max_delivery_date}. {cod_message}{delivery_charge_message}',
  'Delivery by {date}. {cod_message}{delivery_charge_message}'
);
