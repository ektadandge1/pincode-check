import assert from "node:assert/strict";
import test from "node:test";
import { billingReturnUrl } from "../app/utils/billing-return-url.ts";

test("billing approval returns to the plans route on the current app origin", () => {
  assert.equal(
    billingReturnUrl(new Request("https://admin.example.test/auth?shop=demo.myshopify.com")),
    "https://admin.example.test/app/plans",
  );
});
