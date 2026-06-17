import {
  DEFAULT_RESTAURANT_CONFIG,
  type RestaurantConfig,
} from "../config.js";

export interface SlotDateTime {
  start: Date;
  end: Date;
}

export interface BookingInterval {
  start: Date;
  end: Date;
  status?: string;
}

const ACTIVE_BOOKING_STATUSES = new Set(["confirmed", "rescheduled"]);

export function loadConfigFromDefaults(): RestaurantConfig {
  return {
    ...DEFAULT_RESTAURANT_CONFIG,
    tables: DEFAULT_RESTAURANT_CONFIG.tables.map((table) => ({ ...table })),
  };
}

export function toMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

export function formatTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function parseIsoDate(isoDate: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function slotStartDate(
  isoDate: string,
  totalMinutes: number
): Date {
  const { year, month, day } = parseIsoDate(isoDate);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
}

export function intervalsOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date
): boolean {
  return startA < endB && endA > startB;
}

export function isActiveBooking(booking: BookingInterval): boolean {
  if (!booking.status) {
    return true;
  }

  return ACTIVE_BOOKING_STATUSES.has(booking.status);
}

export function generateSlotMinuteOffsets(config: RestaurantConfig): number[] {
  const opening = toMinutes(config.openingHour, config.openingMinute);
  const closing = toMinutes(config.closingHour, config.closingMinute);
  const lastStart = closing - config.sittingLengthMinutes;

  if (lastStart < opening) {
    return [];
  }

  const offsets: number[] = [];
  for (
    let minute = opening;
    minute <= lastStart;
    minute += config.slotGranularityMinutes
  ) {
    offsets.push(minute);
  }

  return offsets;
}

export function generateSlotTimes(
  config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG
): string[] {
  return generateSlotMinuteOffsets(config).map(formatTime);
}

export function generateSlotsForDate(
  isoDate: string,
  config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG
): SlotDateTime[] {
  const sittingLengthMs = config.sittingLengthMinutes * 60_000;

  return generateSlotMinuteOffsets(config).map((minuteOffset) => {
    const start = slotStartDate(isoDate, minuteOffset);
    return {
      start,
      end: new Date(start.getTime() + sittingLengthMs),
    };
  });
}

export function formatSlotDateTime(slot: SlotDateTime): string {
  const hours = String(slot.start.getUTCHours()).padStart(2, "0");
  const minutes = String(slot.start.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function filterSlotsByBookings(
  slots: SlotDateTime[],
  bookings: BookingInterval[]
): SlotDateTime[] {
  const activeBookings = bookings.filter(isActiveBooking);

  return slots.filter((slot) =>
    !activeBookings.some((booking) =>
      intervalsOverlap(slot.start, slot.end, booking.start, booking.end)
    )
  );
}