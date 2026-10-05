import assert from "node:assert/strict";

process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./dev.sqlite";

const { importPostalCodesFromCsv } = await import("../app/services/postal-code-importer.server.ts");
const { checkDelivery } = await import("../app/services/delivery-checker.server.ts");
const prisma = (await import("../app/db.server.ts")).default;

const shop = "zones-integration-test.myshopify.com";

await prisma.postalCode.deleteMany({ where: { shop } });
await prisma.zone.deleteMany({ where: { shop } });

const csv = [
  "country,postal_code,delivery_days,serviceable,cod_available,delivery_charge,currency,city,state,zone,same_day,next_day,express",
  "US,10001,2,true,true,8,USD,New York,New York,metro,true,true,true",
  "US,10000-10999,3,true,true,10,USD,NY range,,metro,false,false,false",
  "US,123*,4,false,false,,,Sparse,,remote,false,false,false",
  "GB,SW1A*,3,true,false,5,GBP,London SW,,london,false,false,true",
].join("\n");

const result = await importPostalCodesFromCsv(shop, csv, "csv");
assert.equal(result.status, "completed", JSON.stringify(result));
assert.equal(result.successRows, 4);

const zones = await prisma.zone.findMany({ where: { shop }, orderBy: { name: "asc" } });
assert.deepEqual(zones.map((z) => z.name).sort(), ["london", "metro", "remote"]);

const exact = await checkDelivery({ shop, country: "US", postalCode: "10001" });
assert.equal(exact.available, true);
assert.equal(exact.delivery_days, 2);

const inRange = await checkDelivery({ shop, country: "US", postalCode: "10550" });
assert.equal(inRange.available, true);
assert.equal(inRange.delivery_days, 3);

const outsideRange = await checkDelivery({ shop, country: "US", postalCode: "11000" });
assert.equal(outsideRange.available, false);

const wildcard = await checkDelivery({ shop, country: "US", postalCode: "12345" });
assert.equal(wildcard.available, false); // remote zone rule is not serviceable

const gbWildcard = await checkDelivery({ shop, country: "GB", postalCode: "SW1A 1AA" });
assert.equal(gbWildcard.available, true);
assert.equal(gbWildcard.delivery_days, 3);

await prisma.postalCode.deleteMany({ where: { shop } });
await prisma.zone.deleteMany({ where: { shop } });

console.log("integration OK");
