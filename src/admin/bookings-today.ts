import type { Bot } from "grammy";
import type { BotContext } from "@agntdev/bot-toolkit";
import { getRepository } from "../db/index.js";
import { getPool } from "../db/pool.js";
import type { BookingRow, BookingStatus } from "../db/types.js";
import { startOfDay } from "../reserve.js";
import { isAdmin } from "./auth.js";

const ACCESS_DENIED = "This command is only available to restaurant staff.";
const CALLBACK_DENIED = "Only staff can manage bookings.";

const STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: "✅ Confirmed",
  cancelled: "❌ Cancelled",
  rescheduled: "🔄 Rescheduled",
  "no-show": "🚫 No-show",
};

function todayUtc(): Date {
  return startOfDay(new Date());
}

function formatTime(dt: Date): string {
  const hours = dt.getUTCHours().toString().padStart(2, "0");
  const minutes = dt.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatTodayLabel(): string {
  return todayUtc().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatTableList(tableIds: string[]): string {
  return tableIds.length > 0 ? tableIds.join(", ") : "None assigned";
}

function formatBookingList(dateLabel: string, bookings: BookingRow[]) {
  const lines = [`📋 Bookings for ${dateLabel}:\n`];

  for (const booking of bookings) {
    const startTime = formatTime(booking.start_dt);
    const endTime = formatTime(booking.end_dt);

    lines.push(
      `#${booking.ref_code} — ${booking.party_size} guest${
        booking.party_size > 1 ? "s" : ""
      } at ${startTime}–${endTime}`,
      `  Status: ${STATUS_LABELS[booking.status]}`,
      `  Tables: ${formatTableList(booking.assigned_tables)}`,
      ""
    );
  }

  lines.push(
    `Total: ${bookings.length} booking${bookings.length === 1 ? "" : "s"}`
  );

  const inlineKeyboard = bookings
    .filter((booking) => booking.status === "confirmed")
    .map((booking) => [
      {
        text: `🚫 #${booking.ref_code} No-show`,
        callback_data: `bkt:ns:${booking.ref_code}`,
      },
      {
        text: `❌ #${booking.ref_code} Cancel`,
        callback_data: `bkt:cxl:${booking.ref_code}`,
      },
    ]);

  return {
    text: lines.join("\n"),
    reply_markup:
      inlineKeyboard.length > 0
        ? { inline_keyboard: inlineKeyboard }
        : undefined,
  };
}

async function listTodayBookings(): Promise<BookingRow[]> {
  const pool = getPool();
  if (!pool) {
    return [];
  }

  return getRepository(pool).bookings.listByDate(todayUtc());
}

export function registerBookingsTodayHandlers(bot: Bot<BotContext>): void {
  bot.command("bookings_today", async (ctx: BotContext) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(userId))) {
      await ctx.reply(ACCESS_DENIED);
      return;
    }

    const todayLabel = formatTodayLabel();
    const pool = getPool();
    if (!pool) {
      await ctx.reply("Unable to load bookings. Please try again later.");
      return;
    }

    let bookings: BookingRow[];
    try {
      bookings = await listTodayBookings();
    } catch {
      await ctx.reply("Unable to load bookings. Please try again later.");
      return;
    }

    if (bookings.length === 0) {
      await ctx.reply(`📋 Bookings for ${todayLabel}:\n\nNo bookings yet.`);
      return;
    }

    const { text, reply_markup } = formatBookingList(todayLabel, bookings);
    await ctx.reply(text, { reply_markup });
  });

  bot.callbackQuery(/^bkt:(ns|cxl):/, async (ctx: BotContext) => {
    const data = ctx.callbackQuery?.data;
    if (!data) {
      await ctx.answerCallbackQuery();
      return;
    }

    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(userId))) {
      await ctx.answerCallbackQuery({ text: CALLBACK_DENIED });
      return;
    }

    const parts = data.split(":");
    const action = parts[1];
    const refCode = parts.slice(2).join(":");

    if (!refCode) {
      await ctx.answerCallbackQuery();
      return;
    }

    const pool = getPool();
    if (!pool) {
      await ctx.answerCallbackQuery({ text: "Failed to update booking. Try again." });
      return;
    }

    const newStatus: BookingStatus =
      action === "ns" ? "no-show" : "cancelled";
    const actionLabel = action === "ns" ? "marked as no-show" : "cancelled";

    try {
      const repo = getRepository(pool);
      const booking = await repo.bookings.getByRefCode(refCode);
      if (!booking) {
        await ctx.answerCallbackQuery({ text: "Booking not found." });
        return;
      }

      const updated = await repo.bookings.updateStatus(booking.id, newStatus);
      if (!updated) {
        await ctx.answerCallbackQuery({ text: "Booking not found." });
        return;
      }

      const todayLabel = formatTodayLabel();
      const bookings = await listTodayBookings();
      const { text, reply_markup } = formatBookingList(todayLabel, bookings);
      await ctx.editMessageText(text, { reply_markup });
      await ctx.answerCallbackQuery({
        text: `Booking #${refCode} ${actionLabel}.`,
      });
    } catch {
      await ctx.answerCallbackQuery({ text: "Failed to update booking. Try again." });
    }
  });
}