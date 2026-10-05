process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./dev.sqlite";

const prisma = (await import("../app/db.server.ts")).default;
const { checkDelivery, checkDeliveryPolicy } = await import(
  "../app/services/delivery-checker.server.ts"
);

const shop = "target-int-test.myshopify.com";
await prisma.deliveryTarget.deleteMany({ where: { shop } });
await prisma.deliverySetting.deleteMany({ where: { shop } });
await prisma.postalCode.deleteMany({ where: { shop } });

await prisma.deliverySetting.create({
  data: { shop, requireValidPin: false, disableAddToCart: false, dbFallbackEnabled: true },
});
await prisma.postalCode.create({
  data: { shop, country: "US", postalCode: "10001", deliveryDays: 2, serviceable: true },
});
await prisma.deliveryTarget.create({
  data: {
    shop,
    name: "lock-product-4242",
    targetKind: "product",
    targetValue: "4242",
    requireValidPin: true,
    priority: 10,
  },
});
await prisma.deliveryTarget.create({
  data: {
    shop,
    name: "exempt-clearance",
    targetKind: "tag",
    targetValue: "clearance",
    requireValidPin: false,
    priority: 10,
  },
});

const shopDefault = await checkDeliveryPolicy({ shop });
if (shopDefault.require_valid_pin !== false) throw new Error("shop default should not lock");

const productLock = await checkDeliveryPolicy({ shop, productId: "4242" });
if (productLock.require_valid_pin !== true) throw new Error("product target should lock");
if (productLock.matched_target !== "lock-product-4242") throw new Error("matched product target");

const tagExempt = await checkDeliveryPolicy({
  shop,
  productId: "1",
  productTags: ["Clearance"],
});
if (tagExempt.require_valid_pin !== false) throw new Error("tag exempt should apply");
if (tagExempt.matched_target !== "exempt-clearance") throw new Error("matched tag target");

const check = await checkDelivery({
  shop,
  country: "US",
  postalCode: "10001",
  productId: "4242",
});
if (check.available !== true || check.require_valid_pin !== true) {
  throw new Error("check should be available and locked");
}

await prisma.deliveryTarget.deleteMany({ where: { shop } });
await prisma.deliverySetting.deleteMany({ where: { shop } });
await prisma.postalCode.deleteMany({ where: { shop } });

console.log("targeting policy OK");
