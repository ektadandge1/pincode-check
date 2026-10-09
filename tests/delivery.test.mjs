import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateCartDeliveryItems,
  aggregateDeliveryDateWindow,
  computeDeliveryDetails,
  computeEstimatedDate,
  formatReadableDate,
  normalizePostalCode,
  parseCartDeliveryItems,
  parseWeekendDays,
  toYyyyMmDd,
  validatePostalCode,
} from "../app/utils/delivery.server.ts";

test("normalizes and validates supported postal-code formats", () => {
  assert.equal(normalizePostalCode("CA", "k1a 0b1"), "K1A 0B1");
  assert.equal(validatePostalCode("CA", "K1A 0B1"), true);
  assert.equal(validatePostalCode("IN", "012345"), false);
  assert.equal(validatePostalCode("US", "10001-1234"), true);
});

test("custom date patterns render merchant-local calendar values", () => {
  const date = new Date("2026-10-08T20:30:00Z");
  assert.equal(
    formatReadableDate(date, "en-IN", "Asia/Kolkata", "custom:ddd, DD MMM YYYY"),
    "Fri, 09 Oct 2026",
  );
});

test("delivery estimates skip weekends and holidays", () => {
  const estimated = computeEstimatedDate({
    baseDays: 2,
    cutoffHour24: 14,
    holidays: new Set(["2026-09-28"]),
    weekendDays: parseWeekendDays("0,6"),
    now: new Date(2026, 8, 25, 10, 0, 0),
  });

  assert.equal(toYyyyMmDd(estimated), "2026-09-30");
});

const standardWeekends = new Set([0, 6]);

function dateInZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

test("before cutoff starts processing on the merchant's current business day", () => {
  const details = computeDeliveryDetails({
    processingDays: 1,
    transitDays: 2,
    cutoffHour24: 14,
    holidays: new Set(),
    weekendDays: standardWeekends,
    timeZone: "Asia/Kolkata",
    now: new Date("2026-09-28T07:30:00.000Z"), // Monday 13:00 IST
  });

  assert.equal(details.orderDate.toISOString(), "2026-09-28T07:30:00.000Z");
  assert.equal(dateInZone(details.dispatchDate, "Asia/Kolkata"), "2026-09-29");
  assert.equal(dateInZone(details.estimatedDate, "Asia/Kolkata"), "2026-10-01");
  assert.equal(details.cutoffRemainingSeconds, 60 * 60);
});

test("at or after cutoff defers processing and reports no countdown", () => {
  const atCutoff = computeDeliveryDetails({
    processingDays: 1,
    transitDays: 0,
    cutoffHour24: 14,
    holidays: new Set(),
    weekendDays: standardWeekends,
    timeZone: "America/New_York",
    now: new Date("2026-09-28T18:00:00.000Z"), // Monday 14:00 EDT
  });
  const afterCutoff = computeDeliveryDetails({
    processingDays: 0,
    transitDays: 1,
    cutoffHour24: 14,
    holidays: new Set(),
    weekendDays: standardWeekends,
    timeZone: "America/New_York",
    now: new Date("2026-09-28T18:30:00.000Z"),
  });

  assert.equal(dateInZone(atCutoff.dispatchDate, "America/New_York"), "2026-09-30");
  assert.equal(atCutoff.cutoffRemainingSeconds, 0);
  assert.equal(dateInZone(afterCutoff.dispatchDate, "America/New_York"), "2026-09-29");
  assert.equal(dateInZone(afterCutoff.estimatedDate, "America/New_York"), "2026-09-30");
  assert.equal(afterCutoff.cutoffRemainingSeconds, 0);
});

test("processing and transit independently skip weekends and holidays", () => {
  const details = computeDeliveryDetails({
    processingDays: 2,
    transitDays: 2,
    cutoffHour24: 17,
    holidays: new Set(["2026-10-05"]),
    weekendDays: standardWeekends,
    timeZone: "Europe/London",
    now: new Date("2026-10-02T10:00:00.000Z"), // Friday
  });

  assert.equal(dateInZone(details.dispatchDate, "Europe/London"), "2026-10-07");
  assert.equal(dateInZone(details.estimatedDate, "Europe/London"), "2026-10-09");
});

test("delivery windows calculate earliest and latest business dates", () => {
  const input = {
    processingDays: 1,
    cutoffHour24: 17,
    holidays: new Set(),
    weekendDays: standardWeekends,
    timeZone: "Asia/Kolkata",
    now: new Date("2026-10-01T05:00:00.000Z"), // Thursday
  };
  const earliest = computeDeliveryDetails({ ...input, transitDays: 2 });
  const latest = computeDeliveryDetails({ ...input, transitDays: 4 });

  assert.equal(dateInZone(earliest.estimatedDate, "Asia/Kolkata"), "2026-10-06");
  assert.equal(dateInZone(latest.estimatedDate, "Asia/Kolkata"), "2026-10-08");
});

test("merchant timezone controls the order date at a UTC date boundary", () => {
  const input = {
    processingDays: 0,
    transitDays: 0,
    cutoffHour24: 20,
    holidays: new Set(),
    weekendDays: standardWeekends,
    now: new Date("2026-09-29T01:00:00.000Z"),
  };
  const losAngeles = computeDeliveryDetails({ ...input, timeZone: "America/Los_Angeles" });
  const tokyo = computeDeliveryDetails({ ...input, timeZone: "Asia/Tokyo" });

  assert.equal(dateInZone(losAngeles.dispatchDate, "America/Los_Angeles"), "2026-09-28");
  assert.equal(losAngeles.cutoffRemainingSeconds, 2 * 60 * 60);
  assert.equal(dateInZone(tokyo.dispatchDate, "Asia/Tokyo"), "2026-09-29");
  assert.equal(tokyo.cutoffRemainingSeconds, 10 * 60 * 60);
});

test("countdown includes minutes, seconds, and milliseconds without overstating", () => {
  const details = computeDeliveryDetails({
    processingDays: 0,
    transitDays: 0,
    cutoffHour24: 14,
    holidays: new Set(),
    weekendDays: standardWeekends,
    timeZone: "UTC",
    now: new Date("2026-09-28T13:58:30.500Z"),
  });

  assert.equal(details.cutoffRemainingSeconds, 90);
});

test("calendar dates remain correct across a daylight-saving transition", () => {
  const details = computeDeliveryDetails({
    processingDays: 0,
    transitDays: 1,
    cutoffHour24: 14,
    holidays: new Set(),
    weekendDays: standardWeekends,
    timeZone: "America/New_York",
    now: new Date("2026-10-30T15:00:00.000Z"), // Friday 11:00 EDT
  });

  assert.equal(dateInZone(details.dispatchDate, "America/New_York"), "2026-10-30");
  assert.equal(dateInZone(details.estimatedDate, "America/New_York"), "2026-11-02");
  assert.equal(details.dispatchDate.toISOString(), "2026-10-30T04:00:00.000Z");
  assert.equal(details.estimatedDate.toISOString(), "2026-11-02T05:00:00.000Z");
});

test("readable date formatting honors locale and merchant timezone", () => {
  const instant = new Date("2026-09-29T01:00:00.000Z");

  assert.equal(formatReadableDate(instant, "en-US", "America/Los_Angeles"), "Monday, Sep 28");
  assert.equal(formatReadableDate(instant, "de-DE", "Europe/Berlin"), "Dienstag, 29. Sept.");
});

test("delivery calculations reject a schedule with all seven weekdays closed", () => {
  const weekendDays = parseWeekendDays("0,1,2,3,4,5,6");

  assert.throws(() => computeEstimatedDate({
    baseDays: 1,
    cutoffHour24: 14,
    holidays: new Set(),
    weekendDays,
    now: new Date("2026-10-01T10:00:00.000Z"),
  }), /cannot close all seven weekdays/);
  assert.throws(() => computeDeliveryDetails({
    processingDays: 1,
    transitDays: 1,
    cutoffHour24: 14,
    holidays: new Set(),
    weekendDays,
    timeZone: "UTC",
    now: new Date("2026-10-01T10:00:00.000Z"),
  }), /cannot close all seven weekdays/);
});

test("cart parsing accepts 250 complete lines and rejects oversized input", () => {
  const malformed = parseCartDeliveryItems('[{"variantId":"gid://variant/1","quantity":"many"}]');
  assert.equal(malformed.error, "invalid_cart");
  assert.equal(malformed.complete, false);

  const limitPayload = Array.from({ length: 250 }, (_, index) => ({
    productId: index + 1,
    variantId: `gid://shopify/ProductVariant/${index + 1}`,
    quantity: 1,
  }));
  const atLimit = parseCartDeliveryItems(JSON.stringify(limitPayload));
  assert.equal(atLimit.error, undefined);
  assert.equal(atLimit.items.length, 250);
  assert.equal(atLimit.complete, true);

  const oversized = parseCartDeliveryItems(JSON.stringify([...limitPayload, limitPayload[0]]));
  assert.equal(oversized.error, "cart_too_large");
  assert.equal(oversized.complete, false);
  assert.equal(oversized.items.length, 0);
});

test("duplicate cart variants aggregate quantities while preserving context", () => {
  const aggregated = aggregateCartDeliveryItems([
    {
      productId: "1",
      variantId: "gid://shopify/ProductVariant/10",
      quantity: 2,
      productTags: ["fragile"],
      collectionHandles: ["home"],
    },
    {
      productId: "1",
      variantId: "gid://shopify/ProductVariant/10",
      quantity: 3,
      productTags: ["sale"],
      collectionHandles: ["home", "new"],
    },
  ]);

  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].item.quantity, 5);
  assert.equal(aggregated[0].itemCount, 2);
  assert.deepEqual(aggregated[0].item.productTags, ["fragile", "sale"]);
  assert.deepEqual(aggregated[0].item.collectionHandles, ["home", "new"]);
});

test("cart date aggregation maximizes earliest and latest dates independently", () => {
  const dates = aggregateDeliveryDateWindow([
    {
      estimated_date: "2026-10-10",
      estimated_date_label: "10 Oct",
      estimated_date_max: "2026-10-12",
      estimated_date_max_label: "12 Oct",
      dispatch_date: "2026-10-05",
      dispatch_date_label: "5 Oct",
    },
    {
      estimated_date: "2026-10-09",
      estimated_date_label: "9 Oct",
      estimated_date_max: "2026-10-15",
      estimated_date_max_label: "15 Oct",
      dispatch_date: "2026-10-06",
      dispatch_date_label: "6 Oct",
    },
  ]);

  assert.deepEqual(dates, {
    estimated_date: "2026-10-10",
    estimated_date_label: "10 Oct",
    estimated_date_max: "2026-10-15",
    estimated_date_max_label: "15 Oct",
    dispatch_date: "2026-10-06",
    dispatch_date_label: "6 Oct",
  });
});
