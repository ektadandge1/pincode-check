import assert from "node:assert/strict";
import test from "node:test";

import {
  inferShippingMethodKind,
  SHIPPING_METHOD_KINDS,
  serializeShippingMethod,
  shippingMethodHandle,
  shippingMethodEligible,
  validateShippingMethodFields,
} from "../app/utils/shipping-method.ts";

const unavailable = {
  express: false,
  sameDay: false,
  nextDay: false,
  local: false,
  pickup: false,
};

test("shipping method eligibility preserves every supported method kind", () => {
  assert.equal(shippingMethodEligible("standard", unavailable), true);
  assert.equal(shippingMethodEligible("express", { ...unavailable, express: true }), true);
  assert.equal(shippingMethodEligible("same_day", { ...unavailable, sameDay: true }), true);
  assert.equal(shippingMethodEligible("next_day", { ...unavailable, nextDay: true }), true);
  assert.equal(shippingMethodEligible("local", { ...unavailable, local: true }), true);
  assert.equal(shippingMethodEligible("pickup", { ...unavailable, pickup: true }), true);
  assert.equal(shippingMethodEligible("express", unavailable), false);
  assert.equal(shippingMethodEligible("unknown", unavailable), false);
});

test("Shopify method names infer conservative eligibility kinds", () => {
  assert.equal(inferShippingMethodKind("Express shipping"), "express");
  assert.equal(inferShippingMethodKind("Same day delivery"), "same_day");
  assert.equal(inferShippingMethodKind("Next-day service"), "next_day");
  assert.equal(inferShippingMethodKind("Store pickup"), "pickup");
  assert.equal(inferShippingMethodKind("Local courier"), "local");
  assert.equal(inferShippingMethodKind("Economy shipping"), "standard");
});

test("shipping method validation enforces copy limits and ETA ranges", () => {
  const valid = validateShippingMethodFields({
    name: "Express",
    handle: "express",
    kind: "express",
    priority: "20",
    processingDays: "",
    transitDays: "2",
    description: "Tracked priority delivery",
    customMessage: "Your express estimate is ready.",
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.value?.processingDays, null);

  assert.match(validateShippingMethodFields({
    name: "Express",
    handle: "express",
    kind: "express",
    priority: 20,
    transitDays: 2,
    description: "x".repeat(251),
  }).error ?? "", /250/);
  assert.match(validateShippingMethodFields({
    name: "Express",
    handle: "express",
    kind: "express",
    priority: 20,
    transitDays: 2,
    customMessage: "x".repeat(501),
  }).error ?? "", /500/);
});

test("shipping method serialization includes storefront copy and date labels", () => {
  assert.deepEqual(serializeShippingMethod({
    handle: "express",
    name: "Express",
    kind: "express",
    description: "Tracked priority delivery",
    customMessage: "Arrives quickly.",
    processingDays: null,
    transitDays: 2,
  }, {
    dispatchDate: "2026-10-02",
    dispatchDateLabel: "Friday, Oct 2",
    estimatedDate: "2026-10-06",
    estimatedDateLabel: "Tuesday, Oct 6",
    processingDays: 1,
  }), {
    handle: "express",
    name: "Express",
    kind: "express",
    description: "Tracked priority delivery",
    custom_message: "Arrives quickly.",
    dispatch_date: "2026-10-02",
    dispatch_date_label: "Friday, Oct 2",
    estimated_date: "2026-10-06",
    estimated_date_label: "Tuesday, Oct 6",
    processing_days: 1,
    transit_days: 2,
  });
});
