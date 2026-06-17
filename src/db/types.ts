export interface BookingRow {
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

export interface ConfigRow {
  key: string;
  value: string;
}

export interface TableRow {
  id: string;
  capacity: number;
}
