/* eslint-env node */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const postalCodes = [
    { country: "US", postalCode: "10001", city: "New York", state: "New York", deliveryDays: 2, codAvailable: false },
    { country: "GB", postalCode: "SW1A 1AA", city: "London", state: "England", deliveryDays: 3, codAvailable: false },
    { country: "CA", postalCode: "M5V 3L9", city: "Toronto", state: "Ontario", deliveryDays: 4, codAvailable: false },
    { country: "AU", postalCode: "2000", city: "Sydney", state: "New South Wales", deliveryDays: 3, codAvailable: false },
    { country: "IN", postalCode: "400001", city: "Mumbai", state: "Maharashtra", deliveryDays: 2, codAvailable: true },
  ];

  for (const row of postalCodes) {
    await prisma.postalCode.upsert({
      where: { shop_country_postalCode: { shop: "default", country: row.country, postalCode: row.postalCode } },
      update: row,
      create: { shop: "default", ...row },
    });
  }

  await prisma.deliverySetting.upsert({
    where: { shop: "default" },
    update: {
      cutoffHour24: 14,
      holidaysCsv: "2026-01-26,2026-08-15",
      fallbackDays: 5,
      weekendDaysCsv: "0",
      courierTimeoutMs: 2000,
      retryCount: 1,
      courierEnabled: false,
      dbFallbackEnabled: true,
    },
    create: {
      shop: "default",
      cutoffHour24: 14,
      holidaysCsv: "2026-01-26,2026-08-15",
      fallbackDays: 5,
      weekendDaysCsv: "0",
      courierTimeoutMs: 2000,
      retryCount: 1,
      courierEnabled: false,
      dbFallbackEnabled: true,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
