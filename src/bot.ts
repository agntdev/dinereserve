import { createBot, session, type BotContext } from "@agntdev/bot-toolkit";
import type { Context } from "grammy";
import {
  calculateAvailability,
  formatAvailabilitySummary,
} from "./availability.js";
import {
  buildCalendarKeyboard,
  buildPartySizeKeyboard,
  formatSelectedDate,
  parseMonthKey,
  parsePartySizeInput,
  PARTY_SIZE_PROMPT,
  startOfDay,
} from "./reserve.js";
import { buildSlotKeyboard, formatSlotSelection } from "./slots.js";
import { assignTables, formatTableAssignment } from "./tables.js";

interface SessionData extends Record<string, unknown> {
  startedAt?: number;
  reservationDate?: string;
  partySize?: number;
  awaitingPartySize?: boolean;
  availableSlots?: string[];
  slotPage?: number;
  selectedSlot?: string;
}

const WELCOME_TEXT =
  "Welcome to DineReserve! 🍽️\n\n" +
  "I help you book tables at our restaurant. Choose an option below:";

const HELP_TEXT =
  "DineReserve commands:\n\n" +
  "/start — Open the main menu\n" +
  "/reserve — Book a table\n" +
  "/help — Show this command list\n\n" +
  "Admin commands (owners only):\n" +
  "/bookings_today — Today's bookings\n" +
  "/bookings — Bookings for a date\n" +
  "/capacity_today — Today's capacity\n" +
  "/config — Restaurant settings\n" +
  "/export — Export bookings to CSV";

const GENERIC_REPLY =
  "Welcome to DineReserve! I help you book tables at our restaurant.\n\n" +
  "Use /reserve to make a reservation.";

const UNKNOWN_COMMAND_REPLY =
  "I don't recognize that command. Send /help to see available commands.";

const ERROR_REPLY =
  "Something went wrong. Please try again or use /help.";

const RESERVE_PROMPT = "Pick a date for your reservation:";

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📅 Make a Reservation", callback_data: "menu:reserve" }],
      [{ text: "ℹ️ Help", callback_data: "menu:help" }],
    ],
  };
}

function isBotCommand(ctx: Context): boolean {
  return (
    ctx.message?.entities?.some((entity) => entity.type === "bot_command") ??
    false
  );
}

function sessionString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function sessionNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function sessionStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function todayUtc(): Date {
  return startOfDay(new Date());
}

async function sendCalendar(
  ctx: BotContext,
  year: number,
  month: number
): Promise<void> {
  await ctx.reply(RESERVE_PROMPT, {
    reply_markup: buildCalendarKeyboard(year, month, todayUtc()),
  });
}

async function showAvailabilityForParty(
  ctx: BotContext,
  partySize: number,
  editMessage: boolean
): Promise<void> {
  const reservationDate = sessionString(ctx.session.reservationDate);
  if (!reservationDate) {
    if (editMessage) {
      await ctx.editMessageText("Please pick a date first with /reserve.");
    } else {
      await ctx.reply("Please pick a date first with /reserve.");
    }
    return;
  }

  ctx.session.partySize = partySize;
  ctx.session.awaitingPartySize = false;
  ctx.session.selectedSlot = undefined;

  const dateLabel = formatSelectedDate(reservationDate);
  const result = calculateAvailability(partySize, undefined, {
    isoDate: reservationDate,
  });
  const summary = formatAvailabilitySummary(partySize, dateLabel, result);

  if (result.slotCount > 0) {
    ctx.session.availableSlots = result.slots;
    ctx.session.slotPage = 0;
    const keyboard = buildSlotKeyboard(result.slots, 0);

    if (editMessage) {
      await ctx.editMessageText(summary, { reply_markup: keyboard });
    } else {
      await ctx.reply(summary, { reply_markup: keyboard });
    }
    return;
  }

  ctx.session.availableSlots = undefined;
  ctx.session.slotPage = undefined;

  if (editMessage) {
    await ctx.editMessageText(summary);
  } else {
    await ctx.reply(summary);
  }
}

async function showSlotPage(ctx: BotContext, page: number): Promise<void> {
  const slots = sessionStringArray(ctx.session.availableSlots);
  const partySize = sessionNumber(ctx.session.partySize);
  const reservationDate = sessionString(ctx.session.reservationDate);

  if (!slots || !partySize || !reservationDate) {
    await ctx.editMessageText("Please restart your reservation with /reserve.");
    return;
  }

  ctx.session.slotPage = page;
  const dateLabel = formatSelectedDate(reservationDate);
  const result = calculateAvailability(partySize, undefined, {
    isoDate: reservationDate,
  });
  const summary = formatAvailabilitySummary(partySize, dateLabel, result);

  await ctx.editMessageText(summary, {
    reply_markup: buildSlotKeyboard(slots, page),
  });
}

export function buildBot(token: string): ReturnType<typeof createBot> {
  const bot = createBot({ token });

  bot.use(session<SessionData>());

  bot.command("start", async (ctx: BotContext) => {
    ctx.session.startedAt = Date.now();
    await ctx.reply(WELCOME_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  bot.command("help", async (ctx: BotContext) => {
    await ctx.reply(HELP_TEXT);
  });

  bot.command("reserve", async (ctx: BotContext) => {
    const today = todayUtc();
    ctx.session.reservationDate = undefined;
    ctx.session.partySize = undefined;
    ctx.session.awaitingPartySize = false;
    ctx.session.availableSlots = undefined;
    ctx.session.slotPage = undefined;
    ctx.session.selectedSlot = undefined;
    await sendCalendar(ctx, today.getUTCFullYear(), today.getUTCMonth());
  });

  bot.command("__harness_error__", async () => {
    throw new Error("Harness error simulation");
  });

  bot.callbackQuery(/^menu:/, async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data === "menu:reserve") {
      await ctx.editMessageText("Send /reserve to start booking a table.", {
        reply_markup: mainMenuKeyboard(),
      });
    } else if (data === "menu:help") {
      await ctx.editMessageText(
        "Available commands:\n" +
          "/start — Main menu\n" +
          "/reserve — Book a table\n" +
          "/help — Show this help",
        { reply_markup: mainMenuKeyboard() }
      );
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^cal:/, async (ctx: BotContext) => {
    const data = ctx.callbackQuery?.data;
    if (!data) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "cal:noop") {
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("cal:date:")) {
      const isoDate = data.slice("cal:date:".length);
      ctx.session.reservationDate = isoDate;
      ctx.session.partySize = undefined;
      ctx.session.awaitingPartySize = false;
      ctx.session.availableSlots = undefined;
      ctx.session.slotPage = undefined;
      ctx.session.selectedSlot = undefined;
      await ctx.editMessageText(
        `Date selected: ${formatSelectedDate(isoDate)}`
      );
      await ctx.answerCallbackQuery({ text: "Date saved" });
      await ctx.reply(PARTY_SIZE_PROMPT, {
        reply_markup: buildPartySizeKeyboard(),
      });
      return;
    }

    if (data.startsWith("cal:prev:") || data.startsWith("cal:next:")) {
      const monthValue = data.split(":")[2];
      const { year, month } = parseMonthKey(monthValue);
      await ctx.editMessageText(RESERVE_PROMPT, {
        reply_markup: buildCalendarKeyboard(year, month, todayUtc()),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^party:/, async (ctx: BotContext) => {
    const data = ctx.callbackQuery?.data;
    if (!data) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "party:type") {
      ctx.session.awaitingPartySize = true;
      await ctx.editMessageText("Type the number of guests (1-99):");
      await ctx.answerCallbackQuery();
      return;
    }

    const size = Number.parseInt(data.split(":")[1] ?? "", 10);
    if (!Number.isFinite(size) || size < 1) {
      await ctx.answerCallbackQuery();
      return;
    }

    await showAvailabilityForParty(ctx, size, true);
    await ctx.answerCallbackQuery({ text: "Checking availability" });
  });

  bot.callbackQuery(/^slotpage:/, async (ctx: BotContext) => {
    const data = ctx.callbackQuery?.data;
    if (!data) {
      await ctx.answerCallbackQuery();
      return;
    }

    const page = Number.parseInt(data.split(":")[1] ?? "", 10);
    if (!Number.isFinite(page) || page < 0) {
      await ctx.answerCallbackQuery();
      return;
    }

    await showSlotPage(ctx, page);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^slot:/, async (ctx: BotContext) => {
    const data = ctx.callbackQuery?.data;
    if (!data) {
      await ctx.answerCallbackQuery();
      return;
    }

    const slot = data.slice("slot:".length);
    const partySize = sessionNumber(ctx.session.partySize);
    const slots = sessionStringArray(ctx.session.availableSlots);

    if (!partySize || !slots || !slots.includes(slot)) {
      await ctx.answerCallbackQuery({ text: "That time is unavailable." });
      return;
    }

    const assignment = assignTables(partySize);
    if (!assignment) {
      await ctx.editMessageText(
        `Sorry, we cannot seat ${partySize} guests at ${slot}.`
      );
      await ctx.answerCallbackQuery();
      return;
    }

    ctx.session.selectedSlot = slot;
    const tableSummary = formatTableAssignment(assignment);
    await ctx.editMessageText(
      formatSlotSelection(slot, partySize, tableSummary)
    );
    await ctx.answerCallbackQuery({ text: "Time selected" });
  });

  bot.on("message", async (ctx: BotContext) => {
    const text = ctx.message?.text;
    if (!text) {
      return;
    }

    if (ctx.session.awaitingPartySize) {
      const size = parsePartySizeInput(text);
      if (size === null) {
        await ctx.reply("Please enter a whole number between 1 and 99.");
        return;
      }

      await showAvailabilityForParty(ctx, size, false);
      return;
    }

    if (isBotCommand(ctx)) {
      await ctx.reply(UNKNOWN_COMMAND_REPLY);
      return;
    }

    await ctx.reply(GENERIC_REPLY);
  });

  bot.catch(async (err) => {
    console.error("Bot error:", err.error);

    const ctx = err.ctx;
    try {
      await ctx.reply(ERROR_REPLY);
    } catch (replyError) {
      console.error("Failed to send error reply:", replyError);
    }
  });

  return bot;
}