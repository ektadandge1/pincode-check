import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";
import { injectedServer } from "./helpers/injected-server.mjs";

const shop = "pickup-admin.myshopify.com";
const id = "gid://shopify/Location/123";
const source = readFileSync(new URL("../app/routes/app.locations.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  fileName: "app.locations.tsx",
}).outputText;
const load = injectedServer({});

function fixture({ location = { id, name: "Canonical Shopify store", address: { address1: "123 Main St", address2: "Suite 2", city: "Boston", province: "Massachusetts", provinceCode: "MA", zip: "02108", country: "United States", countryCode: "US", phone: "+1 555 123 4567" }, isActive: true, fulfillsOnlineOrders: true }, lookupError = false, scope = "", orders = [] } = {}) {
  const writes = [];
  const lookups = [];
  const invalidated = [];
  const admin = { graphql: async (query, options) => {
    lookups.push({ query, options });
    if (lookupError) return Response.json({ errors: [{ message: "Access denied" }] });
    if (query.includes("RecentServiceOrders")) return Response.json({ data: { orders: { nodes: orders } } });
    return Response.json({ data: query.includes("location(id:") ? { location } : {
      locations: { nodes: [location] }, products: { nodes: [], pageInfo: { hasNextPage: false } }, collections: { nodes: [], pageInfo: { hasNextPage: false } },
    } });
  } };
  const mocks = {
    "../db.server": { fulfillmentLocationRule: { upsert: async (args) => writes.push(args), findMany: async () => [], findUnique: async () => ({ localDeliveryCoverageMode: "zone", localDeliveryZoneIdsCsv: "27", localDeliveryCountry: "", localDeliveryPostalCodesCsv: "" }) }, deliverySetting: { findUnique: async () => null }, zone: { findMany: async () => [] } },
    "../services/billing.server": { requireActiveBilling: async () => ({ admin, session: { shop, scope } }) },
    "../services/plan-access.server": { resolvePlanAccess: async () => ({ active: true, features: { inventory: true } }) },
    "../services/plans.server": { NO_PLAN_ACCESS: {} },
    "../services/delivery-checker.server": { clearDeliveryCheckCaches: (value) => invalidated.push(value) },
    "../services/shopify-target-suggestions.server": { loadShopifyTargetSuggestionsForKind: async () => [] },
    "../utils/delivery.server": load("app/utils/delivery.server.ts"),
    "../utils/countries": load("app/utils/countries.ts"),
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier) => {
    if (specifier in mocks) return mocks[specifier];
    if (["react", "react-router", "react/jsx-runtime", "@shopify/polaris"].includes(specifier)) return {};
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  const submit = (overrides = {}) => module.exports.action({ request: new Request("https://fixture.test/app/locations", {
    method: "POST",
    body: new URLSearchParams({ intent: "save_location", shopifyLocationId: id, locationName: "Forged name", priority: "100", pickupEnabled: "on", pickupPhone: "+1 555 999 0000", pickupPreparationDays: "2", pickupAdvanceDays: "30", pickupWeekdaysCsv: "1,2,3,4,5", pickupBlockedDatesCsv: "2026-12-25", ...overrides }),
  }) });
  return { submit, loader: module.exports.loader, writes, lookups, invalidated };
}

test("pickup save uses the authenticated shop and canonical Shopify name for create and update", async () => {
  const f = fixture();
  const result = await f.submit({ section: "pickup", pickupBlockedDatesCsv: "2026-12-25,2024-02-29,2026-12-25", pickupWeekdaysCsv: "5,1,1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.saved, {
    locationId: id,
    section: "pickup",
    values: {
      enabled: true,
      pickupEnabled: true,
      pickupInstructions: "",
      pickupPhone: "+1 555 999 0000",
      pickupPreparationDays: "2",
       pickupWeekdaysCsv: "1,5",
       pickupBlockedDatesCsv: "2024-02-29,2026-12-25",
       pickupAdvanceDays: "30",
       pickupTargetMode: "all",
       pickupTargetValuesCsv: "",
    },
  });
  assert.deepEqual(f.lookups[0].options.variables, { id });
  const write = f.writes[0];
  assert.deepEqual(write.where, { shop_shopifyLocationId: { shop, shopifyLocationId: id } });
  assert.equal(write.create.shop, shop);
  for (const data of [write.create, write.update]) {
    assert.equal(data.name, "Canonical Shopify store");
    assert.equal(data.pickupPhone, "+1 555 999 0000");
    assert.equal(data.pickupPreparationDays, 2);
    assert.equal(data.pickupAdvanceDays, 30);
    assert.equal(data.pickupWeekdaysCsv, "1,5");
    assert.equal(data.pickupBlockedDatesCsv, "2024-02-29,2026-12-25");
    assert.equal(data.enabled, true);
  }
  assert.deepEqual(f.invalidated, [shop]);
});

test("every location section returns its canonical saved state", async () => {
  for (const section of ["status", "routing", "delivery", "pickup", "targeting"]) {
    const result = await fixture().submit({ section });
    assert.equal(result.ok, true, section);
    assert.equal(result.saved?.locationId, id, section);
    assert.equal(result.saved?.section, section, section);
    assert.ok(result.saved?.values, section);
  }
});

test("controlled pickup state wins over native checkbox serialization", async () => {
  const f = fixture();
  const result = await f.submit({ section: "pickup", pickupEnabled: "", pickupEnabledState: "true" });
  assert.equal(result.ok, true);
  assert.equal(result.saved?.values.pickupEnabled, true);
  assert.equal(f.writes[0].update.pickupEnabled, true);
});

test("foreign, deleted, mismatched and unverified locations cannot be saved", async () => {
  for (const options of [{ location: null }, { location: { id: "gid://shopify/Location/999", name: "Other location" } }, { lookupError: true }]) {
    const f = fixture(options);
    assert.equal((await f.submit()).ok, false);
    assert.equal(f.writes.length, 0);
    assert.equal(f.invalidated.length, 0);
  }
});

test("pickup validation rejects invalid days, empty enabled weekdays, impossible dates and oversized values", async () => {
  const invalid = [
    { pickupPreparationDays: "" }, { pickupPreparationDays: "-1" }, { pickupPreparationDays: "61" }, { pickupPreparationDays: "1.5" }, { pickupPreparationDays: "1e1" },
    { pickupAdvanceDays: "" }, { pickupAdvanceDays: "0" }, { pickupAdvanceDays: "91" }, { pickupAdvanceDays: "2.5" }, { pickupPreparationDays: "31", pickupAdvanceDays: "30" },
    { pickupWeekdaysCsv: "" }, { pickupWeekdaysCsv: "7" }, { pickupWeekdaysCsv: "1,,2" }, { pickupWeekdaysCsv: "01" }, { pickupWeekdaysCsv: "1," },
    { pickupBlockedDatesCsv: "2026-02-29" }, { pickupBlockedDatesCsv: "2026-04-31" }, { pickupBlockedDatesCsv: "2026-13-01" }, { pickupBlockedDatesCsv: "0000-01-01" }, { pickupBlockedDatesCsv: "2026-1-1" },
    { pickupBlockedDatesCsv: "2026-01-01,".repeat(366) }, { pickupBlockedDatesCsv: " ".repeat(4001) + "2026-12-25" + "x".repeat(4001) },
    { pickupPhone: "1".repeat(51) }, { pickupInstructions: "x".repeat(501) },
  ];
  for (const values of invalid) {
    const f = fixture();
    assert.equal((await f.submit(values)).ok, false, JSON.stringify(values).slice(0, 100));
    assert.equal(f.writes.length, 0);
    assert.equal(f.lookups.length, 0);
  }
});

test("pickup boundaries and disabled empty weekdays are accepted", async () => {
  for (const values of [
    { pickupPreparationDays: "0", pickupAdvanceDays: "1", pickupWeekdaysCsv: "0,1,2,3,4,5,6", pickupPhone: "", pickupBlockedDatesCsv: "" },
    { pickupPreparationDays: "60", pickupAdvanceDays: "90" },
    { pickupEnabled: "false", pickupWeekdaysCsv: "" },
  ]) {
    assert.equal((await fixture().submit(values)).ok, true);
  }
});

test("loader requests and preserves the complete canonical Shopify address", async () => {
  const f = fixture();
  const result = await f.loader({ request: new Request("https://fixture.test/app/locations") });
  for (const field of ["address1", "address2", "city", "province", "provinceCode", "zip", "country", "countryCode", "phone"]) {
    assert.match(f.lookups[0].query, new RegExp(`\\b${field}\\b`));
    assert.ok(result.locations[0].address[field]);
  }
  assert.doesNotMatch(f.lookups[0].query, /products\(|collections\(/);
  assert.equal(result.selectedLocationId, id);
});

test("pickup orders view reads Shopify attributes without persisting customer data", async () => {
  const order = {
    id: "gid://shopify/Order/987",
    name: "#1001",
    createdAt: "2026-10-08T10:30:00Z",
    email: "checkout@example.test",
    shippingAddress: { name: "Checkout Name", address1: "9 Customer Road", city: "Boston", country: "United States" },
    customAttributes: [
      { key: "_incode_pickup_location_id", value: id },
      { key: "_incode_pickup_location_name", value: "Canonical Shopify store" },
      { key: "_incode_pickup_date", value: "2026-10-12" },
      { key: "_incode_pickup_first_name", value: "Ada" },
      { key: "_incode_pickup_last_name", value: "Lovelace" },
      { key: "_incode_pickup_phone", value: "+1 555 0100" },
    ],
  };
  const f = fixture({ scope: "read_locations,read_orders", orders: [order] });
  const result = await f.loader({ request: new Request("https://fixture.test/app/locations?view=pickups") });
  assert.equal(result.orderAccessGranted, true);
  assert.equal(result.pickupOrders.length, 1);
  assert.equal(result.pickupOrders[0].customerName, "Ada Lovelace");
  assert.equal(result.pickupOrders[0].pickupDate, "2026-10-12");
  assert.equal(result.pickupOrders[0].pickupLocationAddress, "123 Main St, Suite 2, Boston, Massachusetts, 02108, United States");
  assert.equal(f.writes.length, 0);
  assert.match(f.lookups.at(-1).query, /orders\(first: 100/);
});

test("pickup orders view explains missing order authorization without querying orders", async () => {
  const f = fixture();
  const result = await f.loader({ request: new Request("https://fixture.test/app/locations?view=pickups") });
  assert.equal(result.orderAccessGranted, false);
  assert.match(result.pickupOrdersError, /read_orders/);
  assert.equal(f.lookups.some(({ query }) => query.includes("RecentServiceOrders")), false);
});

test("delivery orders view reads local-delivery attributes without persisting customer data", async () => {
  const order = {
    id: "gid://shopify/Order/988",
    name: "#1002",
    createdAt: "2026-10-08T11:30:00Z",
    email: "delivery@example.test",
    shippingAddress: { name: "Checkout Name", address1: "10 Delivery Road", city: "Boston", zip: "02108", country: "United States" },
    customAttributes: [
      { key: "_incode_service_type", value: "delivery" },
      { key: "_incode_service_postal_code", value: "02108" },
      { key: "_incode_delivery_date", value: "Friday, 16 October" },
      { key: "_incode_delivery_first_name", value: "Grace" },
      { key: "_incode_delivery_last_name", value: "Hopper" },
      { key: "_incode_delivery_phone", value: "+1 555 0200" },
    ],
  };
  const f = fixture({ scope: "read_locations,read_orders", orders: [order] });
  const result = await f.loader({ request: new Request("https://fixture.test/app/locations?view=deliveries") });
  assert.equal(result.deliveryOrders.length, 1);
  assert.equal(result.deliveryOrders[0].customerName, "Grace Hopper");
  assert.equal(result.deliveryOrders[0].postalCode, "02108");
  assert.equal(result.deliveryOrders[0].deliveryDate, "Friday, 16 October");
  assert.equal(f.writes.length, 0);
});

test("locations admin stays focused on actionable delivery and pickup settings", () => {
  for (const guidance of [
    'title="Local delivery"',
    'title="Store pickup"',
     'serviceLabel="Local delivery"',
     'serviceLabel="Store pickup"',
    "Use existing delivery zones",
  ]) assert.match(source, new RegExp(guidance));

  for (const clutter of ["Reference tabs setup", "Customer ZIP availability checker", "Service tabs preview", "Static reference only", "Legacy standard-card appearance"]) {
    assert.doesNotMatch(source, new RegExp(clutter));
  }
  assert.doesNotMatch(source, /label="Preview style"/);
  assert.doesNotMatch(source, /label="Block icons"/);
  assert.match(source, /Set Shipping coverage/);
  assert.match(source, /Storefront setup/);
  assert.match(source, /Add to Product/);
  assert.match(source, /Add to Cart/);
   assert.doesNotMatch(source, /<Text as="h2" variant="headingMd">Service setup/);
   assert.doesNotMatch(source, /Set up Shipping/);
   assert.doesNotMatch(source, /Set up delivery/);
   assert.doesNotMatch(source, /Set up pickup/);
   assert.doesNotMatch(source, /Audience and zones only filter a service; they do not enable it/);
  assert.match(source, /settings\/locations/);
  assert.match(source, /function BlockedDatesPicker/);
  assert.match(source, /label="Block a pickup date"/);
  assert.match(source, /Add date/);
  assert.match(source, /No blocked dates added\./);
  assert.doesNotMatch(source, /label="Blocked pickup dates"/);
  assert.match(source, /function LocationSettingsSection/);
  assert.match(source, /Routing & timing/);
  assert.match(source, /incode-setup-rail/);
  assert.match(source, /name="localDeliveryZoneIdsCsv"/);
  assert.match(source, /One or more delivery zones are unavailable/);
  assert.match(source, />Locations</);
  assert.match(source, /Add in Shopify/);
  assert.match(source, /Pickup on/);
  assert.match(source, /Needs setup/);
  assert.match(source, /incode-pickup-directory/);
  assert.match(source, /Pickup customer details/);
  assert.match(source, /Delivery customer details/);
  assert.match(source, /Delivery orders/);
  assert.match(source, /Customer data is read live and is not copied into the app database/);
  assert.match(source, /Search locations/);
   assert.match(source, /Save status/);
   assert.match(source, /Save routing/);
   assert.match(source, /Save delivery/);
   assert.match(source, /Save pickup/);
   assert.match(source, /modeName="localDeliveryTargetMode"/);
   assert.match(source, /valuesName="localDeliveryTargetValuesCsv"/);
   assert.match(source, /modeName="pickupTargetMode"/);
   assert.match(source, /valuesName="pickupTargetValuesCsv"/);
    assert.doesNotMatch(source, /title="Audience"/);
    assert.doesNotMatch(source, /Only selected delivery zones/);
   assert.match(source, /Location selection/);
    assert.match(source, /Save strategy/);
  assert.match(source, /name="section"/);
  assert.match(source, /name="pickupEnabledState"/);
  assert.match(source, /name="localDeliveryEnabledState"/);
  assert.match(source, /value="enable_pickup"/);
  assert.match(source, />Enable pickup</);
  assert.match(source, /locations\.filter\(\(location\) => location\.id === selectedLocationId\)/);
   assert.doesNotMatch(source, /incode-section-nav/);
  assert.match(source, /Saved just now/);
  assert.match(source, /id="location-section-pickup"/);
  assert.doesNotMatch(source, /Each section saves independently/);
  assert.doesNotMatch(source, /Pickup readiness/);
});

test("only the submitted location section displays a saving indicator", () => {
  assert.doesNotMatch(source, /loading=\{fetcher\.state !== "idle"\}/);
  for (const section of ["status", "routing", "delivery", "pickup"]) {
    assert.match(source, new RegExp(`loading=\\{isSaving\\(\\\`${section}:\\\$\\{location\\.id\\}\\\`\\)\\}`));
  }
  assert.match(source, /loading=\{isSaving\("priority-mode"\)\}/);
  assert.match(source, /loading=\{isSaving\(`enable-pickup:\$\{location\.id\}`\)\}/);
  assert.match(source, /<details id=\{id\} className="incode-location-section" open>/);
  assert.equal((source.match(/<LocationSettingsSection/g) || []).length, 3);
  assert.doesNotMatch(source, /openSection/);
});

test("one-click pickup enablement verifies Shopify status and activates the location", async () => {
  const f = fixture();
  const result = await f.submit({ intent: "enable_pickup" });
  assert.equal(result.ok, true);
  assert.equal(f.writes[0].update.enabled, true);
  assert.equal(f.writes[0].update.pickupEnabled, true);
  assert.equal(f.writes[0].update.localDeliveryEnabled, true);
});

test("additive SQLite migration preserves existing rows and supplies pickup defaults", async (t) => {
  const directory = await mkdtemp("/tmp/opencode/admin-pickup-");
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${directory}/test.sqlite?connection_limit=1` } } });
  t.after(async () => {
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });
  await prisma.$executeRawUnsafe('CREATE TABLE "FulfillmentLocationRule" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)');
  await prisma.$executeRawUnsafe('INSERT INTO "FulfillmentLocationRule" ("id", "name") VALUES (1, \'Existing location\')');
  const sql = readFileSync(new URL("../prisma/migrations/20261007180000_pickup_location_schedule/migration.sql", import.meta.url), "utf8");
  for (const statement of sql.split(";").filter((value) => value.trim())) await prisma.$executeRawUnsafe(statement);
  const [row] = await prisma.$queryRawUnsafe('SELECT * FROM "FulfillmentLocationRule"');
  assert.equal(row.name, "Existing location");
  assert.equal(row.pickupPhone, "");
  assert.equal(Number(row.pickupPreparationDays), 0);
  assert.equal(row.pickupWeekdaysCsv, "0,1,2,3,4,5,6");
  assert.equal(row.pickupBlockedDatesCsv, "");
  assert.equal(Number(row.pickupAdvanceDays), 30);
});

test("split location targeting migration copies shared audiences to both services", async (t) => {
  const directory = await mkdtemp("/tmp/opencode/location-targeting-");
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${directory}/test.sqlite?connection_limit=1` } } });
  t.after(async () => {
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });
  await prisma.$executeRawUnsafe('CREATE TABLE "FulfillmentLocationRule" ("id" INTEGER PRIMARY KEY, "serviceTargetMode" TEXT NOT NULL, "serviceTargetValuesCsv" TEXT NOT NULL)');
  await prisma.$executeRawUnsafe('INSERT INTO "FulfillmentLocationRule" ("id", "serviceTargetMode", "serviceTargetValuesCsv") VALUES (1, \'product\', \'10,11\')');
  const sql = readFileSync(new URL("../prisma/migrations/20261009100000_split_location_service_targeting/migration.sql", import.meta.url), "utf8");
  for (const statement of sql.split(";").filter((value) => value.trim())) await prisma.$executeRawUnsafe(statement);
  const [row] = await prisma.$queryRawUnsafe('SELECT * FROM "FulfillmentLocationRule"');
  assert.equal(row.localDeliveryTargetMode, "product");
  assert.equal(row.localDeliveryTargetValuesCsv, "10,11");
  assert.equal(row.pickupTargetMode, "product");
  assert.equal(row.pickupTargetValuesCsv, "10,11");
});
