import { createBot, session, type BotContext } from "@agntdev/bot-toolkit";
import type { Context } from "grammy";
import pg from "pg";
import {
  calculateAvailability,
  formatAvailabilitySummary,
} from "./availability.js";
import {
  buildBookingDatetime,
  buildBookingActionKeyboard,
  buildCancelConfirmKeyboard,
  buildConfirmKeyboard,
  buildGuestSkipKeyboard,
  cancelBookingByRefCode,
  formatBookingCancelled,
  formatBookingConfirmation,
  formatBookingKept,
  formatCancelPrompt,
  formatConfirmationSummary,
  formatReschedulePrompt,
  generateRefCode,
  rescheduleBookingByRefCode,
  saveBooking,
} from "./booking.js";
import {
  buildCalendarKeyboard,
  buildPartySizeKeyboard,
  formatSelectedDate,
  parseMonthKey,
  parsePartySizeInput,
  PARTY_SIZE_PROMPT,
  startOfDay,
} from "./reserve.js";
import { registerBookingsHandlers } from "./admin/bookings.js";
import { registerBookingsTodayHandlers } from "./admin/bookings-today.js";
import { registerCapacityTodayHandlers } from "./admin/capacity-today.js";
import {
  notifyAdminsOfCancellation,
  notifyAdminsOfNewBooking,
  notifyAdminsOfReschedule,
} from "./admin/notifications.js";
import { registerSetupHandlers } from "./admin/setup.js";
import { registerConfigHandlers, handleConfigMessage } from "./admin/config.js";
import { buildSlotKeyboard, formatSlotSelection } from "./slots.js";
import { assignTables, formatTableAssignment } from "./tables.js";
import {
  buildPendingReminder,
  registerReminderHandlers,
  type PendingReminder,
} from "./reminders.js";

type ReservationStep = "guest_name" | "guest_phone" | "confirm";

interface SessionData extends Record<string, unknown> {
  startedAt?: number;
  reservationDate?: string;
  partySize?: number;
  awaitingPartySize?: boolean;
  availableSlots?: string[];
  slotPage?: number;
  selectedSlot?: string;
  guestName?: string;
  guestPhone?: string;
  assignedTableIds?: string[];
  reservationStep?: ReservationStep;
  activeRefCode?: string;
  rescheduling?: boolean;
  pendingReminder?: PendingReminder;
  bookingsDate?: string;
  bookingsPage?: number;
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
  "/setup — Initial restaurant setup\n" +
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
const GUEST_NAME_PROMPT =
  "What name should we put on the booking? (optional)";
const GUEST_PHONE_PROMPT =
  "What's your phone number? (optional)";
const BOOKING_CANCELLED_TEXT =
  "Booking cancelled. Send /reserve to start again.";

let bookingPool: pg.Pool | undefined;

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

function clearReservationProgress(session: SessionData): void {
  session.reservationDate = undefined;
  session.partySize = undefined;
  session.awaitingPartySize = false;
  session.availableSlots = undefined;
  session.slotPage = undefined;
  session.selectedSlot = undefined;
  session.guestName = undefined;
  session.guestPhone = undefined;
  session.assignedTableIds = undefined;
  session.reservationStep = undefined;
}

function getBookingPool(): pg.Pool | null {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  if (!bookingPool) {
    bookingPool = new pg.Pool({ connectionString: databaseUrl });
  }

  return bookingPool;
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
  ctx.session.guestName = undefined;
  ctx.session.guestPhone = undefined;
  ctx.session.assignedTableIds = undefined;
  ctx.session.reservationStep = undefined;

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

async function askGuestName(ctx: BotContext): Promise<void> {
  ctx.session.reservationStep = "guest_name";
  await ctx.reply(GUEST_NAME_PROMPT, {
    reply_markup: buildGuestSkipKeyboard(),
  });
}

async function askGuestPhone(ctx: BotContext): Promise<void> {
  ctx.session.reservationStep = "guest_phone";
  await ctx.reply(GUEST_PHONE_PROMPT, {
    reply_markup: buildGuestSkipKeyboard(),
  });
}

async function showConfirmationSummary(ctx: BotContext): Promise<void> {
  const reservationDate = sessionString(ctx.session.reservationDate);
  const partySize = sessionNumber(ctx.session.partySize);
  const slot = sessionString(ctx.session.selectedSlot);
  const assignedTableIds = sessionStringArray(ctx.session.assignedTableIds);

  if (!reservationDate || !partySize || !slot || !assignedTableIds) {
    await ctx.reply("Please restart your reservation with /reserve.");
    return;
  }

  const assignment = assignTables(partySize);
  const tableSummary = assignment
    ? formatTableAssignment(assignment)
    : assignedTableIds.join(", ");

  ctx.session.reservationStep = "confirm";
  await ctx.reply(
    formatConfirmationSummary({
      dateLabel: formatSelectedDate(reservationDate),
      slot,
      partySize,
      tableSummary,
      guestName: sessionString(ctx.session.guestName),
      guestPhone: sessionString(ctx.session.guestPhone),
    }),
    { reply_markup: buildConfirmKeyboard() }
  );
}

async function persistBooking(
  ctx: BotContext,
  refCode: string,
  startDt: Date,
  endDt: Date
): Promise<void> {
  const pool = getBookingPool();
  if (!pool) {
    return;
  }

  const partySize = sessionNumber(ctx.session.partySize);
  const assignedTableIds = sessionStringArray(ctx.session.assignedTableIds);
  if (!partySize || !assignedTableIds) {
    return;
  }

  try {
    await saveBooking(pool, {
      refCode,
      guestName: sessionString(ctx.session.guestName) ?? null,
      guestPhone: sessionString(ctx.session.guestPhone) ?? null,
      guestTelegramId: ctx.from?.id ?? null,
      partySize,
      startDt,
      endDt,
      assignedTableIds,
    });
  } catch (error) {
    console.error("Failed to save booking:", error);
  }
}

async function completeBooking(ctx: BotContext): Promise<void> {
  const reservationDate = sessionString(ctx.session.reservationDate);
  const partySize = sessionNumber(ctx.session.partySize);
  const slot = sessionString(ctx.session.selectedSlot);
  const assignedTableIds = sessionStringArray(ctx.session.assignedTableIds);
  const userId = ctx.from?.id;

  if (!reservationDate || !partySize || !slot || !assignedTableIds || !userId) {
    await ctx.reply("Please restart your reservation with /reserve.");
    return;
  }

  const assignment = assignTables(partySize);
  const tableSummary = assignment
    ? formatTableAssignment(assignment)
    : assignedTableIds.join(", ");
  const refCode = generateRefCode(reservationDate, slot, userId);
  const { startDt, endDt } = buildBookingDatetime(reservationDate, slot);

  const rescheduling = ctx.session.rescheduling === true;
  const previousRefCode = sessionString(ctx.session.activeRefCode);
  const wasReschedule = rescheduling && Boolean(previousRefCode);

  if (rescheduling && previousRefCode) {
    const pool = getBookingPool();
    if (pool) {
      try {
        await rescheduleBookingByRefCode(pool, previousRefCode);
      } catch (error) {
        console.error("Failed to reschedule booking:", error);
      }
    }
    ctx.session.rescheduling = false;
    ctx.session.activeRefCode = undefined;
  }

  await persistBooking(ctx, refCode, startDt, endDt);

  ctx.session.activeRefCode = refCode;

  const reminderDetails = {
    refCode,
    dateLabel: formatSelectedDate(reservationDate),
    slot,
    partySize,
    tableSummary,
    guestName: sessionString(ctx.session.guestName),
    guestPhone: sessionString(ctx.session.guestPhone),
  };

  const pendingReminder = buildPendingReminder(reminderDetails, startDt);
  if (!getBookingPool()) {
    pendingReminder.dueAtMs = Date.now();
  }
  ctx.session.pendingReminder = pendingReminder;

  await ctx.reply(
    formatBookingConfirmation(reminderDetails),
    { reply_markup: buildBookingActionKeyboard(refCode) }
  );

  if (wasReschedule && previousRefCode) {
    await notifyAdminsOfReschedule(
      ctx.api,
      previousRefCode,
      reminderDetails
    );
  } else {
    await notifyAdminsOfNewBooking(ctx.api, reminderDetails);
  }

  clearReservationProgress(ctx.session);
  ctx.session.activeRefCode = refCode;
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
    clearReservationProgress(ctx.session);
    await sendCalendar(ctx, today.getUTCFullYear(), today.getUTCMonth());
  });

  registerSetupHandlers(bot);
  registerConfigHandlers(bot);
  registerBookingsTodayHandlers(bot);
  registerBookingsHandlers(bot);
  registerCapacityTodayHandlers(bot);
  registerReminderHandlers(bot, getBookingPool);

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
      ctx.session.guestName = undefined;
      ctx.session.guestPhone = undefined;
      ctx.session.assignedTableIds = undefined;
      ctx.session.reservationStep = undefined;
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
    ctx.session.assignedTableIds = assignment.tables.map((table) => table.id);
    const tableSummary = formatTableAssignment(assignment);
    await ctx.editMessageText(
      formatSlotSelection(slot, partySize, tableSummary)
    );
    await askGuestName(ctx);
    await ctx.answerCallbackQuery({ text: "Time selected" });
  });

  bot.callbackQuery(/^guest:/, async (ctx: BotContext) => {
    const data = ctx.callbackQuery?.data;
    if (!data) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (data !== "guest:skip") {
      await ctx.answerCallbackQuery();
      return;
    }

    const step = ctx.session.reservationStep;
    if (step === "guest_name") {
      ctx.session.guestName = undefined;
      await ctx.answerCallbackQuery({ text: "Skipped" });
      await askGuestPhone(ctx);
      return;
    }

    if (step === "guest_phone") {
      ctx.session.guestPhone = undefined;
      await ctx.answerCallbackQuery({ text: "Skipped" });
      await showConfirmationSummary(ctx);
      return;
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^booking:/, async (ctx: BotContext) => {
    const data = ctx.callbackQuery?.data;
    if (!data) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("booking:cancel:yes:")) {
      const refCode = data.slice("booking:cancel:yes:".length);
      const pool = getBookingPool();
      if (pool) {
        try {
          await cancelBookingByRefCode(pool, refCode);
        } catch (error) {
          console.error("Failed to cancel booking:", error);
        }
      }

      ctx.session.activeRefCode = undefined;
      ctx.session.rescheduling = false;
      ctx.session.pendingReminder = undefined;
      await ctx.editMessageText(formatBookingCancelled(refCode));
      await notifyAdminsOfCancellation(ctx.api, refCode);
      await ctx.answerCallbackQuery({ text: "Booking cancelled" });
      return;
    }

    if (data.startsWith("booking:cancel:no:")) {
      const refCode = data.slice("booking:cancel:no:".length);
      await ctx.editMessageText(formatBookingKept(refCode), {
        reply_markup: buildBookingActionKeyboard(refCode),
      });
      await ctx.answerCallbackQuery({ text: "Booking kept" });
      return;
    }

    if (data.startsWith("booking:cancel:")) {
      const refCode = data.slice("booking:cancel:".length);
      await ctx.editMessageText(formatCancelPrompt(refCode), {
        reply_markup: buildCancelConfirmKeyboard(refCode),
      });
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("booking:reschedule:")) {
      const refCode = data.slice("booking:reschedule:".length);
      ctx.session.rescheduling = true;
      ctx.session.activeRefCode = refCode;
      clearReservationProgress(ctx.session);
      ctx.session.rescheduling = true;
      ctx.session.activeRefCode = refCode;

      await ctx.editMessageText(formatReschedulePrompt(refCode));
      const today = todayUtc();
      await ctx.reply(RESERVE_PROMPT, {
        reply_markup: buildCalendarKeyboard(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today
        ),
      });
      await ctx.answerCallbackQuery({ text: "Pick a new date" });
      return;
    }

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^confirm:/, async (ctx: BotContext) => {
    const data = ctx.callbackQuery?.data;
    if (!data) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (ctx.session.reservationStep !== "confirm") {
      await ctx.answerCallbackQuery();
      return;
    }

    if (data === "confirm:yes") {
      await completeBooking(ctx);
      await ctx.answerCallbackQuery({ text: "Booking confirmed" });
      return;
    }

    if (data === "confirm:no") {
      clearReservationProgress(ctx.session);
      await ctx.editMessageText(BOOKING_CANCELLED_TEXT);
      await ctx.answerCallbackQuery({ text: "Booking cancelled" });
      return;
    }

    await ctx.answerCallbackQuery();
  });

  bot.on("message", async (ctx: BotContext) => {
    const text = ctx.message?.text;
    if (!text) {
      return;
    }

    if (await handleConfigMessage(ctx)) {
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

    if (ctx.session.reservationStep === "guest_name") {
      const name = text.trim();
      if (name.length < 1) {
        await ctx.reply("Please enter a name or tap Skip.");
        return;
      }

      ctx.session.guestName = name;
      await askGuestPhone(ctx);
      return;
    }

    if (ctx.session.reservationStep === "guest_phone") {
      const phone = text.trim();
      if (phone.length < 1) {
        await ctx.reply("Please enter a phone number or tap Skip.");
        return;
      }

      ctx.session.guestPhone = phone;
      await showConfirmationSummary(ctx);
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