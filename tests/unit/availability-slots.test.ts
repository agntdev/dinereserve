import assert from "node:assert/strict";
import {
  calculateAvailability,
  filterSlotsByBookings,
  formatSlotDateTime,
  generateSlotsForDate,
  generateSlotTimes,
  intervalsOverlap,
  loadConfigFromDefaults,
} from "../../src/availability.js";

function runTests(): void {
  const config = loadConfigFromDefaults();

  assert.deepEqual(generateSlotTimes(config), [
    "11:00",
    "11:15",
    "11:30",
    "11:45",
    "12:00",
    "12:15",
    "12:30",
    "12:45",
    "13:00",
    "13:15",
    "13:30",
    "13:45",
    "14:00",
    "14:15",
    "14:30",
    "14:45",
    "15:00",
    "15:15",
    "15:30",
    "15:45",
    "16:00",
    "16:15",
    "16:30",
    "16:45",
    "17:00",
    "17:15",
    "17:30",
    "17:45",
    "18:00",
    "18:15",
    "18:30",
    "18:45",
    "19:00",
    "19:15",
    "19:30",
    "19:45",
    "20:00",
    "20:15",
    "20:30",
  ]);

  const slots = generateSlotsForDate("2026-06-20", config);
  assert.equal(slots.length, 39);
  assert.equal(formatSlotDateTime(slots[0]), "11:00");
  assert.equal(formatSlotDateTime(slots.at(-1)!), "20:30");
  assert.equal(
    slots[0].end.getTime() - slots[0].start.getTime(),
    config.sittingLengthMinutes * 60_000
  );

  const blocked = filterSlotsByBookings(slots, [
    {
      start: new Date(Date.UTC(2026, 5, 20, 12, 0, 0, 0)),
      end: new Date(Date.UTC(2026, 5, 20, 13, 30, 0, 0)),
      status: "confirmed",
    },
  ]);

  assert.ok(!blocked.some((slot) => formatSlotDateTime(slot) === "12:00"));
  assert.ok(!blocked.some((slot) => formatSlotDateTime(slot) === "12:15"));
  assert.ok(blocked.some((slot) => formatSlotDateTime(slot) === "13:30"));

  assert.equal(
    intervalsOverlap(
      new Date("2026-06-20T12:00:00.000Z"),
      new Date("2026-06-20T13:30:00.000Z"),
      new Date("2026-06-20T13:00:00.000Z"),
      new Date("2026-06-20T14:30:00.000Z")
    ),
    true
  );

  const availability = calculateAvailability(4, config, {
    isoDate: "2026-06-20",
    bookings: [
      {
        start: new Date(Date.UTC(2026, 5, 20, 18, 0, 0, 0)),
        end: new Date(Date.UTC(2026, 5, 20, 19, 30, 0, 0)),
        status: "confirmed",
      },
    ],
  });

  assert.equal(availability.slotCount, 28);
  assert.ok(!availability.slots.includes("18:00"));
  assert.ok(availability.slots.includes("19:30"));
}

runTests();
console.log("availability-slots tests passed");