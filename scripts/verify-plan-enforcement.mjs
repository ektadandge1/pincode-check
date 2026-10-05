process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./dev.sqlite";

const prisma = (await import("../app/db.server.ts")).default;
const { checkDelivery, checkDeliveryPolicy } = await import(
  "../app/services/delivery-checker.server.ts"
);
const { importPostalCodesFromCsv } = await import(
  "../app/services/postal-code-importer.server.ts"
);
const { BASIC_FEATURES, ADVANCED_FEATURES } = await import(
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

  const basicPolicy = await checkDeliveryPolicy({ shop, productId: "42", features: BASIC_FEATURES });
  if (basicPolicy.require_valid_pin || basicPolicy.disable_add_to_cart) {
    throw new Error("Basic must not execute Advanced cart controls.");
  }

  const exact = await checkDelivery({
    shop,
    country: "US",
    postalCode: "10001",
    features: BASIC_FEATURES,
  });
  if (!exact.available) throw new Error("Basic exact rules should remain available.");

  const basicWildcard = await checkDelivery({
    shop,
    country: "US",
    postalCode: "12345",
    features: BASIC_FEATURES,
  });
  if (basicWildcard.available) throw new Error("Basic must not execute wildcard rules.");

  const advancedWildcard = await checkDelivery({
    shop,
    country: "US",
    postalCode: "12345",
    productId: "42",
    features: ADVANCED_FEATURES,
  });
  if (!advancedWildcard.available || !advancedWildcard.require_valid_pin) {
    throw new Error("Advanced wildcard and targeting features should execute.");
  }

  const basicAnalytics = await prisma.postalCodeSearchEvent.count({ where: { shop } });
  if (basicAnalytics !== 1) {
    throw new Error("Only the Advanced lookup should write analytics.");
  }

  const basicImport = await importPostalCodesFromCsv(
    shop,
    "country,postal_code,delivery_days\nUS,999*,2",
    "csv",
    BASIC_FEATURES,
  );
  if (basicImport.status !== "failed" || basicImport.failedRows !== 1) {
    throw new Error("Basic CSV imports must reject wildcard rules.");
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
