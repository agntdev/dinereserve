import {
  DEFAULT_RESTAURANT_CONFIG,
  type RestaurantConfig,
  totalSeatCapacity,
} from "./config.js";

export interface AvailabilityResult {
  slotCount: number;
  slots: string[];
  maxPartySize: number;
}

function toMinutes(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function formatTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function generateSlotTimes(config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG): string[] {
  const opening = toMinutes(config.openingHour, config.openingMinute);
  const closing = toMinutes(config.closingHour, config.closingMinute);
  const lastStart = closing - config.sittingLengthMinutes;

  if (lastStart < opening) {
    return [];
  }

  const slots: string[] = [];
  for (let minute = opening; minute <= lastStart; minute += config.slotGranularityMinutes) {
    slots.push(formatTime(minute));
  }

  return slots;
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

export function calculateAvailability(
  partySize: number,
  config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG
): AvailabilityResult {
  const slots = generateSlotTimes(config);
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