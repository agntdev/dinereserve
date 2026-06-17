import { InputFile } from "grammy";
import type { Bot } from "grammy";
import type { BotContext } from "@agntdev/bot-toolkit";
import { getRepository } from "../db/index.js";
import { getPool } from "../db/pool.js";
import type { BookingRow } from "../db/types.js";
import { addDays, formatIsoDate, startOfDay } from "../reserve.js";
import { isAdmin } from "./auth.js";

const ACCESS_DENIED = "This command is only available to restaurant staff.";
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDateArg(input: string): Date | null {
  if (!DATE_REGEX.test(input)) {
    return null;
  }

  const [year, month, day] = input.split("-").map(Number);
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

function parseExportRange(
  arg: string | undefined
): { start: Date; end: Date } | null {
  if (!arg) {
    return null;
  }

  if (arg.includes("..")) {
    const [startRaw, endRaw] = arg.split("..", 2);
    const start = parseIsoDateArg(startRaw ?? "");
    const end = parseIsoDateArg(endRaw ?? "");
    if (!start || !end || start > end) {
      return null;
    }
    return { start, end };
  }

  const date = parseIsoDateArg(arg);
  if (!date) {
    return null;
  }

  return { start: date, end: date };
}

function datesInRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  let current = startOfDay(start);
  const last = startOfDay(end);

  while (current <= last) {
    dates.push(current);
    current = addDays(current, 1);
  }

  return dates;
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function formatBookingRow(booking: BookingRow): string {
  const start = booking.start_dt.toISOString();
  const end = booking.end_dt.toISOString();
  const tables = booking.assigned_tables.join(";");

  return [
    booking.ref_code,
    booking.guest_name ?? "",
    booking.guest_phone ?? "",
    String(booking.party_size),
    start,
    end,
    booking.status,
    tables,
  ]
    .map((value) => csvEscape(value))
    .join(",");
}

export function buildBookingsCsv(bookings: BookingRow[]): string {
  const header =
    "ref_code,guest_name,guest_phone,party_size,start_dt,end_dt,status,assigned_tables";
  const rows = bookings.map(formatBookingRow);
  return [header, ...rows].join("\n");
}

async function listBookingsInRange(
  start: Date,
  end: Date
): Promise<BookingRow[]> {
  const pool = getPool();
  if (!pool) {
    return [];
  }

  const repo = getRepository(pool);
  const allBookings: BookingRow[] = [];

  for (const date of datesInRange(start, end)) {
    const dayBookings = await repo.bookings.listByDate(date);
    allBookings.push(...dayBookings);
  }

  allBookings.sort(
    (left, right) => left.start_dt.getTime() - right.start_dt.getTime()
  );

  return allBookings;
}

export function registerExportHandlers(bot: Bot<BotContext>): void {
  bot.command("export", async (ctx: BotContext) => {
    const userId = ctx.from?.id;
    if (!userId || !(await isAdmin(userId))) {
      await ctx.reply(ACCESS_DENIED);
      return;
    }

    const parts = (ctx.message?.text ?? "").split(/\s+/);
    const rangeArg = parts[1];
    const range = parseExportRange(rangeArg);

    if (!range) {
      await ctx.reply(
        "Usage: /export YYYY-MM-DD\n" +
          "   or: /export YYYY-MM-DD..YYYY-MM-DD\n" +
          "Example: /export 2026-06-17\n" +
          "Example: /export 2026-06-01..2026-06-30"
      );
      return;
    }

    const pool = getPool();
    if (!pool) {
      await ctx.reply("Unable to export bookings. Please try again later.");
      return;
    }

    let bookings: BookingRow[];
    try {
      bookings = await listBookingsInRange(range.start, range.end);
    } catch {
      await ctx.reply("Unable to export bookings. Please try again later.");
      return;
    }

    const startLabel = formatIsoDate(range.start);
    const endLabel = formatIsoDate(range.end);
    const filename =
      startLabel === endLabel
        ? `bookings-${startLabel}.csv`
        : `bookings-${startLabel}_${endLabel}.csv`;
    const csv = buildBookingsCsv(bookings);

    await ctx.replyWithDocument(new InputFile(Buffer.from(csv, "utf-8"), filename), {
      caption:
        bookings.length === 0
          ? `No bookings found for ${startLabel}${startLabel === endLabel ? "" : ` to ${endLabel}`}.`
          : `Exported ${bookings.length} booking${bookings.length === 1 ? "" : "s"} (${startLabel}${startLabel === endLabel ? "" : ` to ${endLabel}`}).`,
    });
  });
}