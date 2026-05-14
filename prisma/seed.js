import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pincodes = [
    { pincode: "400001", city: "Mumbai", state: "Maharashtra", deliveryDays: 2, codAvailable: true },
    { pincode: "110001", city: "New Delhi", state: "Delhi", deliveryDays: 3, codAvailable: true },
    { pincode: "560001", city: "Bengaluru", state: "Karnataka", deliveryDays: 3, codAvailable: false },
    { pincode: "700001", city: "Kolkata", state: "West Bengal", deliveryDays: 4, codAvailable: true },
  ];

  for (const row of pincodes) {
    await prisma.pincode.upsert({
      where: { pincode: row.pincode },
      update: row,
      create: row,
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
