import assert from "node:assert/strict";
import test from "node:test";
import { pickupAvailableDates, isPickupDate } from "../app/utils/pickup-schedule.ts";

const schedule = { pickupPreparationDays: 0, pickupAdvanceDays: 3, pickupWeekdaysCsv: "0,1,2,3,4,5,6", pickupBlockedDatesCsv: "" };

test("pickup dates use shop-local today, including across DST and year boundaries", () => {
  const now = new Date("2026-01-01T00:30:00Z");
  assert.deepEqual(pickupAvailableDates(schedule, "America/Los_Angeles", now), ["2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03"]);
  assert.deepEqual(pickupAvailableDates(schedule, "Asia/Kolkata", now), ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  assert.deepEqual(pickupAvailableDates(schedule, "America/New_York", new Date("2026-03-07T17:00:00Z")), ["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
});

test("preparation is calendar days, advance is inclusive from today, weekdays and blocked dates restrict availability", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  assert.deepEqual(pickupAvailableDates({ ...schedule, pickupPreparationDays: 1, pickupAdvanceDays: 7, pickupWeekdaysCsv: "1,2,3,4,5", pickupBlockedDatesCsv: "2026-10-09" }, "UTC", now), ["2026-10-08", "2026-10-12", "2026-10-13", "2026-10-14"]);
  assert.throws(() => pickupAvailableDates({ ...schedule, pickupPreparationDays: 4 }, "UTC", now), RangeError);
  assert.deepEqual(pickupAvailableDates({ ...schedule, pickupWeekdaysCsv: "" }, "UTC", now), []);
});

test("invalid schedules and non-calendar dates cannot silently produce availability", () => {
  for (const value of ["2026-02-29", "2026-04-31", "2026-1-01", "tomorrow", "2026-10-07T00:00:00Z"]) assert.equal(isPickupDate(value), false);
  assert.equal(isPickupDate("2028-02-29"), true);
  for (const override of [{ pickupPreparationDays: -1 }, { pickupPreparationDays: 1.5 }, { pickupPreparationDays: 61, pickupAdvanceDays: 90 },
    { pickupAdvanceDays: 0 }, { pickupAdvanceDays: 91 }, { pickupAdvanceDays: 1.5 }, { pickupAdvanceDays: 2, pickupPreparationDays: 3 },
    { pickupWeekdaysCsv: "7" }, { pickupBlockedDatesCsv: "2026-02-29" }]) {
    assert.throws(() => pickupAvailableDates({ ...schedule, ...override }, "UTC"), RangeError);
  }
  assert.throws(() => pickupAvailableDates(schedule, "Invalid/Zone"), RangeError);
});

test("admin preparation and advance boundaries are accepted with an inclusive equal horizon", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  assert.deepEqual(pickupAvailableDates({ ...schedule, pickupAdvanceDays: 1 }, "UTC", now), ["2026-10-07", "2026-10-08"]);
  assert.deepEqual(pickupAvailableDates({ ...schedule, pickupPreparationDays: 60, pickupAdvanceDays: 60 }, "UTC", now), ["2026-12-06"]);
  const dates = pickupAvailableDates({ ...schedule, pickupPreparationDays: 60, pickupAdvanceDays: 90 }, "UTC", now);
  assert.equal(dates.length, 31);
  assert.equal(dates.at(-1), "2027-01-05");
});
