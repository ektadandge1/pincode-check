export type PickupSchedule = {
  pickupPreparationDays: number;
  pickupWeekdaysCsv: string;
  pickupBlockedDatesCsv: string;
  pickupAdvanceDays: number;
};

export function isPickupDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function pickupAvailableDates(schedule: PickupSchedule, timeZone: string, now = new Date()): string[] {
  const { pickupPreparationDays: preparation, pickupAdvanceDays: advance } = schedule;
  if (!Number.isInteger(preparation) || preparation < 0 || preparation > 60
    || !Number.isInteger(advance) || advance < 1 || advance > 90 || advance < preparation
    || typeof schedule.pickupWeekdaysCsv !== "string" || typeof schedule.pickupBlockedDatesCsv !== "string") {
    throw new RangeError("Invalid pickup schedule");
  }
  const weekdays = schedule.pickupWeekdaysCsv.split(",").map((value) => value.trim()).filter(Boolean);
  const blocked = schedule.pickupBlockedDatesCsv.split(",").map((value) => value.trim()).filter(Boolean);
  if (weekdays.some((value) => !/^[0-6]$/.test(value)) || blocked.some((value) => !isPickupDate(value))) {
    throw new RangeError("Invalid pickup schedule");
  }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  // UTC is only a calendar arithmetic container; today's date comes from the shop's zone.
  const today = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  const dates: string[] = [];
  for (let offset = preparation; offset <= advance; offset += 1) {
    const date = new Date(today + offset * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    if (weekdays.includes(String(date.getUTCDay())) && !blocked.includes(key)) dates.push(key);
  }
  return dates;
}
