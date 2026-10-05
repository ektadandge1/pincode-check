process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./dev.sqlite";

const prisma = (await import("../app/db.server.ts")).default;
const { checkDelivery, checkDeliveryPolicy } = await import(
  "../app/services/delivery-checker.server.ts"
);
const { importPostalCodesFromCsv } = await import(
  "../app/services/postal-code-importer.server.ts"
);
const { STANDARD_FEATURES } = await import(
  "../app/services/plans.server.ts"
);

const shop = "plan-enforcement-test.myshopify.com";
await prisma.deliveryTarget.deleteMany({ where: { shop } });
await prisma.deliverySetting.deleteMany({ where: { shop } });
await prisma.postalCodeSearchEvent.deleteMany({ where: { shop } });
await prisma.postalCode.deleteMany({ where: { shop } });
const existingJobs = await prisma.importJob.findMany({ where: { shop }, select: { id: true } });
await prisma.importError.deleteMany({ where: { importJobId: { in: existingJobs.map((job) => job.id) } } });
await prisma.importJob.deleteMany({ where: { shop } });

try {
  await prisma.deliverySetting.create({
    data: { shop, requireValidPin: true, disableAddToCart: true, dbFallbackEnabled: true },
  });
  await prisma.postalCode.createMany({
    data: [
      { shop, country: "US", postalCode: "10001", patternType: "exact", deliveryDays: 2 },
      { shop, country: "US", postalCode: "123*", patternType: "wildcard", deliveryDays: 3 },
    ],
  });
  await prisma.deliveryTarget.create({
    data: {
      shop,
      name: "locked-product",
      targetKind: "product",
      targetValue: "42",
      requireValidPin: true,
    },
  });

  const standardPolicy = await checkDeliveryPolicy({ shop, productId: "42", features: STANDARD_FEATURES });
  if (!standardPolicy.require_valid_pin) {
    throw new Error("Standard must execute configured cart controls.");
  }

  const exact = await checkDelivery({
    shop,
    country: "US",
    postalCode: "10001",
    features: STANDARD_FEATURES,
  });
  if (!exact.available) throw new Error("Basic exact rules should remain available.");

  const standardWildcard = await checkDelivery({
    shop,
    country: "US",
    postalCode: "12345",
    features: STANDARD_FEATURES,
  });
  if (!standardWildcard.available) throw new Error("Standard wildcard rules should be available.");

  const targetedWildcard = await checkDelivery({
    shop,
    country: "US",
    postalCode: "12345",
    productId: "42",
    features: STANDARD_FEATURES,
  });
  if (!targetedWildcard.available || !targetedWildcard.require_valid_pin) {
    throw new Error("Standard wildcard and targeting features should execute.");
  }

  const standardAnalytics = await prisma.postalCodeSearchEvent.count({ where: { shop } });
  if (standardAnalytics !== 3) {
    throw new Error("Standard lookups should write analytics.");
  }

  const standardImport = await importPostalCodesFromCsv(
    shop,
    "country,postal_code,delivery_days\nUS,999*,2",
    "csv",
    STANDARD_FEATURES,
  );
  if (standardImport.status !== "completed" || standardImport.successRows !== 1) {
    throw new Error("Standard CSV imports should accept wildcard rules.");
  }
} finally {
  await prisma.deliveryTarget.deleteMany({ where: { shop } });
  await prisma.deliverySetting.deleteMany({ where: { shop } });
  await prisma.postalCodeSearchEvent.deleteMany({ where: { shop } });
  await prisma.postalCode.deleteMany({ where: { shop } });
  const jobs = await prisma.importJob.findMany({ where: { shop }, select: { id: true } });
  await prisma.importError.deleteMany({ where: { importJobId: { in: jobs.map((job) => job.id) } } });
  await prisma.importJob.deleteMany({ where: { shop } });
}

console.log("plan enforcement OK");
