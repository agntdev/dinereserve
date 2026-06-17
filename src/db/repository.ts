import { getBookingPool } from "../toolkit/index.js";
import type { BookingRow } from "./types.js";

export function mapBookingRow(row: Record<string, unknown>): BookingRow {
  return {
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
  };
}

const DEFAULT_REMINDER_OFFSET_MINUTES = 120;

export async function getReminderOffsetMinutes(): Promise<number> {
  const pool = getBookingPool();
  if (!pool) return DEFAULT_REMINDER_OFFSET_MINUTES;

  try {
    const result = await pool.query<{ value: string }>(
      `SELECT value FROM configs WHERE key = 'reminder_offset_minutes'`,
    );
    if (result.rows.length > 0) {
      const parsed = parseInt(result.rows[0].value, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // table may not exist yet — fall back to default
  }

  return DEFAULT_REMINDER_OFFSET_MINUTES;
}

export async function listOverlapping(
  isoDate: string,
  slotStart: string,
  slotEnd: string,
): Promise<BookingRow[]> {
  const pool = getBookingPool();
  if (!pool) {
    throw new Error("No DATABASE_URL set — cannot query overlapping bookings");
  }

  const result = await pool.query<Record<string, unknown>>(
    `SELECT id, ref_code, user_id, guest_name, party_size, iso_date, slot_start, slot_end, status, created_at, reminder_sent_at
     FROM bookings
     WHERE iso_date = $1
       AND status = 'confirmed'
       AND slot_start < $3
       AND slot_end > $2`,
    [isoDate, slotStart, slotEnd],
  );

  return result.rows.map(mapBookingRow);
}

export async function saveBooking(booking: {
  ref_code: string;
  user_id: number;
  guest_name: string;
  party_size: number;
  iso_date: string;
  slot_start: string;
  slot_end: string;
  status: string;
}): Promise<BookingRow> {
  const pool = getBookingPool();
  if (!pool) {
    throw new Error("No DATABASE_URL set — cannot save booking");
  }

  const result = await pool.query<Record<string, unknown>>(
    `INSERT INTO bookings (ref_code, user_id, guest_name, party_size, iso_date, slot_start, slot_end, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, ref_code, user_id, guest_name, party_size, iso_date, slot_start, slot_end, status, created_at, reminder_sent_at`,
    [booking.ref_code, booking.user_id, booking.guest_name, booking.party_size, booking.iso_date, booking.slot_start, booking.slot_end, booking.status],
  );

  return mapBookingRow(result.rows[0]);
}
