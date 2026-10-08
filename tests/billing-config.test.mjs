/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";

import {
  isBillingRequired,
} from "../app/services/billing-config.server.ts";

function withEnv(values, callback) {
  values = { NODE_ENV: "test", APP_ENV: "test", SHOPIFY_BILLING_DEV_BYPASS: undefined, ...values };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("billing enforcement is required by default", () => {
  withEnv({ SHOPIFY_BILLING_REQUIRED: undefined }, () => {
    assert.equal(isBillingRequired(), true);
  });
});

test("billing enforcement accepts explicit booleans case-insensitively", () => {
  withEnv({ SHOPIFY_BILLING_REQUIRED: "false" }, () => {
    assert.equal(isBillingRequired(), false);
  });
});

test("billing enforcement rejects ambiguous values", () => {
  withEnv({ SHOPIFY_BILLING_REQUIRED: "yes" }, () => {
    assert.throws(() => isBillingRequired(), /must be either/);
  });
});

test("development bypass avoids billing network failures without changing production enforcement", () => {
  withEnv({
    APP_ENV: "development",
    SHOPIFY_BILLING_DEV_BYPASS: undefined,
    SHOPIFY_BILLING_REQUIRED: "true",
  }, () => {
    assert.equal(isBillingRequired(), false);
  });

  withEnv({
    APP_ENV: "production",
    SHOPIFY_BILLING_DEV_BYPASS: undefined,
    SHOPIFY_BILLING_REQUIRED: "true",
  }, () => {
    assert.equal(isBillingRequired(), true);
  });
});

test("production billing fails closed for unsafe or missing flags in either environment marker", () => {
  for (const marker of ["NODE_ENV", "APP_ENV"]) {
    for (const overrides of [
      { SHOPIFY_BILLING_REQUIRED: undefined },
      { SHOPIFY_BILLING_REQUIRED: "false" },
      { SHOPIFY_BILLING_DEV_BYPASS: "true" },
      { SHOPIFY_BILLING_DEV_BYPASS: "yes" },
    ]) {
      withEnv({ [marker]: "production", SHOPIFY_BILLING_REQUIRED: "true", ...overrides }, () => {
        assert.throws(() => isBillingRequired(), /SHOPIFY_BILLING_/);
      });
    }
  }
});

test("NODE_ENV production cannot use an APP_ENV development bypass", () => {
  withEnv({ NODE_ENV: "production", APP_ENV: "development", SHOPIFY_BILLING_REQUIRED: "true", SHOPIFY_BILLING_DEV_BYPASS: "false" }, () => {
    assert.equal(isBillingRequired(), true);
  });
});
