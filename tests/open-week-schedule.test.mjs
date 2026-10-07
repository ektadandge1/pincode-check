import assert from "node:assert/strict";
import test from "node:test";
import { parseWeekendDays } from "../app/utils/delivery.server.ts";

test("an explicit empty closed-weekday setting supports a seven-day operating week", () => {
  assert.deepEqual([...parseWeekendDays("")], []);
  assert.deepEqual([...parseWeekendDays("   ")], []);
  assert.deepEqual([...parseWeekendDays("0,6,")], [0, 6]);
  assert.deepEqual([...parseWeekendDays("invalid")], [0]);
});
