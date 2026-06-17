import type { BookingRow } from "../db/types.js";
import { DEFAULT_RESTAURANT_CONFIG, type RestaurantConfig } from "../config.js";

export interface TimeSlot {
  start: string;
  end: string;
  capacity: number;
  available: boolean;
}

export interface AvailabilityOptions {
  isoDate: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function generateSlotsForDate(
  isoDate: string,
  config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG,
): TimeSlot[] {
  const totalCapacity = config.tables.reduce((sum, t) => sum + t.capacity, 0);
  const slots: TimeSlot[] = [];
  const interval = config.slotIntervalMinutes;
  const startMinutes = config.openingHour * 60;
  const endMinutes = config.closingHour * 60;

  for (let m = startMinutes; m + interval <= endMinutes; m += interval) {
    const startH = Math.floor(m / 60);
    const startM = m % 60;
    const endH = Math.floor((m + interval) / 60);
    const endM = (m + interval) % 60;
    slots.push({
      start: `${pad(startH)}:${pad(startM)}`,
      end: `${pad(endH)}:${pad(endM)}`,
      capacity: totalCapacity,
      available: true,
    });
  }

  return slots;
}

export function filterSlotsByBookings(
  slots: TimeSlot[],
  bookings: BookingRow[],
  config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG,
): TimeSlot[] {
  const totalCapacity = config.tables.reduce((sum, t) => sum + t.capacity, 0);

  return slots.map((slot) => {
    const slotStartMin = timeToMinutes(slot.start);
    const slotEndMin = timeToMinutes(slot.end);

    const overlapping = bookings.filter((b) => {
      const bStart = timeToMinutes(b.slot_start);
      const bEnd = timeToMinutes(b.slot_end);
      return bStart < slotEndMin && bEnd > slotStartMin;
    });

    const bookedCapacity = overlapping.reduce((sum, b) => sum + b.party_size, 0);
    const remainingCapacity = totalCapacity - bookedCapacity;

    return {
      ...slot,
      capacity: remainingCapacity,
      available: remainingCapacity > 0,
    };
  });
}

export function calculateAvailability(
  partySize: number,
  bookings: BookingRow[] | undefined,
  options: AvailabilityOptions,
  config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG,
): TimeSlot[] {
  const slots = generateSlotsForDate(options.isoDate, config);

  const filteredByBookings =
    bookings && bookings.length > 0
      ? filterSlotsByBookings(slots, bookings, config)
      : slots;

  return filteredByBookings.filter((s) => s.capacity >= partySize);
}
