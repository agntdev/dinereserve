import type { Bot } from "grammy";
import type { BotContext } from "@agntdev/bot-toolkit";
import { canAccessSetup } from "./auth.js";
import { getPool } from "../db/pool.js";

export interface SetupSession {
  setupStep?:
    | "register"
    | "timezone"
    | "opening"
    | "closing"
    | "tables"
    | "seats"
    | "confirm";
  setupAdminId?: number;
  setupAdminName?: string;
  setupTimezone?: string;
  setupOpeningHour?: number;
  setupOpeningMinute?: number;
  setupClosingHour?: number;
  setupClosingMinute?: number;
  setupTableCount?: number;
  setupSeatsPerTable?: number;
}

const SETUP_DENIED =
  "Only registered admins can run /setup. Ask an existing admin to add you.";

const TIMEZONE_OPTIONS = [
  { label: "UTC", value: "UTC" },
  { label: "America/New_York", value: "America/New_York" },
  { label: "Europe/London", value: "Europe/London" },
  { label: "Europe/Paris", value: "Europe/Paris" },
  { label: "Asia/Tokyo", value: "Asia/Tokyo" },
] as const;

const OPENING_TIMES = [
  { label: "09:00", hour: 9, minute: 0 },
  { label: "10:00", hour: 10, minute: 0 },
  { label: "11:00", hour: 11, minute: 0 },
  { label: "12:00", hour: 12, minute: 0 },
] as const;

const CLOSING_TIMES = [
  { label: "20:00", hour: 20, minute: 0 },
  { label: "21:00", hour: 21, minute: 0 },
  { label: "22:00", hour: 22, minute: 0 },
  { label: "23:00", hour: 23, minute: 0 },
] as const;

const TABLE_COUNTS = [2, 3, 4, 5, 6] as const;
const SEATS_PER_TABLE = [2, 4, 6, 8] as const;

function setupSession(ctx: BotContext): SetupSession {
  return ctx.session as SetupSession;
}

function resetSetupSession(ctx: BotContext): void {
  const session = setupSession(ctx);
  session.setupStep = undefined;
  session.setupAdminId = undefined;
  session.setupAdminName = undefined;
  session.setupTimezone = undefined;
  session.setupOpeningHour = undefined;
  session.setupOpeningMinute = undefined;
  session.setupClosingHour = undefined;
  session.setupClosingMinute = undefined;
  session.setupTableCount = undefined;
  session.setupSeatsPerTable = undefined;
}

function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function adminDisplayName(ctx: BotContext): string {
  const from = ctx.from;
  if (!from) {
    return "Admin";
  }

  const parts = [from.first_name, from.last_name].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" ");
  }

  return from.username ?? "Admin";
}

function registerKeyboard(telegramUserId: number) {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Register me as admin",
          callback_data: `setup:register:${telegramUserId}`,
        },
      ],
      [{ text: "Cancel", callback_data: "setup:cancel" }],
    ],
  };
}

function timezoneKeyboard() {
  return {
    inline_keyboard: [
      ...TIMEZONE_OPTIONS.map((tz) => [
        { text: tz.label, callback_data: `setup:tz:${tz.value}` },
      ]),
      [{ text: "Cancel", callback_data: "setup:cancel" }],
    ],
  };
}

function openingKeyboard() {
  return {
    inline_keyboard: [
      OPENING_TIMES.map((time) => ({
        text: time.label,
        callback_data: `setup:open:${time.hour}:${time.minute}`,
      })),
      [{ text: "Cancel", callback_data: "setup:cancel" }],
    ],
  };
}

function closingKeyboard() {
  return {
    inline_keyboard: [
      CLOSING_TIMES.map((time) => ({
        text: time.label,
        callback_data: `setup:close:${time.hour}:${time.minute}`,
      })),
      [{ text: "Cancel", callback_data: "setup:cancel" }],
    ],
  };
}

function tableCountKeyboard() {
  return {
    inline_keyboard: [
      TABLE_COUNTS.map((count) => ({
        text: String(count),
        callback_data: `setup:tables:${count}`,
      })),
      [{ text: "Cancel", callback_data: "setup:cancel" }],
    ],
  };
}

function seatsKeyboard() {
  return {
    inline_keyboard: [
      SEATS_PER_TABLE.map((seats) => ({
        text: String(seats),
        callback_data: `setup:seats:${seats}`,
      })),
      [{ text: "Cancel", callback_data: "setup:cancel" }],
    ],
  };
}

function confirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "💾 Save setup", callback_data: "setup:save" }],
      [{ text: "Cancel", callback_data: "setup:cancel" }],
    ],
  };
}

function buildConfirmSummary(session: SetupSession): string {
  const opening = formatTime(
    session.setupOpeningHour ?? 0,
    session.setupOpeningMinute ?? 0
  );
  const closing = formatTime(
    session.setupClosingHour ?? 0,
    session.setupClosingMinute ?? 0
  );

  return (
    "Review your restaurant setup:\n\n" +
    `Admin: ${session.setupAdminName} (ID ${session.setupAdminId})\n` +
    `Timezone: ${session.setupTimezone}\n` +
    `Hours: ${opening} – ${closing}\n` +
    `Tables: ${session.setupTableCount} × ${session.setupSeatsPerTable} seats\n\n` +
    "Save these settings?"
  );
}

async function persistSetup(session: SetupSession): Promise<void> {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO admins (telegram_user_id, name)
       VALUES ($1, $2)
       ON CONFLICT (telegram_user_id) DO UPDATE
       SET name = EXCLUDED.name`,
      [session.setupAdminId, session.setupAdminName]
    );

    await client.query(
      `INSERT INTO configs (key, value)
       VALUES ($1, $2::jsonb)`,
      [
        "restaurant.defaults",
        JSON.stringify({
          timezone: session.setupTimezone,
          openingHour: session.setupOpeningHour,
          openingMinute: session.setupOpeningMinute,
          closingHour: session.setupClosingHour,
          closingMinute: session.setupClosingMinute,
          sittingLengthMinutes: 90,
          slotGranularityMinutes: 15,
          allowTableSplitting: true,
        }),
      ]
    );

    const tableCount = session.setupTableCount ?? 0;
    for (let i = 1; i <= tableCount; i++) {
      await client.query(
        `INSERT INTO restaurant_tables (id, seats, label)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE
         SET seats = EXCLUDED.seats, label = EXCLUDED.label`,
        [`t${i}`, session.setupSeatsPerTable, `Table ${i}`]
      );
    }

    if (tableCount > 0) {
      await client.query(
        `DELETE FROM restaurant_tables
         WHERE id !~ '^t[0-9]+$'
            OR CAST(SUBSTRING(id FROM 2) AS INTEGER) > $1`,
        [tableCount]
      );
    } else {
      await client.query(`DELETE FROM restaurant_tables`);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function startSetup(ctx: BotContext): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await ctx.reply("Could not identify your Telegram account. Please try again.");
    return;
  }

  const allowed = await canAccessSetup(telegramUserId);
  if (!allowed) {
    await ctx.reply(SETUP_DENIED);
    return;
  }

  resetSetupSession(ctx);
  setupSession(ctx).setupStep = "register";

  await ctx.reply(
    "Welcome to DineReserve setup! Let's configure your restaurant.\n\n" +
      "First, register yourself as the restaurant admin:",
    { reply_markup: registerKeyboard(telegramUserId) }
  );
}

export function registerSetupHandlers(bot: Bot<BotContext>): void {
  bot.command("setup", async (ctx) => {
    await startSetup(ctx);
  });

  bot.callbackQuery(/^setup:/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data) {
      await ctx.answerCallbackQuery();
      return;
    }

    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) {
      await ctx.answerCallbackQuery({ text: "Unknown user" });
      return;
    }

    const allowed = await canAccessSetup(telegramUserId);
    if (!allowed) {
      await ctx.editMessageText(SETUP_DENIED);
      await ctx.answerCallbackQuery();
      return;
    }

    const session = setupSession(ctx);

    if (data === "setup:cancel") {
      resetSetupSession(ctx);
      await ctx.editMessageText("Setup cancelled. Send /setup to start again.");
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("setup:register:")) {
      const adminId = Number.parseInt(data.split(":")[2] ?? "", 10);
      if (!Number.isFinite(adminId) || adminId !== telegramUserId) {
        await ctx.answerCallbackQuery({ text: "Invalid admin selection." });
        return;
      }

      session.setupAdminId = adminId;
      session.setupAdminName = adminDisplayName(ctx);
      session.setupStep = "timezone";

      await ctx.editMessageText("Select your restaurant timezone:", {
        reply_markup: timezoneKeyboard(),
      });
      await ctx.answerCallbackQuery({ text: "Admin registered" });
      return;
    }

    if (data.startsWith("setup:tz:")) {
      const timezone = data.slice("setup:tz:".length);
      if (!TIMEZONE_OPTIONS.some((option) => option.value === timezone)) {
        await ctx.answerCallbackQuery({ text: "Unknown timezone" });
        return;
      }

      session.setupTimezone = timezone;
      session.setupStep = "opening";

      await ctx.editMessageText("Select opening time:", {
        reply_markup: openingKeyboard(),
      });
      await ctx.answerCallbackQuery({ text: "Timezone saved" });
      return;
    }

    if (data.startsWith("setup:open:")) {
      const [, , hourValue, minuteValue] = data.split(":");
      const hour = Number.parseInt(hourValue ?? "", 10);
      const minute = Number.parseInt(minuteValue ?? "", 10);

      if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
        await ctx.answerCallbackQuery({ text: "Invalid opening time" });
        return;
      }

      session.setupOpeningHour = hour;
      session.setupOpeningMinute = minute;
      session.setupStep = "closing";

      await ctx.editMessageText("Select closing time:", {
        reply_markup: closingKeyboard(),
      });
      await ctx.answerCallbackQuery({ text: "Opening time saved" });
      return;
    }

    if (data.startsWith("setup:close:")) {
      const [, , hourValue, minuteValue] = data.split(":");
      const hour = Number.parseInt(hourValue ?? "", 10);
      const minute = Number.parseInt(minuteValue ?? "", 10);

      if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
        await ctx.answerCallbackQuery({ text: "Invalid closing time" });
        return;
      }

      const openingMinutes =
        (session.setupOpeningHour ?? 0) * 60 + (session.setupOpeningMinute ?? 0);
      const closingMinutes = hour * 60 + minute;
      if (closingMinutes <= openingMinutes) {
        await ctx.answerCallbackQuery({
          text: "Closing time must be after opening time.",
        });
        return;
      }

      session.setupClosingHour = hour;
      session.setupClosingMinute = minute;
      session.setupStep = "tables";

      await ctx.editMessageText("How many tables does the restaurant have?", {
        reply_markup: tableCountKeyboard(),
      });
      await ctx.answerCallbackQuery({ text: "Closing time saved" });
      return;
    }

    if (data.startsWith("setup:tables:")) {
      const count = Number.parseInt(data.split(":")[2] ?? "", 10);
      if (!Number.isFinite(count) || count < 1) {
        await ctx.answerCallbackQuery({ text: "Invalid table count" });
        return;
      }

      session.setupTableCount = count;
      session.setupStep = "seats";

      await ctx.editMessageText("How many seats per table?", {
        reply_markup: seatsKeyboard(),
      });
      await ctx.answerCallbackQuery({ text: "Table count saved" });
      return;
    }

    if (data.startsWith("setup:seats:")) {
      const seats = Number.parseInt(data.split(":")[2] ?? "", 10);
      if (!Number.isFinite(seats) || seats < 1) {
        await ctx.answerCallbackQuery({ text: "Invalid seat count" });
        return;
      }

      session.setupSeatsPerTable = seats;
      session.setupStep = "confirm";

      await ctx.editMessageText(buildConfirmSummary(session), {
        reply_markup: confirmKeyboard(),
      });
      await ctx.answerCallbackQuery({ text: "Seats saved" });
      return;
    }

    if (data === "setup:save") {
      if (
        session.setupAdminId === undefined ||
        !session.setupAdminName ||
        !session.setupTimezone ||
        session.setupOpeningHour === undefined ||
        session.setupOpeningMinute === undefined ||
        session.setupClosingHour === undefined ||
        session.setupClosingMinute === undefined ||
        session.setupTableCount === undefined ||
        session.setupSeatsPerTable === undefined
      ) {
        await ctx.answerCallbackQuery({ text: "Setup incomplete" });
        return;
      }

      try {
        await persistSetup(session);
      } catch (error) {
        console.error("Failed to save setup:", error);
        await ctx.editMessageText(
          "Could not save setup to the database. Please check DATABASE_URL and try again."
        );
        await ctx.answerCallbackQuery();
        return;
      }

      const opening = formatTime(
        session.setupOpeningHour ?? 0,
        session.setupOpeningMinute ?? 0
      );
      const closing = formatTime(
        session.setupClosingHour ?? 0,
        session.setupClosingMinute ?? 0
      );
      const savedSummary =
        "Your restaurant is configured:\n\n" +
        `Admin: ${session.setupAdminName} (ID ${session.setupAdminId})\n` +
        `Timezone: ${session.setupTimezone}\n` +
        `Hours: ${opening} – ${closing}\n` +
        `Tables: ${session.setupTableCount} × ${session.setupSeatsPerTable} seats`;
      resetSetupSession(ctx);

      await ctx.editMessageText(
        "✅ Setup complete! Your restaurant is ready.\n\n" + savedSummary
      );
      await ctx.answerCallbackQuery({ text: "Setup saved" });
      return;
    }

    await ctx.answerCallbackQuery();
  });
}

export { isAdmin, canAccessSetup, hasAnyAdmins } from "./auth.js";