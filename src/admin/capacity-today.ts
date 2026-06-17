import type { Bot } from "grammy";
import type { BotContext } from "@agntdev/bot-toolkit";
import {
  DEFAULT_RESTAURANT_CONFIG,
  totalSeatCapacity,
  type RestaurantConfig,
} from "../config.js";
import {
  filterSlotsByBookings,
  formatSlotDateTime,
  generateSlotsForDate,
  intervalsOverlap,
  type BookingInterval,
} from "../availability.js";
import { getRepository } from "../db/index.js";
import { getPool } from "../db/pool.js";
import type { BookingRow } from "../db/types.js";
import { formatIsoDate, startOfDay } from "../reserve.js";
import { isAdmin } from "./auth.js";

const ACCESS_DENIED = "This command is only available to restaurant staff.";

function formatHours(config: RestaurantConfig): string {
  const open = `${String(config.openingHour).padStart(2, "0")}:${String(config.openingMinute).padStart(2, "0")}`;
  const close = `${String(config.closingHour).padStart(2, "0")}:${String(config.closingMinute).padStart(2, "0")}`;
  return `${open}–${close}`;
}

function formatTodayLabel(): string {
  return startOfDay(new Date()).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function bookingIntervals(bookings: BookingRow[]): BookingInterval[] {
  return bookings
    .filter((booking) => booking.status === "confirmed")
    .map((booking) => ({
      start: booking.start_dt,
      end: booking.end_dt,
      status: booking.status,
    }));
}

function occupiedSeatsForSlot(
  slotStart: Date,
  slotEnd: Date,
  bookings: BookingRow[],
  config: RestaurantConfig
): number {
  const occupiedTableIds = new Set<string>();

  for (const booking of bookings) {
    if (booking.status !== "confirmed") {
      continue;
    }

    if (intervalsOverlap(slotStart, slotEnd, booking.start_dt, booking.end_dt)) {
      for (const tableId of booking.assigned_tables) {
        occupiedTableIds.add(tableId);
      }
    }
  }

  return config.tables
    .filter((table) => occupiedTableIds.has(table.id))
    .reduce((sum, table) => sum + table.seats, 0);
}

export function formatCapacityTodaySummary(
  bookings: BookingRow[],
  config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG
): string {
  const isoDate = formatIsoDate(startOfDay(new Date()));
  const allSlots = generateSlotsForDate(isoDate, config);
  const activeBookings = bookingIntervals(bookings);
  const openSlots = filterSlotsByBookings(allSlots, activeBookings);
  const totalSeats = totalSeatCapacity(config);

  const lines = [
    `Today's capacity (${formatTodayLabel()})`,
    "",
    `Hours: ${formatHours(config)}`,
    `Sitting length: ${config.sittingLengthMinutes} min`,
    `Total seats: ${totalSeats}`,
    "",
    "Remaining seats by time block:",
  ];

  for (const slot of openSlots) {
    const occupied = occupiedSeatsForSlot(
      slot.start,
      slot.end,
      bookings,
      config
    );
    const remaining = totalSeats - occupied;
    lines.push(`${formatSlotDateTime(slot)} — ${remaining} seats free`);
  }

  if (openSlots.length === 0) {
    lines.push("No open time blocks today.");
  }

  return lines.join("\n");
}

export function registerCapacityTodayHandlers(bot: Bot<BotContext>): void {
  bot.command("capacity_today", async (ctx: BotContext) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(userId))) {
      await ctx.reply(ACCESS_DENIED);
      return;
    }

    const pool = getPool();
    let bookings: BookingRow[] = [];

    if (pool) {
      try {
        bookings = await getRepository(pool).bookings.listByDate(
          startOfDay(new Date())
        );
      } catch {
        await ctx.reply("Unable to load capacity. Please try again later.");
        return;
      }
    }

    await ctx.reply(formatCapacityTodaySummary(bookings));
  });
}