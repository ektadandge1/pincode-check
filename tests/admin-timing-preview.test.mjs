import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as dates from "../app/utils/delivery-date.ts";
import { computeDeliveryDetails as serverCalculator } from "../app/utils/delivery.server.ts";
import { renderDeliveryMessage } from "../app/utils/delivery-message.ts";

const source = readFileSync(new URL("../app/routes/app.delivery-settings.tsx", import.meta.url), "utf8");
const validation = source.slice(source.indexOf("function isValidCustomDatePattern"), source.indexOf("const ETA_MESSAGE_TEMPLATES"));
const preview = source.slice(source.indexOf("  const sampleProcessingDays ="), source.indexOf("  const zoneOptions ="));
const compiled = ts.transpileModule(`${validation}\n${preview}\nreturn { sampleDates, sampleMinLeadDays, sampleMaxLeadDays, previewMessage };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const evaluate = new Function("settings", "data", "activeTab", "computeDeliveryDetails", "formatReadableDate", "formatIsoDateInZone", "parseCsvToStringSet", "parseWeekendDays", "renderDeliveryMessage", compiled);
const defaults = {
  processingDays: "2", fallbackDays: "3", deliveryWindowDays: "2", cutoffHour24: "14",
  timeZone: "UTC", locale: "en-US", dateFormat: "weekday_day_month", customDateFormat: "ddd, DD MMM",
  weekendDaysCsv: "0,6", successMessage: "{processing_days} prep + {transit_days} transit: {min_delivery_date} to {max_delivery_date}. Ships {dispatch_date}.",
  codAvailableMessage: "COD",
};
const run = (settings = {}, { now = "2026-10-09T10:00:00.000Z", holidaysCsv = "", tab = "timing" } = {}) => evaluate(
  { ...defaults, ...settings }, { previewNow: now, setting: { holidaysCsv } }, { id: tab },
  dates.computeDeliveryDetails, dates.formatReadableDate, dates.formatIsoDateInZone,
  dates.parseCsvToStringSet, dates.parseWeekendDays, renderDeliveryMessage,
);

test("preview recalculates transit, preparation and delivery-window changes before saving", () => {
  const original = run();
  assert.equal(original.sampleDates.dispatchIso, "2026-10-13");
  assert.equal(original.sampleDates.minimumIso, "2026-10-16");
  assert.equal(original.sampleDates.maximumIso, "2026-10-20");
  assert.equal(run({ fallbackDays: "1" }).sampleDates.minimumIso, "2026-10-14");
  assert.equal(run({ fallbackDays: "5" }).sampleDates.minimumIso, "2026-10-20");
  assert.equal(run({ processingDays: "0" }).sampleDates.dispatchIso, "2026-10-09");
  const exact = run({ deliveryWindowDays: "0" });
  assert.equal(exact.sampleDates.minimumIso, exact.sampleDates.maximumIso);
  assert.equal(run({ fallbackDays: "0", processingDays: "0", deliveryWindowDays: "0" }).sampleDates.minimumIso, "2026-10-09");
  assert.equal(original.sampleMinLeadDays, 5);
  assert.equal(original.sampleMaxLeadDays, 7);
});

test("preview uses the same business calendar and cutoff calculation as the storefront", () => {
  assert.equal(serverCalculator, dates.computeDeliveryDetails);
  assert.equal(run({ weekendDaysCsv: "" }).sampleDates.minimumIso, "2026-10-14");
  assert.equal(run({}, { holidaysCsv: "2026-10-12" }).sampleDates.dispatchIso, "2026-10-14");
  assert.equal(run({}, { holidaysCsv: "2026-10-12" }).sampleDates.minimumIso, "2026-10-19");
  assert.equal(run({ cutoffHour24: "9" }).sampleDates.minimumIso, "2026-10-19");
  assert.equal(run({ cutoffHour24: "10" }).sampleDates.minimumIso, "2026-10-19");
});

test("preview dates and formatting use the selected merchant timezone and locale", () => {
  const settings = { processingDays: "0", fallbackDays: "0", deliveryWindowDays: "0", cutoffHour24: "18", weekendDaysCsv: "" };
  const now = "2026-10-09T23:30:00.000Z";
  const utc = run(settings, { now });
  const pacific = run({ ...settings, timeZone: "America/Los_Angeles" }, { now });
  assert.equal(utc.sampleDates.minimumIso, "2026-10-10");
  assert.equal(pacific.sampleDates.minimumIso, "2026-10-09");
  assert.equal(pacific.sampleDates.order, "Friday, Oct 09");
  const french = run({ locale: "fr-FR" });
  assert.equal(french.sampleDates.minimum, dates.formatReadableDate(new Date("2026-10-16T00:00:00Z"), "fr-FR", "UTC"));
  const custom = run({ dateFormat: "custom", customDateFormat: "YYYY/MM/DD" });
  assert.equal(custom.sampleDates.minimum, "2026/10/16");
});

test("message shortcodes share the selected transit values and computed preview dates", () => {
  for (const tab of ["timing", "messages"]) {
    const output = run({ fallbackDays: "1" }, { tab });
    assert.match(output.previewMessage, /2 prep \+ 1 transit/);
    assert.ok(output.previewMessage.includes(output.sampleDates.minimum));
    assert.match(output.previewMessage, /Ships 2026-10-13/);
  }
});

test("invalid unsaved schedules clear the preview instead of crashing or showing old dates", () => {
  for (const settings of [
    { weekendDaysCsv: "0,1,2,3,4,5,6" }, { timeZone: "Invalid/Zone" },
    { cutoffHour24: "24" }, { processingDays: "1.5" },
    { dateFormat: "custom", customDateFormat: "invalid" },
  ]) {
    const output = run(settings);
    assert.equal(output.sampleDates, null);
    assert.match(output.previewMessage, /Select valid timing settings/);
  }
});

test("page binds journey dates to the draft preview without hardcoded transit or calendar-day offsets", () => {
  assert.match(source, /previewNow: new Date\(\)\.toISOString\(\)/);
  assert.match(source, /from "\.\.\/utils\/delivery-date"/);
  assert.match(source, /<small>\{sampleOrderDate\}<\/small>/);
  assert.match(source, /<small>\{sampleDispatchDate\}<\/small>/);
  assert.doesNotMatch(preview, /sampleProcessingDays \+ 3|transit_days: 3|86_400_000/);
  assert.doesNotMatch(source, /function previewDate\(|function previewIsoDate\(/);
});
