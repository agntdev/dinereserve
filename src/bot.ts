import { createBot, getPersistentStore, type PersistentStore } from "./toolkit/index.js";
import { randomInt } from "node:crypto";

export interface Session {
  step?: "awaiting_date" | "awaiting_party_size";
  bookingDate?: string;
  bookingPartySize?: number;
  [key: string]: unknown;
}

interface BookingRecord {
  refCode: string;
  name: string;
  date: string;
  partySize: number;
  status: "confirmed" | "cancelled" | "rescheduled";
}

function generateRefCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[randomInt(0, chars.length)];
  }
  return code;
}

function getBookingPool(): PersistentStore | null {
  return getPersistentStore();
}

async function saveBooking(
  store: PersistentStore,
  record: BookingRecord,
): Promise<void> {
  await store.set<BookingRecord>(`booking:${record.refCode}`, record);
}

function persistBooking(
  store: PersistentStore | null,
  record: BookingRecord,
): { success: true } | { success: false; error: string } {
  if (!store) {
    return {
      success: false,
      error:
        "Database is not configured. Please set DATABASE_URL and restart the bot.",
    };
  }
  return { success: true };
}

async function flushBooking(
  store: PersistentStore,
  record: BookingRecord,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await saveBooking(store, record);
    return { success: true };
  } catch (err) {
    console.error("Failed to persist booking:", err);
    return {
      success: false,
      error: "Failed to save your booking. Please try again.",
    };
  }
}

async function cancelBookingByRefCode(
  store: PersistentStore | null,
  refCode: string,
): Promise<{ success: true } | { success: false; error: string }> {
  if (!store) {
    return {
      success: false,
      error:
        "Database is not configured. Please set DATABASE_URL and restart the bot.",
    };
  }
  const record = await store.get<BookingRecord>(`booking:${refCode}`);
  if (!record) {
    return {
      success: false,
      error: `No booking found with reference code ${refCode}.`,
    };
  }
  if (record.status !== "confirmed") {
    return {
      success: false,
      error: `Booking ${refCode} is already ${record.status}.`,
    };
  }
  try {
    record.status = "cancelled";
    await saveBooking(store, record);
    return { success: true };
  } catch (err) {
    console.error("Failed to cancel booking:", err);
    return {
      success: false,
      error: "Failed to cancel your booking. Please try again.",
    };
  }
}

async function rescheduleBookingByRefCode(
  store: PersistentStore | null,
  refCode: string,
  newDate: string,
): Promise<{ success: true } | { success: false; error: string }> {
  if (!store) {
    return {
      success: false,
      error:
        "Database is not configured. Please set DATABASE_URL and restart the bot.",
    };
  }
  const record = await store.get<BookingRecord>(`booking:${refCode}`);
  if (!record) {
    return {
      success: false,
      error: `No booking found with reference code ${refCode}.`,
    };
  }
  if (record.status !== "confirmed") {
    return {
      success: false,
      error: `Cannot reschedule a ${record.status} booking.`,
    };
  }
  try {
    record.date = newDate;
    record.status = "rescheduled";
    await saveBooking(store, record);
    return { success: true };
  } catch (err) {
    console.error("Failed to reschedule booking:", err);
    return {
      success: false,
      error: "Failed to reschedule your booking. Please try again.",
    };
  }
}

export function buildBot(token: string) {
  const bot = createBot<Session>(token, {
    initial: () => ({}),
  });

  bot.command("start", async (ctx) => {
    await ctx.reply("Welcome! I am ready to help.");
  });

  bot.command("book", async (ctx) => {
    const name = ctx.from?.first_name ?? "Guest";
    const store = getBookingPool();

    // Step 1: validate storage is available
    if (!store) {
      await ctx.reply(
        "Sorry, bookings are not available right now. The database is not configured.",
      );
      return;
    }

    const args = ctx.match.trim();
    const parts = args.split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply(
        "Usage: /book <date> <party_size>\nExample: /book 2025-12-25 4",
      );
      return;
    }

    const date = parts[0];
    const partySize = parseInt(parts[1], 10);

    if (isNaN(partySize) || partySize < 1) {
      await ctx.reply("Please provide a valid party size (number of guests).");
      return;
    }

    const refCode = generateRefCode();
    const record: BookingRecord = {
      refCode,
      name,
      date,
      partySize,
      status: "confirmed",
    };

    const persistResult = persistBooking(store, record);
    if (!persistResult.success) {
      await ctx.reply(
        `Cannot complete booking: ${persistResult.error}`,
      );
      return;
    }

    const result = await flushBooking(store, record);
    if (!result.success) {
      await ctx.reply(`Booking failed: ${result.error}`);
      return;
    }

    await ctx.reply(
      `Booking confirmed!\nReference: ${refCode}\nDate: ${date}\nParty of: ${partySize}\nName: ${name}`,
    );
  });

  bot.command("cancel", async (ctx) => {
    const store = getBookingPool();
    if (!store) {
      await ctx.reply(
        "Sorry, cancellations are not available right now. The database is not configured.",
      );
      return;
    }

    const refCode = ctx.match.trim().toUpperCase();
    if (!refCode) {
      await ctx.reply("Usage: /cancel <ref_code>\nExample: /cancel ABC123");
      return;
    }

    const result = await cancelBookingByRefCode(store, refCode);
    if (!result.success) {
      await ctx.reply(result.error);
      return;
    }

    await ctx.reply(`Booking ${refCode} has been cancelled.`);
  });

  bot.command("reschedule", async (ctx) => {
    const store = getBookingPool();
    if (!store) {
      await ctx.reply(
        "Sorry, rescheduling is not available right now. The database is not configured.",
      );
      return;
    }

    const args = ctx.match.trim();
    const parts = args.split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply(
        "Usage: /reschedule <ref_code> <new_date>\nExample: /reschedule ABC123 2025-12-26",
      );
      return;
    }

    const refCode = parts[0].toUpperCase();
    const newDate = parts[1];

    const result = await rescheduleBookingByRefCode(store, refCode, newDate);
    if (!result.success) {
      await ctx.reply(result.error);
      return;
    }

    await ctx.reply(
      `Booking ${refCode} has been rescheduled to ${newDate}.`,
    );
  });

  return bot;
}
