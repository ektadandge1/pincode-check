-- Scope pincode records to each merchant shop for public app data isolation.
ALTER TABLE "Pincode" ADD COLUMN "shop" TEXT NOT NULL DEFAULT 'default';

DROP INDEX IF EXISTS "Pincode_pincode_key";

CREATE UNIQUE INDEX "Pincode_shop_pincode_key" ON "Pincode"("shop", "pincode");
