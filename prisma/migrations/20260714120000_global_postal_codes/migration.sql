-- Rename India-only pincode records into country-scoped postal code records.
CREATE TABLE "PostalCode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL DEFAULT 'default',
    "country" TEXT NOT NULL DEFAULT 'IN',
    "postalCode" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "zone" TEXT,
    "serviceable" BOOLEAN NOT NULL DEFAULT true,
    "deliveryDays" INTEGER NOT NULL,
    "codAvailable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "PostalCode" (
    "id",
    "shop",
    "country",
    "postalCode",
    "city",
    "state",
    "zone",
    "serviceable",
    "deliveryDays",
    "codAvailable",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "shop",
    'IN',
    "pincode",
    "city",
    "state",
    "zone",
    "serviceable",
    "deliveryDays",
    "codAvailable",
    "createdAt",
    "updatedAt"
FROM "Pincode";

DROP TABLE "Pincode";

CREATE UNIQUE INDEX "PostalCode_shop_country_postalCode_key" ON "PostalCode"("shop", "country", "postalCode");
