/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";

import {
  isBillingRequired,
  isBillingTestMode,
} from "../app/services/billing-config.server.ts";

function withEnv(values, callback) {
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

test("billing defaults to required test charges", () => {
  withEnv({ SHOPIFY_BILLING_TEST: undefined, SHOPIFY_BILLING_REQUIRED: undefined }, () => {
    assert.equal(isBillingTestMode(), true);
    assert.equal(isBillingRequired(), true);
  });
});

test("billing flags accept explicit booleans case-insensitively", () => {
  withEnv({ SHOPIFY_BILLING_TEST: "FALSE", SHOPIFY_BILLING_REQUIRED: "false" }, () => {
    assert.equal(isBillingTestMode(), false);
    assert.equal(isBillingRequired(), false);
  });
});

test("billing flags reject ambiguous values", () => {
  withEnv({ SHOPIFY_BILLING_TEST: "yes" }, () => {
    assert.throws(() => isBillingTestMode(), /must be either/);
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
