export type BookingStatus =
  | "confirmed"
  | "cancelled"
  | "rescheduled"
  | "no-show";

export interface ConfigRow {
  key: string;
  value: Record<string, unknown>;
  effective_from: Date;
}

export interface RestaurantTableRow {
  id: string;
  seats: number;
  label: string | null;
}

export interface BookingRow {
  id: string;
  ref_code: string;
  guest_name: string | null;
  guest_phone: string | null;
  guest_telegram_id: number | null;
  party_size: number;
  start_dt: Date;
  end_dt: Date;
  status: BookingStatus;
  assigned_tables: string[];
  reminder_sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AdminRow {
  telegram_user_id: number;
  name: string;
}

export interface AuditLogRow {
  id: number;
  action: string;
  actor: number | null;
  booking_id: string | null;
  details: Record<string, unknown> | null;
  ts: Date;
}