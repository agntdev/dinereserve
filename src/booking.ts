import crypto from "node:crypto";
import { saveBooking } from "./db/repository.js";

export function generateRefCode(userId: number, isoDate: string, slotStart: string): string {
  const randomPart = crypto.randomBytes(3).toString("hex");
  const hash = crypto
    .createHash("sha256")
    .update(`${isoDate}:${slotStart}:${userId}:${randomPart}`)
    .digest("hex");
  return hash.substring(0, 6).toUpperCase();
}

const MAX_REFCODE_ATTEMPTS = 8;

export async function persistBooking(booking: {
  user_id: number;
  guest_name: string;
  party_size: number;
  iso_date: string;
  slot_start: string;
  slot_end: string;
  status: string;
}): Promise<{ success: true; ref_code: string } | { success: false; error: string }> {
  for (let attempt = 0; attempt < MAX_REFCODE_ATTEMPTS; attempt++) {
    const refCode = generateRefCode(booking.user_id, booking.iso_date, booking.slot_start);
    try {
      const result = await saveBooking({ ...booking, ref_code: refCode });
      return { success: true, ref_code: result.ref_code };
    } catch (err: any) {
      if (err.code === "23505") {
        continue;
      }
      return { success: false, error: err.message ?? "Unknown database error" };
    }
  }

  return { success: false, error: "Could not generate a unique booking reference after multiple attempts" };
}