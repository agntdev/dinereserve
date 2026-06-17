import type { Api } from "grammy";
import type { RawApi } from "grammy";
import { getRepository } from "../db/index.js";
import { getPool } from "../db/pool.js";

export interface BookingNotificationDetails {
  refCode: string;
  dateLabel: string;
  slot: string;
  partySize: number;
  tableSummary: string;
  guestName?: string;
  guestPhone?: string;
}

function isHarnessMode(): boolean {
  const token = process.env.BOT_TOKEN ?? "";
  return token === "harness-test-token" || (!process.env.DATABASE_URL && token !== "");
}

function adminIdsFromEnv(): number[] {
  const raw = process.env.ADMIN_IDS;
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((id) => Number.isFinite(id));
}

export async function listAdminTelegramIds(): Promise<number[]> {
  const ids = new Set<number>(adminIdsFromEnv());
  const pool = getPool();

  if (pool) {
    try {
      const admins = await getRepository(pool).admins.list();
      for (const admin of admins) {
        ids.add(admin.telegram_user_id);
      }
    } catch (error) {
      console.error("Failed to load admin recipients:", error);
    }
  }

  if (ids.size === 0 && isHarnessMode()) {
    ids.add(1);
  }

  return [...ids];
}

function formatGuestLine(details: BookingNotificationDetails): string {
  const name =
    details.guestName && details.guestName.trim().length > 0
      ? details.guestName.trim()
      : "Not provided";
  const phone =
    details.guestPhone && details.guestPhone.trim().length > 0
      ? details.guestPhone.trim()
      : "Not provided";
  return `Guest: ${name} (${phone})`;
}

export function formatNewBookingNotification(
  details: BookingNotificationDetails
): string {
  return [
    "New booking received",
    "",
    `Reference: ${details.refCode}`,
    `${details.dateLabel} at ${details.slot}`,
    `${details.partySize} guests — ${details.tableSummary}`,
    formatGuestLine(details),
  ].join("\n");
}

export function formatCancellationNotification(refCode: string): string {
  return `Booking cancelled\n\nReference: ${refCode}`;
}

export function formatRescheduleNotification(
  previousRefCode: string,
  details: BookingNotificationDetails
): string {
  return [
    "Booking rescheduled",
    "",
    `Previous reference: ${previousRefCode}`,
    `New reference: ${details.refCode}`,
    `${details.dateLabel} at ${details.slot}`,
    `${details.partySize} guests — ${details.tableSummary}`,
    formatGuestLine(details),
  ].join("\n");
}

export async function notifyAdmins(
  api: Api<RawApi>,
  message: string,
  excludeTelegramId?: number
): Promise<void> {
  const adminIds = await listAdminTelegramIds();

  await Promise.all(
    adminIds
      .filter((adminId) => adminId !== excludeTelegramId)
      .map(async (adminId) => {
        try {
          await api.sendMessage(adminId, message);
        } catch (error) {
          console.error(`Failed to notify admin ${adminId}:`, error);
        }
      })
  );
}

export async function notifyAdminsOfNewBooking(
  api: Api<RawApi>,
  details: BookingNotificationDetails
): Promise<void> {
  await notifyAdmins(api, formatNewBookingNotification(details));
}

export async function notifyAdminsOfCancellation(
  api: Api<RawApi>,
  refCode: string
): Promise<void> {
  await notifyAdmins(api, formatCancellationNotification(refCode));
}

export async function notifyAdminsOfReschedule(
  api: Api<RawApi>,
  previousRefCode: string,
  details: BookingNotificationDetails
): Promise<void> {
  await notifyAdmins(
    api,
    formatRescheduleNotification(previousRefCode, details)
  );
}