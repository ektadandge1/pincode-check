import prisma from "../db.server";
import { checkVariantInventory } from "../utils/variant-inventory";
import {
  aggregateCartDeliveryItems, matchesPostalPattern, normalizeCountryCode, normalizePostalCode,
  parsePostalPattern, postalPatternSpecificity, postalCodeLookupValues, validatePostalCode, type CartDeliveryItemInput,
} from "../utils/delivery.server";
import { isPickupDate, pickupAvailableDates, type PickupSchedule } from "../utils/pickup-schedule";
import { locationTargetMode, matchesLocationTarget } from "../utils/location-targeting";
import { MAX_SERVICE_AVAILABILITY_RULES, matchDeliveryTarget, type DeliveryTargetRecord } from "../utils/targeting.server";

type PickupRule = PickupSchedule & {
  shopifyLocationId: string;
  pickupInstructions: string;
  pickupPhone: string;
  pickupTargetMode?: string | null;
  pickupTargetValuesCsv?: string | null;
  serviceTargetMode?: string | null;
  serviceTargetValuesCsv?: string | null;
};
type Admin = NonNullable<Parameters<typeof checkVariantInventory>[0]>;
type Location = {
  id: string; name: string; isActive: boolean; fulfillsOnlineOrders: boolean;
  address: { address1: string | null; address2: string | null; city: string | null; province: string | null;
    zip: string | null; country: string | null; countryCode: string | null; phone: string | null };
};

export async function getPickupOptions(input: {
  shop?: string; admin?: Admin; items: CartDeliveryItemInput[]; complete: boolean;
  country?: string; postalCode?: string; timeZone: string;
  pickupLocationId?: string | null; pickupDate?: string | null; now?: Date;
}) {
  const selection = input.pickupLocationId !== undefined && input.pickupLocationId !== null
    || input.pickupDate !== undefined && input.pickupDate !== null;
  if (selection && (!/^(?:gid:\/\/shopify\/Location\/)?[0-9]+$/.test(input.pickupLocationId ?? "")
    || !isPickupDate(input.pickupDate ?? ""))) throw new RangeError("Invalid pickup selection");
  if (!input.shop || !input.admin) throw new Error("Pickup context unavailable");
  if (!input.complete || !input.items.length || input.items.length > 20
    || input.items.some((item) => !/^(?:gid:\/\/shopify\/ProductVariant\/)?[0-9]+$/.test(item.variantId ?? "")
      || !Number.isInteger(item.quantity) || item.quantity! < 1 || item.quantity! > 999)) {
    throw new RangeError("Invalid pickup items");
  }
  const rules = await prisma.fulfillmentLocationRule.findMany({
    where: { shop: input.shop, enabled: true, pickupEnabled: true },
    orderBy: [{ priority: "asc" }, { id: "asc" }], take: 101,
  }) as unknown as PickupRule[];
  const serviceRules = prisma.serviceAvailabilityRule ? await prisma.serviceAvailabilityRule.findMany({
    where: { shop: input.shop, enabled: true },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    take: MAX_SERVICE_AVAILABILITY_RULES + 1,
  }) : [];
  if (rules.length > 100) throw new Error("Pickup rules exceed limit");
  if (serviceRules.length > MAX_SERVICE_AVAILABILITY_RULES) throw new Error("Service availability rules exceed the supported limit");

  let zoneId: number | null = null;
  const country = normalizeCountryCode(input.country);
  const postal = normalizePostalCode(country, input.postalCode ?? "");
  const hasZoneRules = rules.some((rule) => locationTargetMode(rule, "pickup") === "zone")
    || serviceRules.some((rule) => rule.targetKind === "zone");
  const validPostalContext = Boolean(input.country && validatePostalCode(country, postal));
  const requires_postal_code = hasZoneRules && !validPostalContext;
  if (hasZoneRules && validPostalContext) {
    const canonicalExact = await prisma.postalCode.findFirst({
      where: { shop: input.shop, country, postalCode: postal, patternType: "exact" }, include: { zoneGroup: true },
    });
    const legacyValues = postalCodeLookupValues(country, postal).slice(1);
    const exact = canonicalExact ?? (legacyValues.length ? await prisma.postalCode.findFirst({
      where: { shop: input.shop, country, postalCode: { in: legacyValues }, patternType: "exact" }, include: { zoneGroup: true },
    }) : null);
    if (exact && (exact.zoneId === null || exact.zoneGroup?.enabled)) {
      zoneId = exact.zoneGroup?.shop === input.shop ? exact.zoneId : null;
    } else {
      const patterns = await prisma.postalCode.findMany({
        where: { shop: input.shop, country, patternType: { in: ["range", "wildcard"] } },
        include: { zoneGroup: true }, orderBy: { id: "asc" }, take: 2001,
      });
      if (patterns.length > 2000) throw new Error("Pickup zone lookup exceeds limit");
      const candidates = patterns.flatMap((row) => {
        if (row.zoneId !== null && (!row.zoneGroup?.enabled || row.zoneGroup.shop !== input.shop)) return [];
        const parsed = parsePostalPattern(country, row.patternType === "range" && row.rangeStart && row.rangeEnd
          ? `${row.rangeStart} - ${row.rangeEnd}` : row.postalCode);
        return parsed && matchesPostalPattern(parsed, country, postal)
          ? [{ row, specificity: postalPatternSpecificity(parsed) }] : [];
      }).sort((a, b) => b.specificity - a.specificity
        || (a.row.zoneGroup?.priority ?? 100) - (b.row.zoneGroup?.priority ?? 100) || a.row.id - b.row.id);
      zoneId = candidates[0]?.row.zoneId ?? null;
    }
  }
  const pickupAllowed = (item: CartDeliveryItemInput) => {
    const matched = matchDeliveryTarget(serviceRules.map((rule): DeliveryTargetRecord => ({
      ...rule,
      countryCode: null,
      stateRegion: null,
      inventoryMode: "any",
      activationMode: "always",
      activeFromLocal: null,
      activeUntilLocal: null,
      weekdaysCsv: "",
      startTimeLocal: null,
      endTimeLocal: null,
      requireValidPin: false,
      processingDays: null,
      transitDays: null,
      excluded: false,
      customSuccessMessage: null,
    })), {
      productId: item.productId,
      vendor: item.productVendor,
      tags: item.productTags,
      collectionHandles: item.collectionHandles,
      zoneId,
      country: input.country,
      timeZone: input.timeZone,
      now: input.now,
    });
    return matched?.pickupAvailable ?? true;
  };
  const eligibleRules = rules.filter((rule) => input.items.every((item) => {
    if (!pickupAllowed(item)) return false;
    return matchesLocationTarget(rule, "pickup", { ...item, zoneId });
  }));
  const inventories = eligibleRules.length ? await Promise.all(aggregateCartDeliveryItems(input.items).map(async ({ item }) => {
    const inventory = await checkVariantInventory(input.admin, item.variantId!);
    if (!inventory) throw new Error("Pickup inventory unavailable");
    return { inventory, quantity: item.quantity! };
  })) : [];
  const stocked = eligibleRules.filter((rule) => inventories.every(({ inventory, quantity }) =>
    inventory.levels.some((level) => level.locationId === rule.shopifyLocationId && level.active
      && level.fulfillsOnlineOrders && level.available >= quantity)));
  let locations: Location[] = [];
  if (stocked.length) {
    const response = await input.admin.graphql(`#graphql
      query PickupLocations($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Location {
            id name isActive fulfillsOnlineOrders
            address { address1 address2 city province zip country countryCode phone }
          }
        }
      }`, { variables: { ids: stocked.map((rule) => rule.shopifyLocationId) } });
    const json = await response.json() as { errors?: unknown[]; data?: { nodes?: Array<Location | null> } };
    if (!response.ok || json.errors?.length || !Array.isArray(json.data?.nodes)
      || json.data.nodes.length !== stocked.length) throw new Error("Pickup locations unavailable");
    locations = json.data.nodes.filter((location): location is Location => Boolean(location?.id && location.address
      && typeof location.isActive === "boolean" && typeof location.fulfillsOnlineOrders === "boolean" && typeof location.name === "string"
      && ["address1", "address2", "city", "province", "zip", "country", "countryCode", "phone"].every((key) => {
        const value = location.address[key as keyof Location["address"]];
        return value === null || typeof value === "string";
      })));
  }
  const pickup_locations = stocked.flatMap((rule) => {
    const location = locations.find((value) => value.id === rule.shopifyLocationId && value.isActive && value.fulfillsOnlineOrders);
    if (!location) return [];
    let available_dates: string[];
    try {
      available_dates = pickupAvailableDates(rule, input.timeZone, input.now);
    } catch {
      throw new Error("Pickup schedule unavailable");
    }
    if (!available_dates.length) return [];
    const address = location.address;
    return [{ id: location.id, name: location.name, address1: address.address1 ?? "", address2: address.address2 ?? "",
      city: address.city ?? "", province: address.province ?? "", postal_code: address.zip ?? "",
      country: address.country ?? "", country_code: address.countryCode ?? "", phone: rule.pickupPhone || address.phone || "",
      pickup_instructions: rule.pickupInstructions, available_dates }];
  });
  const selectedId = input.pickupLocationId?.replace(/^(?:gid:\/\/shopify\/Location\/)?/, "gid://shopify/Location/");
  const message = pickup_locations.length ? ""
    : !rules.length ? "Store pickup is not currently enabled."
      : !eligibleRules.length ? "These items are not eligible for store pickup."
        : !stocked.length ? "These items are not stocked together at a pickup location."
          : "No pickup dates are currently available.";
  return { pickup_locations, requires_postal_code, message,
    ...(selection ? { pickup_selection_valid: pickup_locations.some((location) => location.id === selectedId
      && location.available_dates.includes(input.pickupDate!)) } : {}) };
}
