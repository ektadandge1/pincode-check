import prisma from "../app/db.server.ts";

const rows = await prisma.postalCode.findMany({
  where: { zone: { not: null }, zoneId: null },
  select: { id: true, shop: true, zone: true, country: true },
});

let linked = 0;
for (const row of rows) {
  if (!row.zone) continue;
  const zone = await prisma.zone.upsert({
    where: { shop_name: { shop: row.shop, name: row.zone } },
    create: {
      shop: row.shop,
      name: row.zone,
      country: row.country,
      priority: 100,
      enabled: true,
    },
    update: {},
  });
  await prisma.postalCode.update({
    where: { id: row.id },
    data: { zoneId: zone.id },
  });
  linked += 1;
}

const zones = await prisma.zone.count();
console.log(`linked ${linked} rules; zones total ${zones}`);
await prisma.$disconnect();
