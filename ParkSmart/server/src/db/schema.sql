-- ParkSmart database schema (PostgreSQL 13+)
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  phone           TEXT UNIQUE,
  email           TEXT UNIQUE,
  role            TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'driver')),
  password_hash   TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS facilities (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  address        TEXT NOT NULL DEFAULT '',
  opening_hours  TEXT NOT NULL DEFAULT '24 hours',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zones (
  id           SERIAL PRIMARY KEY,
  facility_id  INTEGER NOT NULL REFERENCES facilities(id),
  label        TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 1,
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slots (
  id                     SERIAL PRIMARY KEY,
  zone_id                INTEGER NOT NULL REFERENCES zones(id),
  facility_id            INTEGER NOT NULL REFERENCES facilities(id),
  code                   TEXT NOT NULL,
  sequence_no            INTEGER NOT NULL DEFAULT 1,
  vehicle_type           TEXT NOT NULL CHECK (vehicle_type IN ('motorcycle', 'car', 'microbus')),
  status                 TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'occupied', 'reserved', 'out_of_service')),
  out_of_service_reason  TEXT,
  is_deleted             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS slots_code_per_facility ON slots (facility_id, upper(code)) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS slots_alloc_idx ON slots (facility_id, vehicle_type, status);

CREATE TABLE IF NOT EXISTS vehicles (
  id                SERIAL PRIMARY KEY,
  plate_number      TEXT NOT NULL,
  plate_normalised  TEXT NOT NULL UNIQUE,
  type              TEXT NOT NULL CHECK (type IN ('motorcycle', 'car', 'microbus')),
  owner_id          INTEGER REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_rules (
  id                   SERIAL PRIMARY KEY,
  vehicle_type         TEXT NOT NULL CHECK (vehicle_type IN ('motorcycle', 'car', 'microbus')),
  first_hour           NUMERIC(10,2) NOT NULL CHECK (first_hour >= 0),
  per_hour             NUMERIC(10,2) NOT NULL CHECK (per_hour >= 0),
  daily_cap            NUMERIC(10,2) NOT NULL CHECK (daily_cap >= 0),
  grace_minutes        INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
  lost_ticket_penalty  NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (lost_ticket_penalty >= 0),
  monthly_pass_price   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (monthly_pass_price >= 0),
  effective_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to         TIMESTAMPTZ,
  created_by           INTEGER REFERENCES users(id)
);
-- exactly one active rule per vehicle type (FR-BIL-01)
CREATE UNIQUE INDEX IF NOT EXISTS rate_rules_one_active ON rate_rules (vehicle_type) WHERE effective_to IS NULL;

CREATE TABLE IF NOT EXISTS monthly_passes (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  vehicle_id     INTEGER NOT NULL REFERENCES vehicles(id),
  facility_id    INTEGER NOT NULL REFERENCES facilities(id),
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  price          NUMERIC(10,2) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  reminder_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  vehicle_id    INTEGER NOT NULL REFERENCES vehicles(id),
  facility_id   INTEGER NOT NULL REFERENCES facilities(id),
  slot_id       INTEGER NOT NULL REFERENCES slots(id),
  start_time    TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ NOT NULL,
  hold_minutes  INTEGER NOT NULL DEFAULT 15,
  status        TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'active', 'fulfilled', 'expired', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS reservations_status_idx ON reservations (status, start_time);

CREATE TABLE IF NOT EXISTS parking_sessions (
  id                 SERIAL PRIMARY KEY,
  vehicle_id         INTEGER NOT NULL REFERENCES vehicles(id),
  facility_id        INTEGER NOT NULL REFERENCES facilities(id),
  slot_id            INTEGER NOT NULL REFERENCES slots(id),
  rate_rule_id       INTEGER NOT NULL REFERENCES rate_rules(id),
  operator_id        INTEGER NOT NULL REFERENCES users(id),
  exit_operator_id   INTEGER REFERENCES users(id),
  reservation_id     INTEGER REFERENCES reservations(id),
  pass_id            INTEGER REFERENCES monthly_passes(id),
  vehicle_type       TEXT NOT NULL,
  entry_time         TIMESTAMPTZ NOT NULL DEFAULT now(),
  exit_time          TIMESTAMPTZ,
  ticket_code        TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  fee                NUMERIC(10,2),
  is_lost_ticket     BOOLEAN NOT NULL DEFAULT FALSE,
  client_request_id  TEXT UNIQUE
);
-- a vehicle can have only one open session anywhere (FR-ENT-03, NFR-REL-03)
CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_open_per_vehicle ON parking_sessions (vehicle_id) WHERE status = 'open';
-- a slot can host only one open session
CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_open_per_slot ON parking_sessions (slot_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS sessions_entry_idx ON parking_sessions (entry_time);

CREATE SEQUENCE IF NOT EXISTS receipt_seq START 1001;

CREATE TABLE IF NOT EXISTS payments (
  id               SERIAL PRIMARY KEY,
  session_id       INTEGER REFERENCES parking_sessions(id),
  pass_id          INTEGER REFERENCES monthly_passes(id),
  amount           NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  base_fee         NUMERIC(10,2) NOT NULL DEFAULT 0,
  penalty          NUMERIC(10,2) NOT NULL DEFAULT 0,
  original_amount  NUMERIC(10,2),
  method           TEXT NOT NULL CHECK (method IN ('cash', 'online', 'pass')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  quoted_exit_time TIMESTAMPTZ,
  receipt_no       TEXT UNIQUE,
  override_reason  TEXT,
  overridden_by    INTEGER REFERENCES users(id),
  operator_id      INTEGER REFERENCES users(id),
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (session_id IS NOT NULL OR pass_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS payments_paid_idx ON payments (status, paid_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  target      TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log (created_at DESC);

-- audit entries are append-only (FR-REP-06)
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
