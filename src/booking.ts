import { createHash } from "node:crypto";
import type pg from "pg";
import {
  DEFAULT_RESTAURANT_CONFIG,
  type RestaurantConfig,
} from "./config.js";

const REF_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export interface BookingDatetimeRange {
  startDt: Date;
  endDt: Date;
}

export interface SaveBookingInput {
  refCode: string;
  guestName: string | null;
  guestPhone: string | null;
  guestTelegramId: number | null;
  partySize: number;
  startDt: Date;
  endDt: Date;
  assignedTableIds: string[];
}

export function generateRefCode(
  isoDate: string,
  slot: string,
  userId: number
): string {
  const hash = createHash("sha256")
    .update(`${isoDate}:${slot}:${userId}`)
    .digest();

  let code = "";
  for (let index = 0; index < 6; index++) {
    code += REF_ALPHABET[hash[index] % REF_ALPHABET.length];
  }

  return code;
}

export function buildBookingDatetime(
  isoDate: string,
  slot: string,
  config: RestaurantConfig = DEFAULT_RESTAURANT_CONFIG
): BookingDatetimeRange {
  const [year, month, day] = isoDate.split("-").map(Number);
  const [hours, minutes] = slot.split(":").map(Number);
  const startDt = new Date(Date.UTC(year, month - 1, day, hours, minutes));
  const endDt = new Date(
    startDt.getTime() + config.sittingLengthMinutes * 60 * 1000
  );

  return { startDt, endDt };
}

export async function saveBooking(
  pool: pg.Pool,
  booking: SaveBookingInput
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO bookings (
      ref_code,
      guest_name,
      guest_phone,
      guest_telegram_id,
      party_size,
      start_dt,
      end_dt,
      status,
      assigned_tables
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8::jsonb)
    RETURNING id`,
    [
      booking.refCode,
      booking.guestName,
      booking.guestPhone,
      booking.guestTelegramId,
      booking.partySize,
      booking.startDt,
      booking.endDt,
      JSON.stringify(booking.assignedTableIds),
    ]
  );

  return result.rows[0].id;
}

export function formatGuestDetail(value: string | undefined): string {
  return value && value.trim().length > 0 ? value.trim() : "Not provided";
}

export function formatConfirmationSummary(input: {
  dateLabel: string;
  slot: string;
  partySize: number;
  tableSummary: string;
  guestName?: string;
  guestPhone?: string;
}): string {
  return [
    "Please confirm your reservation:",
    "",
    `Date: ${input.dateLabel}`,
    `Time: ${input.slot}`,
    `Guests: ${input.partySize}`,
    `Tables: ${input.tableSummary}`,
    `Name: ${formatGuestDetail(input.guestName)}`,
    `Phone: ${formatGuestDetail(input.guestPhone)}`,
  ].join("\n");
}

export function formatBookingConfirmation(input: {
  refCode: string;
  dateLabel: string;
  slot: string;
  partySize: number;
  tableSummary: string;
  guestName?: string;
  guestPhone?: string;
}): string {
  return [
    "Booking confirmed!",
    "",
    `Reference: ${input.refCode}`,
    "",
    `${input.dateLabel} at ${input.slot}`,
    `${input.partySize} guests — ${input.tableSummary}`,
    `Name: ${formatGuestDetail(input.guestName)}`,
    `Phone: ${formatGuestDetail(input.guestPhone)}`,
  ].join("\n");
}

export function buildConfirmKeyboard(): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  return {
    inline_keyboard: [
      [
        { text: "Confirm", callback_data: "confirm:yes" },
        { text: "Cancel", callback_data: "confirm:no" },
      ],
    ],
  };
}

export function buildGuestSkipKeyboard(): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  return {
    inline_keyboard: [[{ text: "Skip", callback_data: "guest:skip" }]],
  };
}