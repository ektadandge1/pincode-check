-- CreateTable
CREATE TABLE "Pincode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pincode" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "zone" TEXT,
    "serviceable" BOOLEAN NOT NULL DEFAULT true,
    "deliveryDays" INTEGER NOT NULL,
    "codAvailable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DeliverySetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL DEFAULT 'default',
    "cutoffHour24" INTEGER NOT NULL DEFAULT 14,
    "holidaysCsv" TEXT NOT NULL DEFAULT '',
    "fallbackDays" INTEGER NOT NULL DEFAULT 5,
    "weekendDaysCsv" TEXT NOT NULL DEFAULT '0',
    "courierTimeoutMs" INTEGER NOT NULL DEFAULT 2000,
    "retryCount" INTEGER NOT NULL DEFAULT 1,
    "courierEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dbFallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Pincode_pincode_key" ON "Pincode"("pincode");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySetting_shop_key" ON "DeliverySetting"("shop");
