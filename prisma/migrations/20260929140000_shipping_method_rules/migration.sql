CREATE TABLE "ShippingMethodRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'standard',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "processingDays" INTEGER,
    "transitDays" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ShippingMethodRule_shop_handle_key" ON "ShippingMethodRule"("shop", "handle");
CREATE INDEX "ShippingMethodRule_shop_enabled_priority_idx" ON "ShippingMethodRule"("shop", "enabled", "priority");
