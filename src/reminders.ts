import type { Bot } from "grammy";
import type pg from "pg";
import { buildBookingActionKeyboard } from "./booking.js";
import type { BotContext } from "@agntdev/bot-toolkit";
import { DEFAULT_RESTAURANT_CONFIG } from "./config.js";
import { formatIsoDate, formatSelectedDate } from "./reserve.js";

export const DEFAULT_REMINDER_OFFSET_MINUTES = 120;
export const REMINDER_CONFIG_KEY = "reminder_offset_minutes";
export const REMINDER_POLL_MS = 60_000;

export interface ReminderDetails {
  refCode: string;
  dateLabel: string;
  slot: string;
  partySize: number;
  tableSummary: string;
  guestName?: string;
  guestPhone?: string;
}

export interface PendingReminder extends ReminderDetails {
  dueAtMs: number;
}

interface DueBookingRow {
  ref_code: string;
  guest_telegram_id: number | null;
  party_size: number;
  start_dt: Date;
  guest_name: string | null;
  assigned_tables: string[];
}

export function formatReminderMessage(input: ReminderDetails): string {
  const name =
    input.guestName && input.guestName.trim().length > 0
      ? input.guestName.trim()
      : "Not provided";

  return [
    "Reminder: your reservation is coming up.",
    "",
    `Reference: ${input.refCode}`,
    "",
    `${input.dateLabel} at ${input.slot}`,
    `${input.partySize} guests — ${input.tableSummary}`,
    `Name: ${name}`,
  ].join("\n");
}

export function buildPendingReminder(
  input: ReminderDetails,
  startDt: Date,
  offsetMinutes: number = DEFAULT_REMINDER_OFFSET_MINUTES
): PendingReminder {
  return {
    ...input,
    dueAtMs: startDt.getTime() - offsetMinutes * 60_000,
  };
}

function formatSlotFromStartDt(startDt: Date): string {
  const hours = startDt.getUTCHours().toString().padStart(2, "0");
  const minutes = startDt.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatTableSummary(tableIds: string[]): string {
  const tables = DEFAULT_RESTAURANT_CONFIG.tables.filter((table) =>
    tableIds.includes(table.id)
  );

  if (tables.length === 0) {
    return tableIds.join(", ");
  }

  return tables
    .map((table) => `${table.label ?? table.id} (${table.seats} seats)`)
    .join(", ");
}

function reminderDetailsFromRow(row: DueBookingRow): ReminderDetails {
  const isoDate = formatIsoDate(row.start_dt);
  const tableIds = Array.isArray(row.assigned_tables) ? row.assigned_tables : [];

  return {
    refCode: row.ref_code,
    dateLabel: formatSelectedDate(isoDate),
    slot: formatSlotFromStartDt(row.start_dt),
    partySize: row.party_size,
    tableSummary: formatTableSummary(tableIds),
    guestName: row.guest_name ?? undefined,
  };
}

export async function getReminderOffsetMinutes(
  pool: pg.Pool
): Promise<number> {
  const result = await pool.query<{ value: unknown }>(
    `SELECT value
     FROM configs
     WHERE key = $1
     ORDER BY effective_from DESC
     LIMIT 1`,
    [REMINDER_CONFIG_KEY]
  );

  if (result.rowCount === 0) {
    return DEFAULT_REMINDER_OFFSET_MINUTES;
  }

  const value = result.rows[0]?.value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "minutes" in value &&
    typeof (value as { minutes?: unknown }).minutes === "number"
  ) {
    const minutes = (value as { minutes: number }).minutes;
    if (Number.isFinite(minutes) && minutes > 0) {
      return minutes;
    }
  }

  return DEFAULT_REMINDER_OFFSET_MINUTES;
}

async function listDueBookings(
  pool: pg.Pool,
  offsetMinutes: number,
  guestTelegramId?: number
): Promise<DueBookingRow[]> {
  const values: unknown[] = [offsetMinutes];
  let guestFilter = "";

  if (guestTelegramId !== undefined) {
    values.push(guestTelegramId);
    guestFilter = "AND guest_telegram_id = $2";
  }

  const result = await pool.query<DueBookingRow>(
    `SELECT ref_code, guest_telegram_id, party_size, start_dt, guest_name, assigned_tables
     FROM bookings
     WHERE status = 'confirmed'
       AND reminder_sent_at IS NULL
       AND guest_telegram_id IS NOT NULL
       AND start_dt <= NOW() + ($1::int * INTERVAL '1 minute')
       ${guestFilter}
     ORDER BY start_dt ASC`,
    values
  );

  return result.rows.map((row) => ({
    ...row,
    assigned_tables: Array.isArray(row.assigned_tables)
      ? row.assigned_tables
      : [],
  }));
}

export async function markReminderSent(
  pool: pg.Pool,
  refCode: string
): Promise<void> {
  await pool.query(
    `UPDATE bookings
     SET reminder_sent_at = NOW(), updated_at = NOW()
     WHERE ref_code = $1`,
    [refCode]
  );
}

async function sendReminderMessage(
  bot: Bot<BotContext>,
  guestTelegramId: number,
  details: ReminderDetails
): Promise<void> {
  await bot.api.sendMessage(guestTelegramId, formatReminderMessage(details), {
    reply_markup: buildBookingActionKeyboard(details.refCode),
  });
}

export async function deliverPendingSessionReminder(
  ctx: BotContext,
  pending: PendingReminder | undefined
): Promise<number> {
  if (!pending || pending.dueAtMs > Date.now()) {
    return 0;
  }

  await ctx.reply(formatReminderMessage(pending), {
    reply_markup: buildBookingActionKeyboard(pending.refCode),
  });
  return 1;
}

export async function deliverDueRemindersForGuest(
  bot: Bot<BotContext>,
  pool: pg.Pool,
  guestTelegramId: number
): Promise<number> {
  const offsetMinutes = await getReminderOffsetMinutes(pool);
  const dueBookings = await listDueBookings(pool, offsetMinutes, guestTelegramId);
  let delivered = 0;

  for (const booking of dueBookings) {
    if (!booking.guest_telegram_id) {
      continue;
    }

    const details = reminderDetailsFromRow(booking);
    await sendReminderMessage(bot, booking.guest_telegram_id, details);
    await markReminderSent(pool, booking.ref_code);
    delivered += 1;
  }

  return delivered;
}

export async function processDueReminders(
  bot: Bot<BotContext>,
  pool: pg.Pool
): Promise<number> {
  const offsetMinutes = await getReminderOffsetMinutes(pool);
  const dueBookings = await listDueBookings(pool, offsetMinutes);
  let delivered = 0;

  for (const booking of dueBookings) {
    if (!booking.guest_telegram_id) {
      continue;
    }

    const details = reminderDetailsFromRow(booking);
    await sendReminderMessage(bot, booking.guest_telegram_id, details);
    await markReminderSent(pool, booking.ref_code);
    delivered += 1;
  }

  return delivered;
}

export function startReminderWorker(
  bot: Bot<BotContext>,
  pool: pg.Pool | null
): NodeJS.Timeout | undefined {
  if (!pool) {
    return undefined;
  }

  return setInterval(() => {
    void processDueReminders(bot, pool).catch((error) => {
      console.error("Reminder worker failed:", error);
    });
  }, REMINDER_POLL_MS);
}

export function registerReminderHandlers(
  bot: Bot<BotContext>,
  getPool: () => pg.Pool | null
): void {
  bot.command("reminders", async (ctx: BotContext) => {
    const guestId = ctx.from?.id;
    if (!guestId) {
      await ctx.reply("Unable to identify your Telegram account.");
      return;
    }

    let delivered = 0;
    const pending = ctx.session.pendingReminder as PendingReminder | undefined;

    delivered += await deliverPendingSessionReminder(ctx, pending);
    if (delivered > 0) {
      ctx.session.pendingReminder = undefined;
    }

    const pool = getPool();
    if (pool) {
      delivered += await deliverDueRemindersForGuest(bot, pool, guestId);
    }

    if (delivered === 0) {
      await ctx.reply("No reminders are due for your bookings right now.");
      return;
    }

    await ctx.reply(
      `Delivered ${delivered} reservation reminder${delivered === 1 ? "" : "s"}.`
    );
  });
}