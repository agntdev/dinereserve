import { getBookingPool } from "./toolkit/index.js";
import { mapBookingRow } from "./db/repository.js";
import type { BookingRow } from "./db/types.js";

export interface PendingReminder {
  bookingId: number;
  ref_code: string;
  iso_date: string;
  slot_start: string;
  slot_end: string;
  party_size: number;
}

const MINUTE_MS = 60_000;

export function buildPendingReminder(
  reminder: PendingReminder,
  offsetMinutes: number,
): boolean {
  if (offsetMinutes <= 0) return false;

  const slotTime = new Date(`${reminder.iso_date}T${reminder.slot_start}:00Z`);
  if (isNaN(slotTime.getTime())) return false;

  const now = new Date();
  if (now >= slotTime) return false;

  const threshold = new Date(slotTime.getTime() - offsetMinutes * MINUTE_MS);
  return now >= threshold;
}

export async function deliverDueRemindersForGuest(
  bot: { api: { sendMessage: (chatId: number | string, text: string) => Promise<unknown> } },
  userId: number,
  offsetMinutes: number,
): Promise<boolean> {
  const due = await listDueBookingsForUser(userId, offsetMinutes);
  if (due.length === 0) return false;

  for (const booking of due) {
    await bot.api.sendMessage(
      booking.user_id,
      `Reminder: You have a booking for ${booking.party_size} people on ${booking.iso_date} at ${booking.slot_start}–${booking.slot_end}. Ref: ${booking.ref_code}`,
    );
    await markReminderSent(booking.id);
  }

  return true;
}

export async function listDueBookingsForUser(
  userId: number,
  reminderOffsetMinutes: number,
): Promise<BookingRow[]> {
  const pool = getBookingPool();
  if (!pool) return [];

  const result = await pool.query<Record<string, unknown>>(
    `SELECT id, ref_code, user_id, guest_name, party_size, iso_date, slot_start, slot_end, status, created_at, reminder_sent_at
     FROM bookings
     WHERE status = 'confirmed'
       AND user_id = $1
       AND reminder_sent_at IS NULL
       AND (iso_date || ' ' || slot_start)::timestamp > NOW()
       AND (iso_date || ' ' || slot_start)::timestamp <= NOW() + ($2::int * INTERVAL '1 minute')`,
    [userId, reminderOffsetMinutes],
  );

  return result.rows.map(mapBookingRow);
}

export async function listDueBookings(
  reminderOffsetMinutes: number,
): Promise<BookingRow[]> {
  const pool = getBookingPool();
  if (!pool) {
    console.warn("No DATABASE_URL set — cannot query due bookings for reminders");
    return [];
  }

  const result = await pool.query<Record<string, unknown>>(
    `SELECT id, ref_code, user_id, guest_name, party_size, iso_date, slot_start, slot_end, status, created_at, reminder_sent_at
     FROM bookings
     WHERE status = 'confirmed'
       AND reminder_sent_at IS NULL
       AND (iso_date || ' ' || slot_start)::timestamp > NOW()
       AND (iso_date || ' ' || slot_start)::timestamp <= NOW() + ($1::int * INTERVAL '1 minute')`,
    [reminderOffsetMinutes],
  );

  return result.rows.map(mapBookingRow);
}

export async function markReminderSent(bookingId: number): Promise<void> {
  const pool = getBookingPool();
  if (!pool) return;

  await pool.query(
    `UPDATE bookings SET reminder_sent_at = NOW() WHERE id = $1`,
    [bookingId],
  );
}

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_REMINDER_OFFSET_MINUTES = 30;

export function startReminderPolling(
  bot: { api: { sendMessage: (chatId: number | string, text: string) => Promise<unknown> } },
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  reminderOffsetMinutes: number = DEFAULT_REMINDER_OFFSET_MINUTES,
): void {
  setInterval(async () => {
    try {
      const due = await listDueBookings(reminderOffsetMinutes);
      for (const booking of due) {
        await bot.api.sendMessage(
          booking.user_id,
          `Reminder: You have a booking for ${booking.party_size} people on ${booking.iso_date} at ${booking.slot_start}–${booking.slot_end}. Ref: ${booking.ref_code}`,
        );
        await markReminderSent(booking.id);
      }
    } catch (err) {
      console.error("Reminder polling error:", err);
    }
  }, intervalMs);
}