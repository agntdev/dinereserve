import { randomBytes } from "node:crypto";
import type pg from "pg";
import type {
  AdminRow,
  AuditLogRow,
  BookingRow,
  BookingStatus,
  ConfigRow,
  RestaurantTableRow,
} from "./types.js";

const REF_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_OVERLAPPING_STATUSES: BookingStatus[] = ["confirmed"];

export interface CreateBookingInput {
  guest_name?: string | null;
  guest_phone?: string | null;
  guest_telegram_id?: number | null;
  party_size: number;
  start_dt: Date;
  end_dt: Date;
  assigned_tables: string[];
  status?: BookingStatus;
  ref_code?: string;
}

export interface CreateTableInput {
  id: string;
  seats: number;
  label?: string | null;
}

export interface UpdateTableInput {
  seats?: number;
  label?: string | null;
}

export interface CreateAuditLogInput {
  action: string;
  actor?: number | null;
  booking_id?: string | null;
  details?: Record<string, unknown> | null;
}

export interface ConfigsRepository {
  getLatest(key: string): Promise<ConfigRow | null>;
  upsert(key: string, value: Record<string, unknown>): Promise<ConfigRow>;
}

export interface RestaurantTablesRepository {
  list(): Promise<RestaurantTableRow[]>;
  get(id: string): Promise<RestaurantTableRow | null>;
  create(input: CreateTableInput): Promise<RestaurantTableRow>;
  update(id: string, input: UpdateTableInput): Promise<RestaurantTableRow | null>;
  delete(id: string): Promise<boolean>;
}

export interface BookingsRepository {
  create(input: CreateBookingInput): Promise<BookingRow>;
  getById(id: string): Promise<BookingRow | null>;
  getByRefCode(refCode: string): Promise<BookingRow | null>;
  listByDate(date: Date): Promise<BookingRow[]>;
  updateStatus(id: string, status: BookingStatus): Promise<BookingRow | null>;
  listOverlapping(
    startDt: Date,
    endDt: Date,
    statuses?: BookingStatus[]
  ): Promise<BookingRow[]>;
}

export interface AdminsRepository {
  isAdmin(telegramUserId: number): Promise<boolean>;
  list(): Promise<AdminRow[]>;
  create(telegramUserId: number, name: string): Promise<AdminRow>;
  delete(telegramUserId: number): Promise<boolean>;
}

export interface AuditLogsRepository {
  create(input: CreateAuditLogInput): Promise<AuditLogRow>;
  listByBooking(bookingId: string): Promise<AuditLogRow[]>;
}

export interface Repository {
  configs: ConfigsRepository;
  restaurantTables: RestaurantTablesRepository;
  bookings: BookingsRepository;
  admins: AdminsRepository;
  auditLogs: AuditLogsRepository;
}

function parseBigInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseAssignedTables(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function mapConfigRow(row: pg.QueryResultRow): ConfigRow {
  return {
    key: String(row.key),
    value: (row.value ?? {}) as Record<string, unknown>,
    effective_from: row.effective_from as Date,
  };
}

function mapRestaurantTableRow(row: pg.QueryResultRow): RestaurantTableRow {
  return {
    id: String(row.id),
    seats: Number(row.seats),
    label: row.label === null || row.label === undefined ? null : String(row.label),
  };
}

function mapBookingRow(row: pg.QueryResultRow): BookingRow {
  return {
    id: String(row.id),
    ref_code: String(row.ref_code).trim(),
    guest_name:
      row.guest_name === null || row.guest_name === undefined
        ? null
        : String(row.guest_name),
    guest_phone:
      row.guest_phone === null || row.guest_phone === undefined
        ? null
        : String(row.guest_phone),
    guest_telegram_id: parseBigInt(row.guest_telegram_id),
    party_size: Number(row.party_size),
    start_dt: row.start_dt as Date,
    end_dt: row.end_dt as Date,
    status: row.status as BookingStatus,
    assigned_tables: parseAssignedTables(row.assigned_tables),
    reminder_sent_at:
      row.reminder_sent_at === null || row.reminder_sent_at === undefined
        ? null
        : (row.reminder_sent_at as Date),
    created_at: row.created_at as Date,
    updated_at: row.updated_at as Date,
  };
}

function mapAdminRow(row: pg.QueryResultRow): AdminRow {
  return {
    telegram_user_id: Number(parseBigInt(row.telegram_user_id)),
    name: String(row.name),
  };
}

function mapAuditLogRow(row: pg.QueryResultRow): AuditLogRow {
  return {
    id: Number(row.id),
    action: String(row.action),
    actor: parseBigInt(row.actor),
    booking_id:
      row.booking_id === null || row.booking_id === undefined
        ? null
        : String(row.booking_id),
    details:
      row.details === null || row.details === undefined
        ? null
        : (row.details as Record<string, unknown>),
    ts: row.ts as Date,
  };
}

function generateRefCode(): string {
  const bytes = randomBytes(6);
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += REF_CODE_CHARS[bytes[i]! % REF_CODE_CHARS.length];
  }

  return code;
}

function dayBoundsUtc(date: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const end = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
  );
  return { start, end };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

function createConfigsRepository(pool: pg.Pool): ConfigsRepository {
  return {
    async getLatest(key) {
      const result = await pool.query(
        `SELECT key, value, effective_from
         FROM configs
         WHERE key = $1
         ORDER BY effective_from DESC
         LIMIT 1`,
        [key]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return mapConfigRow(result.rows[0]!);
    },

    async upsert(key, value) {
      const result = await pool.query(
        `INSERT INTO configs (key, value, effective_from)
         VALUES ($1, $2::jsonb, NOW())
         RETURNING key, value, effective_from`,
        [key, JSON.stringify(value)]
      );

      return mapConfigRow(result.rows[0]!);
    },
  };
}

function createRestaurantTablesRepository(pool: pg.Pool): RestaurantTablesRepository {
  return {
    async list() {
      const result = await pool.query(
        `SELECT id, seats, label
         FROM restaurant_tables
         ORDER BY id`
      );

      return result.rows.map(mapRestaurantTableRow);
    },

    async get(id) {
      const result = await pool.query(
        `SELECT id, seats, label
         FROM restaurant_tables
         WHERE id = $1`,
        [id]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return mapRestaurantTableRow(result.rows[0]!);
    },

    async create(input) {
      const result = await pool.query(
        `INSERT INTO restaurant_tables (id, seats, label)
         VALUES ($1, $2, $3)
         RETURNING id, seats, label`,
        [input.id, input.seats, input.label ?? null]
      );

      return mapRestaurantTableRow(result.rows[0]!);
    },

    async update(id, input) {
      const fields: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (input.seats !== undefined) {
        fields.push(`seats = $${paramIndex++}`);
        values.push(input.seats);
      }

      if (input.label !== undefined) {
        fields.push(`label = $${paramIndex++}`);
        values.push(input.label);
      }

      if (fields.length === 0) {
        return this.get(id);
      }

      values.push(id);
      const result = await pool.query(
        `UPDATE restaurant_tables
         SET ${fields.join(", ")}
         WHERE id = $${paramIndex}
         RETURNING id, seats, label`,
        values
      );

      if (result.rowCount === 0) {
        return null;
      }

      return mapRestaurantTableRow(result.rows[0]!);
    },

    async delete(id) {
      const result = await pool.query(
        `DELETE FROM restaurant_tables
         WHERE id = $1`,
        [id]
      );

      return (result.rowCount ?? 0) > 0;
    },
  };
}

function createBookingsRepository(pool: pg.Pool): BookingsRepository {
  return {
    async create(input) {
      const status = input.status ?? "confirmed";
      const assignedTables = JSON.stringify(input.assigned_tables);
      const maxAttempts = 8;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const refCode = input.ref_code ?? generateRefCode();

        try {
          const result = await pool.query(
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
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
             RETURNING
               id,
               ref_code,
               guest_name,
               guest_phone,
               guest_telegram_id,
               party_size,
               start_dt,
               end_dt,
               status,
               assigned_tables,
               reminder_sent_at,
               created_at,
               updated_at`,
            [
              refCode,
              input.guest_name ?? null,
              input.guest_phone ?? null,
              input.guest_telegram_id ?? null,
              input.party_size,
              input.start_dt,
              input.end_dt,
              status,
              assignedTables,
            ]
          );

          return mapBookingRow(result.rows[0]!);
        } catch (error) {
          if (input.ref_code || !isUniqueViolation(error) || attempt === maxAttempts - 1) {
            throw error;
          }
        }
      }

      throw new Error("Failed to generate a unique booking reference code");
    },

    async getById(id) {
      const result = await pool.query(
        `SELECT
           id,
           ref_code,
           guest_name,
           guest_phone,
           guest_telegram_id,
           party_size,
           start_dt,
           end_dt,
           status,
           assigned_tables,
           reminder_sent_at,
           created_at,
           updated_at
         FROM bookings
         WHERE id = $1`,
        [id]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return mapBookingRow(result.rows[0]!);
    },

    async getByRefCode(refCode) {
      const result = await pool.query(
        `SELECT
           id,
           ref_code,
           guest_name,
           guest_phone,
           guest_telegram_id,
           party_size,
           start_dt,
           end_dt,
           status,
           assigned_tables,
           reminder_sent_at,
           created_at,
           updated_at
         FROM bookings
         WHERE ref_code = $1`,
        [refCode]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return mapBookingRow(result.rows[0]!);
    },

    async listByDate(date) {
      const { start, end } = dayBoundsUtc(date);
      const result = await pool.query(
        `SELECT
           id,
           ref_code,
           guest_name,
           guest_phone,
           guest_telegram_id,
           party_size,
           start_dt,
           end_dt,
           status,
           assigned_tables,
           reminder_sent_at,
           created_at,
           updated_at
         FROM bookings
         WHERE start_dt >= $1
           AND start_dt < $2
         ORDER BY start_dt`,
        [start, end]
      );

      return result.rows.map(mapBookingRow);
    },

    async updateStatus(id, status) {
      const result = await pool.query(
        `UPDATE bookings
         SET status = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING
           id,
           ref_code,
           guest_name,
           guest_phone,
           guest_telegram_id,
           party_size,
           start_dt,
           end_dt,
           status,
           assigned_tables,
           reminder_sent_at,
           created_at,
           updated_at`,
        [id, status]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return mapBookingRow(result.rows[0]!);
    },

    async listOverlapping(startDt, endDt, statuses = DEFAULT_OVERLAPPING_STATUSES) {
      const result = await pool.query(
        `SELECT
           id,
           ref_code,
           guest_name,
           guest_phone,
           guest_telegram_id,
           party_size,
           start_dt,
           end_dt,
           status,
           assigned_tables,
           reminder_sent_at,
           created_at,
           updated_at
         FROM bookings
         WHERE start_dt < $2
           AND end_dt > $1
           AND status = ANY($3::text[])
         ORDER BY start_dt`,
        [startDt, endDt, statuses]
      );

      return result.rows.map(mapBookingRow);
    },
  };
}

function createAdminsRepository(pool: pg.Pool): AdminsRepository {
  return {
    async isAdmin(telegramUserId) {
      const result = await pool.query(
        `SELECT 1
         FROM admins
         WHERE telegram_user_id = $1`,
        [telegramUserId]
      );

      return (result.rowCount ?? 0) > 0;
    },

    async list() {
      const result = await pool.query(
        `SELECT telegram_user_id, name
         FROM admins
         ORDER BY name`
      );

      return result.rows.map(mapAdminRow);
    },

    async create(telegramUserId, name) {
      const result = await pool.query(
        `INSERT INTO admins (telegram_user_id, name)
         VALUES ($1, $2)
         RETURNING telegram_user_id, name`,
        [telegramUserId, name]
      );

      return mapAdminRow(result.rows[0]!);
    },

    async delete(telegramUserId) {
      const result = await pool.query(
        `DELETE FROM admins
         WHERE telegram_user_id = $1`,
        [telegramUserId]
      );

      return (result.rowCount ?? 0) > 0;
    },
  };
}

function createAuditLogsRepository(pool: pg.Pool): AuditLogsRepository {
  return {
    async create(input) {
      const result = await pool.query(
        `INSERT INTO audit_logs (action, actor, booking_id, details)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, action, actor, booking_id, details, ts`,
        [
          input.action,
          input.actor ?? null,
          input.booking_id ?? null,
          input.details === null || input.details === undefined
            ? null
            : JSON.stringify(input.details),
        ]
      );

      return mapAuditLogRow(result.rows[0]!);
    },

    async listByBooking(bookingId) {
      const result = await pool.query(
        `SELECT id, action, actor, booking_id, details, ts
         FROM audit_logs
         WHERE booking_id = $1
         ORDER BY ts`,
        [bookingId]
      );

      return result.rows.map(mapAuditLogRow);
    },
  };
}

export function getRepository(pool: pg.Pool): Repository {
  return {
    configs: createConfigsRepository(pool),
    restaurantTables: createRestaurantTablesRepository(pool),
    bookings: createBookingsRepository(pool),
    admins: createAdminsRepository(pool),
    auditLogs: createAuditLogsRepository(pool),
  };
}