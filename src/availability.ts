import {
  DEFAULT_RESTAURANT_CONFIG,
  type RestaurantConfig,
  totalSeatCapacity,
} from "./config.js";
import {
  type BookingInterval,
  filterSlotsByBookings,
  formatSlotDateTime,
  generateSlotTimes,
  generateSlotsForDate,
  loadConfigFromDefaults,
  type SlotDateTime,
} from "./availability/slots.js";

export type { BookingInterval, SlotDateTime };
export {
  filterSlotsByBookings,
  formatSlotDateTime,
  generateSlotTimes,
  generateSlotsForDate,
  intervalsOverlap,
  isActiveBooking,
  loadConfigFromDefaults,
  parseIsoDate,
  slotStartDate,
  toMinutes,
} from "./availability/slots.js";

export interface AvailabilityOptions {
  isoDate?: string;
  bookings?: BookingInterval[];
}

export interface AvailabilityResult {
  slotCount: number;
  slots: string[];
  maxPartySize: number;
}

function canSeatParty(
  partySize: number,
  config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG
): boolean {
  if (partySize <= 0) {
    return false;
  }

  if (!config.allowTableSplitting) {
    return config.tables.some((table) => table.seats >= partySize);
  }

  return partySize <= totalSeatCapacity(config);
}

function resolveSlotLabels(
  config: RestaurantConfig,
  options?: AvailabilityOptions
): string[] {
  const dateSlots = options?.isoDate
    ? generateSlotsForDate(options.isoDate, config)
    : generateSlotsForDate("1970-01-01", config);

  const availableSlots = options?.bookings
    ? filterSlotsByBookings(dateSlots, options.bookings)
    : dateSlots;

  return availableSlots.map(formatSlotDateTime);
}

export function calculateAvailability(
  partySize: number,
  config: RestaurantConfig = loadConfigFromDefaults(),
  options?: AvailabilityOptions
): AvailabilityResult {
  const slots = resolveSlotLabels(config, options);
  const maxPartySize = totalSeatCapacity(config);

  if (!canSeatParty(partySize, config)) {
    return { slotCount: 0, slots: [], maxPartySize };
  }

  return {
    slotCount: slots.length,
    slots,
    maxPartySize,
  };
}

export function formatAvailabilitySummary(
  partySize: number,
  dateLabel: string,
  result: AvailabilityResult
): string {
  if (partySize > result.maxPartySize) {
    return (
      `${partySize} guests on ${dateLabel}:\n` +
      `Sorry, our largest seating is ${result.maxPartySize} guests. ` +
      "Please contact the restaurant for special requests."
    );
  }

  if (result.slotCount === 0) {
    return `${partySize} guests on ${dateLabel}:\nNo time slots are available.`;
  }

  const slotLabel = result.slotCount === 1 ? "time slot" : "time slots";
  return `${partySize} guests on ${dateLabel}:\n${result.slotCount} ${slotLabel} available.`;
}