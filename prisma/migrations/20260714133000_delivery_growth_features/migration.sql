ALTER TABLE "PostalCode" ADD COLUMN "deliveryCharge" REAL;
ALTER TABLE "PostalCode" ADD COLUMN "currency" TEXT;
ALTER TABLE "PostalCode" ADD COLUMN "sameDayAvailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PostalCode" ADD COLUMN "nextDayAvailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PostalCode" ADD COLUMN "expressAvailable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "DeliverySetting" ADD COLUMN "disableAddToCart" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DeliverySetting" ADD COLUMN "successMessage" TEXT NOT NULL DEFAULT 'Delivery by {date}. {cod_message}{delivery_charge_message}';
ALTER TABLE "DeliverySetting" ADD COLUMN "unavailableMessage" TEXT NOT NULL DEFAULT 'Sorry, delivery is not available for this postal code.';
ALTER TABLE "DeliverySetting" ADD COLUMN "codAvailableMessage" TEXT NOT NULL DEFAULT 'COD available.';
ALTER TABLE "DeliverySetting" ADD COLUMN "codUnavailableMessage" TEXT NOT NULL DEFAULT 'Prepaid only.';
ALTER TABLE "DeliverySetting" ADD COLUMN "deliveryChargeMessage" TEXT NOT NULL DEFAULT ' Delivery charge: {currency}{delivery_charge}.';
ALTER TABLE "DeliverySetting" ADD COLUMN "googleSheetCsvUrl" TEXT;
ALTER TABLE "DeliverySetting" ADD COLUMN "lastGoogleSheetSyncAt" DATETIME;
ALTER TABLE "DeliverySetting" ADD COLUMN "lastGoogleSheetSyncStatus" TEXT;

CREATE TABLE "ImportJob" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ImportJob_shop_createdAt_idx" ON "ImportJob"("shop", "createdAt");

CREATE TABLE "ImportError" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "importJobId" INTEGER NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawRow" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ImportError_importJobId_idx" ON "ImportError"("importJobId");

CREATE TABLE "PostalCodeSearchEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "city" TEXT,
    "state" TEXT,
    "available" BOOLEAN NOT NULL,
    "codAvailable" BOOLEAN,
    "deliveryDays" INTEGER,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "PostalCodeSearchEvent_shop_createdAt_idx" ON "PostalCodeSearchEvent"("shop", "createdAt");
CREATE INDEX "PostalCodeSearchEvent_shop_country_postalCode_idx" ON "PostalCodeSearchEvent"("shop", "country", "postalCode");
