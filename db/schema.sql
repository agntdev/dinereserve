CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS configs (
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, effective_from)
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  seats INTEGER NOT NULL CHECK (seats > 0),
  label TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_code CHAR(6) NOT NULL UNIQUE,
  guest_name TEXT,
  guest_phone TEXT,
  guest_telegram_id BIGINT,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  start_dt TIMESTAMPTZ NOT NULL,
  end_dt TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('confirmed', 'cancelled', 'rescheduled', 'no-show')
  ),
  assigned_tables JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_dt > start_dt)
);

CREATE TABLE IF NOT EXISTS admins (
  telegram_user_id BIGINT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor BIGINT,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  details JSONB,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_start_dt ON bookings (start_dt);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_booking_id ON audit_logs (booking_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ts ON audit_logs (ts);