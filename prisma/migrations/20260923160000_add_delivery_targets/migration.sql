ALTER TABLE "DeliverySetting" ADD COLUMN "requireValidPin" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DeliveryTarget" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "requireValidPin" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "DeliveryTarget_shop_name_key" ON "DeliveryTarget"("shop", "name");
CREATE INDEX "DeliveryTarget_shop_targetKind_targetValue_idx" ON "DeliveryTarget"("shop", "targetKind", "targetValue");
