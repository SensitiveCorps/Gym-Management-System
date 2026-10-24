-- Additive migration for the selected UI and authenticated Express API.
-- Run after 01_schema.sql and 02_logic_and_views.sql. Existing history is retained.
BEGIN;
ALTER TABLE staff_accounts ADD COLUMN display_name TEXT;
ALTER TABLE members ADD COLUMN photo_bytes BYTEA;
ALTER TABLE members ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE services ADD COLUMN presentation JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE payments ADD COLUMN plan_name_snapshot TEXT;
ALTER TABLE payments ADD COLUMN duration_days_snapshot INTEGER CHECK (duration_days_snapshot > 0);
ALTER TABLE time_overrides ADD COLUMN is_cancelled BOOLEAN NOT NULL DEFAULT FALSE;
-- Fail safely if old records need deduplication; never delete records to force a migration.
CREATE UNIQUE INDEX member_identity_ci_uq ON members(id_type,LOWER(id_number));
CREATE UNIQUE INDEX receipt_number_ci_uq ON payments(LOWER(receipt_number));
CREATE UNIQUE INDEX plan_name_ci_uq ON plans(LOWER(plan_name));
CREATE TABLE gms_sessions (
 token_hash TEXT PRIMARY KEY,
 staff_id BIGINT REFERENCES staff_accounts(staff_account_id),
 member_id BIGINT REFERENCES members(member_id),
 csrf_token TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 touched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '12 hours',
 CHECK ((staff_id IS NULL) <> (member_id IS NULL))
);
CREATE TABLE staff_presence (
 presence_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 staff_id BIGINT NOT NULL REFERENCES staff_accounts(staff_account_id),
 session_hash TEXT NOT NULL,
 signed_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 signed_out_at TIMESTAMPTZ
);
CREATE TABLE gms_requests (
 actor TEXT NOT NULL,
 request_key TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(actor,request_key)
);
CREATE TABLE app_settings (name TEXT PRIMARY KEY,value JSONB NOT NULL);
CREATE TABLE staff_messages (
 message_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 message TEXT NOT NULL CHECK(LENGTH(BTRIM(message))>0),
 recipient BIGINT REFERENCES staff_accounts(staff_account_id),
 posted_by BIGINT NOT NULL REFERENCES staff_accounts(staff_account_id),
 posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 cancelled BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE staff_message_reads (
 message_id BIGINT REFERENCES staff_messages(message_id),
 staff_id BIGINT REFERENCES staff_accounts(staff_account_id),
 PRIMARY KEY(message_id,staff_id)
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_entity_name_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_entity_name_check CHECK(entity_name IN
 ('notices','operating_times','time_overrides','members','plans','staff_accounts','services','app_settings','staff_messages'));

CREATE FUNCTION gms_payment_snapshot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 SELECT plan_name,duration_days INTO NEW.plan_name_snapshot,NEW.duration_days_snapshot
 FROM plans WHERE plan_id=NEW.plan_id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER payments_snapshot BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION gms_payment_snapshot();
-- Payment snapshots on existing immutable payments remain NULL rather than invented.
-- The API exposes a clearly marked legacy label for those rows.
COMMIT;
