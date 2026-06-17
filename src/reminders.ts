import { getPool } from "./toolkit/index.js";
import { DEFAULT_RESTAURANT_CONFIG } from "./config.js";

export const DEFAULT_REMINDER_OFFSET_MINUTES = 120;
export const REMINDER_CONFIG_KEY = "reminder_offset_minutes";

export interface ReminderDetails {
  refCode: string;
  dateLabel: string;
  slot: string;
  partySize: number;
  tableSummary: string;
  guestName?: string;
}

export interface PendingReminder extends ReminderDetails {
  dueAtMs: number;
}

export interface DueBookingRow {
  id: number;
  ref_code: string;
  user_id: number;
  guest_name: string;
  party_size: number;
  iso_date: string;
  slot_start: string;
  slot_end: string;
  status: string;
  created_at: Date;
  reminder_sent_at: Date | null;
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

function computeSlotMs(isoDate: string, slotStart: string): number {
  const [h, m] = slotStart.split(":").map(Number);
  const date = new Date(isoDate + "T00:00:00Z");
  date.setUTCHours(h, m, 0, 0);
  return date.getTime();
}

export function buildPendingReminder(
  input: ReminderDetails,
  isoDate: string,
  slotStart: string,
  offsetMinutes: number = DEFAULT_REMINDER_OFFSET_MINUTES,
): PendingReminder {
  const slotMs = computeSlotMs(isoDate, slotStart);
  return {
    ...input,
    dueAtMs: slotMs - offsetMinutes * 60_000,
  };
}

export async function getReminderOffsetMinutes(): Promise<number> {
  const pool = getPool();
  if (!pool) {
    return DEFAULT_REMINDER_OFFSET_MINUTES;
  }

  try {
    const result = await pool.query<{ value: unknown }>(
      `SELECT value
       FROM configs
       WHERE key = $1
       ORDER BY effective_from DESC
       LIMIT 1`,
      [REMINDER_CONFIG_KEY],
    );

    if (result.rowCount === 0) {
      return DEFAULT_REMINDER_OFFSET_MINUTES;
    }

    const row = result.rows[0];
    if (!row) {
      return DEFAULT_REMINDER_OFFSET_MINUTES;
    }

    const value = row.value;
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
  } catch {
    return DEFAULT_REMINDER_OFFSET_MINUTES;
  }
}

export async function listDueBookings(
  offsetMinutes: number,
  guestTelegramId?: number,
): Promise<DueBookingRow[]> {
  const pool = getPool();
  if (!pool) {
    return [];
  }

  const values: unknown[] = [offsetMinutes];
  let guestFilter = "";

  if (guestTelegramId !== undefined) {
    values.push(guestTelegramId);
    guestFilter = "AND user_id = $2";
  }

  const result = await pool.query<Record<string, unknown>>(
    `SELECT id, ref_code, user_id, guest_name, party_size, iso_date, slot_start, slot_end, status, created_at, reminder_sent_at
     FROM bookings
     WHERE status = 'confirmed'
       AND reminder_sent_at IS NULL
       AND (iso_date || 'T' || slot_start || ':00Z')::timestamptz <= NOW() + ($1::int * INTERVAL '1 minute')
       AND (iso_date || 'T' || slot_start || ':00Z')::timestamptz > NOW()
       ${guestFilter}
     ORDER BY iso_date ASC, slot_start ASC`,
    values,
  );

  return result.rows.map((row) => ({
    id: row.id as number,
    ref_code: row.ref_code as string,
    user_id: row.user_id as number,
    guest_name: row.guest_name as string,
    party_size: row.party_size as number,
    iso_date: row.iso_date as string,
    slot_start: row.slot_start as string,
    slot_end: row.slot_end as string,
    status: row.status as string,
    created_at: row.created_at as Date,
    reminder_sent_at: row.reminder_sent_at as Date | null,
  }));
}

export async function deliverPendingSessionReminder(
  pending: PendingReminder | undefined,
  reply: (text: string) => Promise<unknown>,
): Promise<number> {
  if (!pending || pending.dueAtMs > Date.now()) {
    return 0;
  }
  await reply(formatReminderMessage(pending));
  await markReminderSent(pending.refCode);
  return 1;
}

export async function markReminderSent(refCode: string): Promise<void> {
  const pool = getPool();
  if (!pool) {
    return;
  }

  await pool.query(
    `UPDATE bookings
     SET reminder_sent_at = NOW()
     WHERE ref_code = $1
       AND reminder_sent_at IS NULL`,
    [refCode],
  );
}

function formatTableSummary(): string {
  const tables = DEFAULT_RESTAURANT_CONFIG.tables;
  const totalSeats = tables.reduce((sum, t) => sum + t.capacity, 0);
  return `${tables.length} tables (${totalSeats} seats)`;
}

export function reminderDetailsFromRow(row: DueBookingRow): ReminderDetails {
  return {
    refCode: row.ref_code,
    dateLabel: row.iso_date,
    slot: `${row.slot_start}–${row.slot_end}`,
    partySize: row.party_size,
    tableSummary: formatTableSummary(),
    guestName: row.guest_name,
  };
}