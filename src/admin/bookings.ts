import type { Bot } from "grammy";
import type { BotContext } from "@agntdev/bot-toolkit";
import { getRepository } from "../db/index.js";
import { getPool } from "../db/pool.js";
import type { BookingRow, BookingStatus } from "../db/types.js";
import { isAdmin } from "./auth.js";

const ACCESS_DENIED = "This command is only available to restaurant staff.";
const CALLBACK_DENIED = "Only staff can manage bookings.";
const PAGE_SIZE = 5;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: "✅ Confirmed",
  cancelled: "❌ Cancelled",
  rescheduled: "🔄 Rescheduled",
  "no-show": "🚫 No-show",
};

function formatTime(dt: Date): string {
  const hours = dt.getUTCHours().toString().padStart(2, "0");
  const minutes = dt.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatTableList(tableIds: string[]): string {
  return tableIds.length > 0 ? tableIds.join(", ") : "None assigned";
}

function formatDateLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function parseDateArg(input: string): Date | null {
  const [year, month, day] = input.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return null;
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatBookingPage(
  dateLabel: string,
  bookings: BookingRow[],
  page: number,
  totalPages: number
): {
  text: string;
  reply_markup:
    | { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
    | undefined;
} {
  const lines = [`📋 Bookings for ${dateLabel}:\n`];
  const start = page * PAGE_SIZE;
  const pageBookings = bookings.slice(start, start + PAGE_SIZE);

  for (const booking of pageBookings) {
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
    `Total: ${bookings.length} booking${
      bookings.length === 1 ? "" : "s"
    } | Page ${page + 1} of ${totalPages}`
  );

  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  const navRow: Array<{ text: string; callback_data: string }> = [];

  if (page > 0) {
    navRow.push({
      text: "◀ Previous",
      callback_data: `bkd:page:${page - 1}`,
    });
  }
  if (page < totalPages - 1) {
    navRow.push({
      text: "Next ▶",
      callback_data: `bkd:page:${page + 1}`,
    });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  return {
    text: lines.join("\n"),
    reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined,
  };
}

export function registerBookingsHandlers(bot: Bot<BotContext>): void {
  bot.command("bookings", async (ctx: BotContext) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(userId))) {
      await ctx.reply(ACCESS_DENIED);
      return;
    }

    const msgText = ctx.message?.text ?? "";
    const parts = msgText.split(/\s+/);
    const dateArg = parts[1];

    if (!dateArg || !DATE_REGEX.test(dateArg)) {
      await ctx.reply(
        "Usage: /bookings YYYY-MM-DD\nExample: /bookings 2026-06-17"
      );
      return;
    }

    const date = parseDateArg(dateArg);
    if (!date) {
      await ctx.reply(
        "Invalid date. Use YYYY-MM-DD format.\nExample: /bookings 2026-06-17"
      );
      return;
    }

    const pool = getPool();
    if (!pool) {
      await ctx.reply("Unable to load bookings. Please try again later.");
      return;
    }

    let bookings: BookingRow[];
    try {
      bookings = await getRepository(pool).bookings.listByDate(date);
    } catch {
      await ctx.reply("Unable to load bookings. Please try again later.");
      return;
    }

    ctx.session.bookingsDate = dateArg;
    ctx.session.bookingsPage = 0;

    const dateLabel = formatDateLabel(dateArg);

    if (bookings.length === 0) {
      await ctx.reply(`📋 Bookings for ${dateLabel}:\n\nNo bookings yet.`);
      return;
    }

    const totalPages = Math.ceil(bookings.length / PAGE_SIZE);
    const { text, reply_markup } = formatBookingPage(
      dateLabel,
      bookings,
      0,
      totalPages
    );
    await ctx.reply(text, { reply_markup });
  });

  bot.callbackQuery(/^bkd:page:/, async (ctx: BotContext) => {
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

    const page = Number.parseInt(data.split(":")[2] ?? "", 10);
    if (!Number.isFinite(page) || page < 0) {
      await ctx.answerCallbackQuery();
      return;
    }

    const isoDate =
      typeof ctx.session.bookingsDate === "string"
        ? ctx.session.bookingsDate
        : undefined;
    if (!isoDate) {
      await ctx.editMessageText(
        "Session expired. Send /bookings YYYY-MM-DD again."
      );
      await ctx.answerCallbackQuery();
      return;
    }

    const date = parseDateArg(isoDate);
    if (!date) {
      await ctx.answerCallbackQuery();
      return;
    }

    const pool = getPool();
    if (!pool) {
      await ctx.answerCallbackQuery({
        text: "Failed to load bookings. Try again.",
      });
      return;
    }

    let bookings: BookingRow[];
    try {
      bookings = await getRepository(pool).bookings.listByDate(date);
    } catch {
      await ctx.answerCallbackQuery({
        text: "Failed to load bookings. Try again.",
      });
      return;
    }

    const totalPages = Math.max(1, Math.ceil(bookings.length / PAGE_SIZE));
    const clampedPage = Math.min(page, totalPages - 1);
    ctx.session.bookingsPage = clampedPage;

    const dateLabel = formatDateLabel(isoDate);
    const { text, reply_markup } = formatBookingPage(
      dateLabel,
      bookings,
      clampedPage,
      totalPages
    );
    await ctx.editMessageText(text, { reply_markup });
    await ctx.answerCallbackQuery();
  });
}