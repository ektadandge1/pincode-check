import assert from "node:assert/strict";
import test from "node:test";

import {
  accessForPlan,
  NO_PLAN_ACCESS,
  STANDARD_FEATURES,
} from "../app/services/plans.server.ts";

test("Startup grants the complete paid feature set", () => {
  const access = accessForPlan("startup");
  assert.equal(access.active, true);
  assert.equal(access.plan, "startup");
  assert.equal(access.planName, "Startup");
  assert.equal(access.billingPeriod, "EVERY_30_DAYS");
  assert.ok(Object.values(STANDARD_FEATURES).every(Boolean));
  assert.ok(Object.values(access.features).every(Boolean));
});

test("no subscription grants no paid features", () => {
  assert.equal(NO_PLAN_ACCESS.active, false);
  assert.equal(NO_PLAN_ACCESS.plan, null);
  assert.ok(Object.values(NO_PLAN_ACCESS.features).every((enabled) => !enabled));
});
