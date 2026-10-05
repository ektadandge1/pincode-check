import assert from "node:assert/strict";
import test from "node:test";

import {
  renderDeliveryMessage,
  unsupportedDeliveryShortcodes,
} from "../app/utils/delivery-message.ts";

test("renders date ranges and lead-day values", () => {
  const message = renderDeliveryMessage(
    "Arrives {min_delivery_date} to {max_delivery_date} ({min_lead_days}-{max_lead_days} days).",
    {
      min_delivery_date: "Friday, 02 Oct",
      max_delivery_date: "Tuesday, 06 Oct",
      min_lead_days: 3,
      max_lead_days: 5,
    },
  );

  assert.equal(message, "Arrives Friday, 02 Oct to Tuesday, 06 Oct (3-5 days).");
});

test("reports unsupported shortcodes before a message is saved", () => {
  assert.deepEqual(
    unsupportedDeliveryShortcodes("Delivery {min_delivery_date} {unknown_date} {unknown_date}"),
    ["unknown_date"],
  );
});

test("supports uppercase shortcodes and fallback values", () => {
  assert.equal(
    renderDeliveryMessage("Delivery in {MIN_LEAD_DAYS,3} to {MAX_LEAD_DAYS,5} days", {
      min_lead_days: 4,
    }),
    "Delivery in 4 to 5 days",
  );
});
