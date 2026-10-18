-- Combined database initialization: run on a newly created empty gym_management_system database.
-- This file contains schema then logic/views, in dependency order.

-- Gym Management System (GMS) PostgreSQL schema v1.0
-- Baseline: Project Plan v3 (proposed), SRS v1.0 and revised ER/UML.
-- Use fictitious/dummy member data only until the client approves real-data handling.
-- Session/database timezone MUST use the gym's local calendar (e.g. Africa/Mbabane).
-- IMPORTANT: current schema assumes payment date is Day 1 of a membership;
-- the client has not yet approved this rule (see README / decisions).

BEGIN;

CREATE TABLE staff_accounts (
    staff_account_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('STAFF', 'MANAGER')),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT staff_username_nonblank CHECK (LENGTH(BTRIM(username)) BETWEEN 3 AND 60 AND username = BTRIM(username)),
    CONSTRAINT staff_password_hash_nonblank CHECK (LENGTH(password_hash) >= 20)
);
CREATE UNIQUE INDEX staff_username_ci_uq ON staff_accounts (LOWER(username));

CREATE TABLE members (
    member_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name TEXT NOT NULL,
    surname TEXT NOT NULL,
    id_type TEXT NOT NULL CHECK (id_type IN ('STUDENT_ID', 'NATIONAL_ID', 'PASSPORT', 'BIRTH_CERTIFICATE')),
    id_number TEXT NOT NULL,
    photo_path TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
    locked_until TIMESTAMPTZ,
    account_status TEXT NOT NULL DEFAULT 'ENABLED' CHECK (account_status IN ('ENABLED', 'SUSPENDED')),
    date_of_birth DATE,                         -- optional; minor eligibility is unconfirmed
    guardian_name TEXT,                         -- optional; no minor-data policy approved
    guardian_phone TEXT,                        -- optional; no minor-data policy approved
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT member_name_nonblank CHECK (LENGTH(BTRIM(first_name)) > 0 AND LENGTH(BTRIM(surname)) > 0),
    CONSTRAINT member_id_number_clean CHECK (LENGTH(BTRIM(id_number)) BETWEEN 1 AND 100 AND id_number = BTRIM(id_number)),
    CONSTRAINT member_photo_protected_path CHECK (LENGTH(BTRIM(photo_path)) > 0 AND photo_path !~* '^https?://'),
    CONSTRAINT member_password_hash_nonblank CHECK (LENGTH(password_hash) >= 20),
    CONSTRAINT member_id_type_number_unique UNIQUE (id_type, id_number)
);
CREATE INDEX members_name_search_idx ON members (LOWER(surname), LOWER(first_name));

CREATE TABLE plans (
    plan_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_name TEXT NOT NULL UNIQUE CHECK (LENGTH(BTRIM(plan_name)) > 0),
    description TEXT,
    price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No redundant current-expiry or current-plan columns in members.
-- The most recent confirmed payment is the sole source of both.
CREATE TABLE payments (
    payment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES members(member_id) ON DELETE RESTRICT,
    plan_id BIGINT NOT NULL REFERENCES plans(plan_id) ON DELETE RESTRICT,
    payment_date DATE NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    method TEXT NOT NULL DEFAULT 'CASH' CHECK (method = 'CASH'),
    status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status = 'CONFIRMED'),
    receipt_number TEXT NOT NULL UNIQUE CHECK (LENGTH(BTRIM(receipt_number)) > 0),
    recorded_by BIGINT NOT NULL REFERENCES staff_accounts(staff_account_id) ON DELETE RESTRICT,
    resulting_expiry_date DATE NOT NULL,
    CONSTRAINT payment_expiry_after_payment CHECK (resulting_expiry_date >= payment_date)
);
CREATE INDEX payments_member_latest_idx ON payments (member_id, payment_id DESC);
CREATE INDEX payments_recorded_at_idx ON payments (recorded_at DESC);

-- Gym-level attendance: a visit is not to one service/area.
CREATE TABLE checkins (
    checkin_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES members(member_id) ON DELETE RESTRICT,
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_by BIGINT NOT NULL REFERENCES staff_accounts(staff_account_id) ON DELETE RESTRICT,
    photo_confirmed BOOLEAN NOT NULL CHECK (photo_confirmed = TRUE),
    checked_out_at TIMESTAMPTZ,
    checked_out_by BIGINT REFERENCES staff_accounts(staff_account_id) ON DELETE RESTRICT,
    checkout_method TEXT CHECK (checkout_method IN ('MANUAL', 'AUTO')),
    CONSTRAINT checkin_checkout_fields_coherent CHECK (
        (checked_out_at IS NULL AND checked_out_by IS NULL AND checkout_method IS NULL)
        OR (checked_out_at IS NOT NULL AND checked_out_at >= checked_in_at
            AND checkout_method IS NOT NULL
            AND ((checkout_method = 'MANUAL' AND checked_out_by IS NOT NULL)
              OR (checkout_method = 'AUTO' AND checked_out_by IS NULL)))
    )
);
CREATE UNIQUE INDEX only_one_open_checkin_per_member ON checkins (member_id) WHERE checked_out_at IS NULL;
CREATE INDEX checkins_member_time_idx ON checkins (member_id, checked_in_at DESC);
CREATE INDEX checkins_time_idx ON checkins (checked_in_at DESC);

CREATE TABLE denied_attempts (
    denied_attempt_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    entered_identifier TEXT NOT NULL CHECK (LENGTH(BTRIM(entered_identifier)) BETWEEN 1 AND 150),
    member_id BIGINT REFERENCES members(member_id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (reason IN (
        'EXPIRED', 'UNKNOWN_ID', 'PHOTO_NOT_CONFIRMED', 'ALREADY_INSIDE', 'SUSPENDED'
    )),
    handled_by BIGINT NOT NULL REFERENCES staff_accounts(staff_account_id) ON DELETE RESTRICT
);
CREATE INDEX denied_attempts_time_idx ON denied_attempts (attempted_at DESC);
CREATE INDEX denied_attempts_member_idx ON denied_attempts (member_id, attempted_at DESC);

-- Services are gym areas, not access tiers. No plan-service join exists.
CREATE TABLE services (
    service_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_name TEXT NOT NULL UNIQUE CHECK (LENGTH(BTRIM(service_name)) > 0),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NULL service_id means the entire gym.
CREATE TABLE notices (
    notice_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_id BIGINT REFERENCES services(service_id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK (LENGTH(BTRIM(title)) > 0),
    message TEXT NOT NULL CHECK (LENGTH(BTRIM(message)) > 0),
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED', 'CANCELLED')),
    cancelled_at TIMESTAMPTZ,
    posted_by BIGINT NOT NULL REFERENCES staff_accounts(staff_account_id) ON DELETE RESTRICT,
    updated_by BIGINT REFERENCES staff_accounts(staff_account_id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT notice_date_range CHECK (ends_on >= starts_on),
    CONSTRAINT notice_cancellation_coherent CHECK (
        (status = 'PUBLISHED' AND cancelled_at IS NULL)
        OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
    )
);
CREATE INDEX notices_public_idx ON notices (status, ends_on, starts_on);

-- 0=Sunday, 1=Monday, ..., 6=Saturday (PostgreSQL EXTRACT(DOW)).
-- Overnight opening intervals are not modeled until actual hours are approved.
CREATE TABLE operating_times (
    operating_time_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_id BIGINT REFERENCES services(service_id) ON DELETE RESTRICT,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    opens_at TIME,
    closes_at TIME,
    is_closed BOOLEAN NOT NULL DEFAULT FALSE,
    changed_by BIGINT NOT NULL REFERENCES staff_accounts(staff_account_id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT operating_time_valid CHECK (
        (is_closed AND opens_at IS NULL AND closes_at IS NULL)
        OR (NOT is_closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at < closes_at)
    )
);
CREATE UNIQUE INDEX operating_gym_weekday_uq ON operating_times (day_of_week) WHERE service_id IS NULL;
CREATE UNIQUE INDEX operating_service_weekday_uq ON operating_times (service_id, day_of_week) WHERE service_id IS NOT NULL;

CREATE TABLE time_overrides (
    time_override_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    service_id BIGINT REFERENCES services(service_id) ON DELETE RESTRICT,
    override_date DATE NOT NULL,
    opens_at TIME,
    closes_at TIME,
    is_closed BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT,
    changed_by BIGINT NOT NULL REFERENCES staff_accounts(staff_account_id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT override_time_valid CHECK (
        (is_closed AND opens_at IS NULL AND closes_at IS NULL)
        OR (NOT is_closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at < closes_at)
    )
);
CREATE UNIQUE INDEX override_gym_date_uq ON time_overrides (override_date) WHERE service_id IS NULL;
CREATE UNIQUE INDEX override_service_date_uq ON time_overrides (service_id, override_date) WHERE service_id IS NOT NULL;

CREATE TABLE audit_events (
    audit_event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_staff_account_id BIGINT NOT NULL REFERENCES staff_accounts(staff_account_id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'CANCEL')),
    entity_name TEXT NOT NULL CHECK (entity_name IN ('notices', 'operating_times', 'time_overrides')),
    entity_id BIGINT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    happened_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_events_target_idx ON audit_events (entity_name, entity_id, happened_at DESC);

COMMIT;


-- Functions, integrity triggers and read-only reporting views.
-- Requires 01_schema.sql. Run with psql -v ON_ERROR_STOP=1.
BEGIN;

CREATE FUNCTION gms_set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;
CREATE TRIGGER staff_accounts_updated BEFORE UPDATE ON staff_accounts
    FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();
CREATE TRIGGER members_updated BEFORE UPDATE ON members
    FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();
CREATE TRIGGER plans_updated BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION gms_set_updated_at();

-- Never alter financial history or erase attendance/denial history.
-- Check-in records may ONLY receive their one-time checkout information.
CREATE FUNCTION gms_block_history_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% records cannot be %', TG_TABLE_NAME, LOWER(TG_OP);
END;
$$;
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION gms_block_history_mutation();
CREATE TRIGGER denied_attempts_append_only BEFORE UPDATE OR DELETE ON denied_attempts
    FOR EACH ROW EXECUTE FUNCTION gms_block_history_mutation();
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION gms_block_history_mutation();
CREATE TRIGGER members_no_delete BEFORE DELETE ON members
    FOR EACH ROW EXECUTE FUNCTION gms_block_history_mutation();

CREATE FUNCTION gms_checkin_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Check-in history must not be deleted';
    END IF;
    IF OLD.checked_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'A completed visit cannot be modified';
    END IF;
    IF NEW.checkin_id IS DISTINCT FROM OLD.checkin_id
       OR NEW.member_id IS DISTINCT FROM OLD.member_id
       OR NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at
       OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
       OR NEW.photo_confirmed IS DISTINCT FROM OLD.photo_confirmed
       OR NEW.checked_out_at IS NULL THEN
        RAISE EXCEPTION 'Only closing an open visit is permitted';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER checkins_limited_mutation BEFORE UPDATE OR DELETE ON checkins
    FOR EACH ROW EXECUTE FUNCTION gms_checkin_guard();

-- Manager actor must be active, and changes to public status are always audited.
-- WARNING: backend authentication must establish that the supplied actor ID is the
-- actual logged-in manager; passing IDs as SQL parameters is not authentication.
CREATE FUNCTION gms_manager_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_actor BIGINT;
    v_action TEXT;
    v_entity_id BIGINT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '% rows must not be deleted; edit/close/cancel them instead', TG_TABLE_NAME;
    END IF;

    IF TG_TABLE_NAME = 'notices' THEN
        IF TG_OP = 'INSERT' THEN
            v_actor := NEW.posted_by;
            v_action := 'INSERT';
        ELSE
            v_actor := NEW.updated_by;
            IF v_actor IS NULL THEN
                RAISE EXCEPTION 'Notice updates require updated_by manager actor';
            END IF;
            IF NEW.posted_by IS DISTINCT FROM OLD.posted_by
                OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
                RAISE EXCEPTION 'Notice author and publication time are immutable';
            END IF;
            v_action := CASE WHEN OLD.status <> 'CANCELLED' AND NEW.status = 'CANCELLED'
                             THEN 'CANCEL' ELSE 'UPDATE' END;
            NEW.updated_at := NOW();
        END IF;
        v_entity_id := NEW.notice_id;
    ELSIF TG_TABLE_NAME = 'operating_times' THEN
        v_actor := NEW.changed_by;
        NEW.updated_at := NOW();
        v_action := TG_OP;
        v_entity_id := NEW.operating_time_id;
    ELSIF TG_TABLE_NAME = 'time_overrides' THEN
        v_actor := NEW.changed_by;
        NEW.updated_at := NOW();
        v_action := TG_OP;
        v_entity_id := NEW.time_override_id;
    ELSE
        RAISE EXCEPTION 'Unexpected table for manager audit';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM staff_accounts
        WHERE staff_account_id = v_actor AND is_enabled AND role = 'MANAGER'
    ) THEN
        RAISE EXCEPTION 'An enabled manager account is required to modify %', TG_TABLE_NAME;
    END IF;
    INSERT INTO audit_events(actor_staff_account_id, action, entity_name, entity_id, details)
    VALUES (
        v_actor, v_action, TG_TABLE_NAME, v_entity_id,
        CASE WHEN TG_OP = 'INSERT'
            THEN JSONB_BUILD_OBJECT('new', TO_JSONB(NEW))
            ELSE JSONB_BUILD_OBJECT('old', TO_JSONB(OLD), 'new', TO_JSONB(NEW))
        END
    );
    RETURN NEW;
END;
$$;
CREATE TRIGGER notices_manager_audit BEFORE INSERT OR UPDATE OR DELETE ON notices
    FOR EACH ROW EXECUTE FUNCTION gms_manager_audit();
CREATE TRIGGER operating_times_manager_audit BEFORE INSERT OR UPDATE OR DELETE ON operating_times
    FOR EACH ROW EXECUTE FUNCTION gms_manager_audit();
CREATE TRIGGER time_overrides_manager_audit BEFORE INSERT OR UPDATE OR DELETE ON time_overrides
    FOR EACH ROW EXECUTE FUNCTION gms_manager_audit();

-- BR2, FR-PAY: one member lock serializes renewals and protects the date calculation.
-- The result snapshot is written to each immutable payment. It uses the proposed
-- INCLUSIVE day-counting convention, not yet formally approved by the gym.
-- Method is CASH only; price is snapshotted from the selected plan.
CREATE FUNCTION record_cash_payment(
    p_member_id BIGINT,
    p_plan_id BIGINT,
    p_receipt_number TEXT,
    p_staff_account_id BIGINT,
    p_payment_date DATE DEFAULT CURRENT_DATE
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
    v_plan plans%ROWTYPE;
    v_previous_expiry DATE;
    v_last_payment_date DATE;
    v_expiry DATE;
    v_payment_id BIGINT;
    v_existing payments%ROWTYPE;
BEGIN
    IF p_payment_date IS NULL OR LENGTH(BTRIM(COALESCE(p_receipt_number, ''))) = 0 THEN
        RAISE EXCEPTION 'Payment date and receipt number are required';
    END IF;
    IF p_payment_date > CURRENT_DATE THEN
        RAISE EXCEPTION 'Future-dated cash payments are not supported';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM staff_accounts WHERE staff_account_id = p_staff_account_id
                   AND is_enabled AND role IN ('STAFF','MANAGER')) THEN
        RAISE EXCEPTION 'An enabled staff/manager is required to record payment';
    END IF;

    -- Lock before inspecting the last payment: concurrent renewals cannot lose days.
    PERFORM 1 FROM members WHERE member_id = p_member_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member % does not exist', p_member_id;
    END IF;
    SELECT * INTO v_plan FROM plans WHERE plan_id = p_plan_id AND is_available FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Membership plan % is not available', p_plan_id;
    END IF;

    SELECT * INTO v_existing FROM payments WHERE receipt_number = BTRIM(p_receipt_number);
    IF FOUND THEN
        IF v_existing.member_id = p_member_id AND v_existing.plan_id = p_plan_id
           AND v_existing.recorded_by = p_staff_account_id
           AND v_existing.payment_date = p_payment_date THEN
            RETURN v_existing.payment_id; -- safe retry: the same receipt is never charged twice
        END IF;
        RAISE EXCEPTION 'Receipt % already belongs to another payment', p_receipt_number;
    END IF;

    SELECT resulting_expiry_date, payment_date
      INTO v_previous_expiry, v_last_payment_date
      FROM payments WHERE member_id = p_member_id
      ORDER BY payment_id DESC LIMIT 1;
    IF v_last_payment_date IS NOT NULL AND p_payment_date < v_last_payment_date THEN
        RAISE EXCEPTION 'Backdated payment would invalidate renewal order';
    END IF;

    IF v_previous_expiry IS NOT NULL AND v_previous_expiry >= p_payment_date THEN
        v_expiry := v_previous_expiry + v_plan.duration_days;
    ELSE
        v_expiry := p_payment_date + (v_plan.duration_days - 1);
    END IF;
    INSERT INTO payments(member_id, plan_id, payment_date, amount, receipt_number,
                         recorded_by, resulting_expiry_date)
    VALUES(p_member_id, p_plan_id, p_payment_date, v_plan.price, BTRIM(p_receipt_number),
           p_staff_account_id, v_expiry)
    RETURNING payment_id INTO v_payment_id;
    RETURN v_payment_id;
END;
$$;

-- FR-CHK: after an identity/photo decision, return either a visit or a logged denial.
-- The Express API must authenticate staff and ensure p_photo_confirmed represents
-- the actual staff-confirmation action in the user interface.
CREATE FUNCTION attempt_checkin(
    p_member_id BIGINT,
    p_entered_identifier TEXT,
    p_staff_account_id BIGINT,
    p_photo_confirmed BOOLEAN
) RETURNS TABLE(accepted BOOLEAN, checkin_id BIGINT, denial_id BIGINT, reason TEXT)
LANGUAGE plpgsql AS $$
DECLARE
    v_member members%ROWTYPE;
    v_expiry DATE;
    v_reason TEXT;
    v_open_visit BOOLEAN;
BEGIN
    IF LENGTH(BTRIM(COALESCE(p_entered_identifier, ''))) = 0 THEN
        RAISE EXCEPTION 'Search/entered identifier is required for the audit log';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM staff_accounts WHERE staff_account_id = p_staff_account_id
                   AND is_enabled AND role IN ('STAFF','MANAGER')) THEN
        RAISE EXCEPTION 'An enabled staff/manager is required to check in a member';
    END IF;

    IF p_member_id IS NOT NULL THEN
        SELECT * INTO v_member FROM members WHERE member_id = p_member_id FOR UPDATE;
    END IF;
    IF p_member_id IS NULL OR NOT FOUND THEN
        v_reason := 'UNKNOWN_ID';
    ELSIF v_member.account_status <> 'ENABLED' THEN
        v_reason := 'SUSPENDED';
    ELSE
        SELECT resulting_expiry_date INTO v_expiry FROM payments
        WHERE member_id = p_member_id ORDER BY payment_id DESC LIMIT 1;
        IF v_expiry IS NULL OR v_expiry < CURRENT_DATE THEN
            v_reason := 'EXPIRED';
        ELSIF p_photo_confirmed IS DISTINCT FROM TRUE THEN
            v_reason := 'PHOTO_NOT_CONFIRMED';
        ELSE
            SELECT EXISTS(SELECT 1 FROM checkins WHERE member_id = p_member_id
                          AND checked_out_at IS NULL) INTO v_open_visit;
            IF v_open_visit THEN
                v_reason := 'ALREADY_INSIDE';
            END IF;
        END IF;
    END IF;

    accepted := (v_reason IS NULL);
    reason := v_reason;
    IF accepted THEN
        INSERT INTO checkins(member_id, confirmed_by, photo_confirmed)
        VALUES(p_member_id, p_staff_account_id, TRUE)
        RETURNING checkins.checkin_id INTO checkin_id;
        denial_id := NULL;
    ELSE
        INSERT INTO denied_attempts(entered_identifier, member_id, reason, handled_by)
        VALUES(BTRIM(p_entered_identifier),
               CASE WHEN v_reason = 'UNKNOWN_ID' THEN NULL ELSE p_member_id END,
               v_reason, p_staff_account_id)
        RETURNING denied_attempt_id INTO denial_id;
        checkin_id := NULL;
    END IF;
    RETURN NEXT;
END;
$$;

-- FR-CHK-08: manually close an open visit. Automated closing is a Should feature
-- and no background scheduler is included here.
CREATE FUNCTION record_checkout(p_checkin_id BIGINT, p_staff_account_id BIGINT)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql AS $$
DECLARE
    v_checkout TIMESTAMPTZ;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM staff_accounts WHERE staff_account_id = p_staff_account_id
                   AND is_enabled AND role IN ('STAFF','MANAGER')) THEN
        RAISE EXCEPTION 'An enabled staff/manager is required to check out';
    END IF;
    UPDATE checkins
       SET checked_out_at = CLOCK_TIMESTAMP(), checked_out_by = p_staff_account_id,
           checkout_method = 'MANUAL'
     WHERE checkin_id = p_checkin_id AND checked_out_at IS NULL
     RETURNING checked_out_at INTO v_checkout;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'There is no open check-in with id %', p_checkin_id;
    END IF;
    RETURN v_checkout;
END;
$$;

-- Password comparison (Argon2id/bcrypt) happens in Express, NOT in SQL.
-- These helpers only track login failures and successful logins; the 15-minute
-- lock duration is an explicit implementation default needing client confirmation.
CREATE FUNCTION record_member_login_failure(p_member_id BIGINT)
RETURNS TABLE(failed_count INTEGER, lock_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    UPDATE members AS m
       SET failed_login_count = CASE
            WHEN m.locked_until IS NOT NULL AND m.locked_until <= NOW() THEN 1
            WHEN m.locked_until > NOW() THEN m.failed_login_count
            ELSE m.failed_login_count + 1 END,
           locked_until = CASE
            WHEN m.locked_until > NOW() THEN m.locked_until
            WHEN (CASE WHEN m.locked_until IS NOT NULL AND m.locked_until <= NOW()
                       THEN 1 ELSE m.failed_login_count + 1 END) >= 5
              THEN NOW() + INTERVAL '15 minutes' ELSE NULL END
     WHERE m.member_id = p_member_id
    RETURNING m.failed_login_count, m.locked_until;
END;
$$;
CREATE FUNCTION reset_member_login_failures(p_member_id BIGINT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE members SET failed_login_count = 0, locked_until = NULL
    WHERE member_id = p_member_id;
END;
$$;

CREATE VIEW v_current_memberships AS
SELECT m.member_id, m.first_name, m.surname, m.account_status, m.registered_at,
       p.payment_id AS latest_payment_id, p.plan_id, pl.plan_name,
       p.payment_date AS latest_payment_date, p.resulting_expiry_date AS expiry_date,
       CASE WHEN p.payment_id IS NULL THEN 'NOT_SUBSCRIBED'
            WHEN p.resulting_expiry_date >= CURRENT_DATE THEN 'ACTIVE'
            ELSE 'EXPIRED' END AS membership_status,
       COALESCE(GREATEST(p.resulting_expiry_date - CURRENT_DATE + 1, 0), 0) AS days_remaining,
       COALESCE((m.account_status = 'ENABLED' AND p.resulting_expiry_date >= CURRENT_DATE), FALSE) AS may_check_in
  FROM members AS m
  LEFT JOIN LATERAL (
     SELECT * FROM payments AS x WHERE x.member_id = m.member_id
     ORDER BY x.payment_id DESC LIMIT 1
  ) AS p ON TRUE
  LEFT JOIN plans AS pl ON pl.plan_id = p.plan_id;

-- Anonymous visitors see only currently offered plans.
CREATE VIEW v_public_plans AS
SELECT plan_id, plan_name, description, price, duration_days
  FROM plans WHERE is_available;

-- Publication is visible before effectiveness. The UI should label this clearly.
CREATE VIEW v_public_notices AS
SELECT n.notice_id, n.title, n.message, n.service_id, s.service_name,
       n.starts_on, n.ends_on, n.published_at,
       CASE WHEN n.starts_on > CURRENT_DATE THEN 'UPCOMING' ELSE 'IN_EFFECT' END AS phase
  FROM notices AS n LEFT JOIN services AS s ON s.service_id = n.service_id
 WHERE n.status = 'PUBLISHED' AND n.published_at <= NOW()
   AND n.ends_on >= CURRENT_DATE;

-- Today's schedule with one-day overrides taking precedence over weekly hours.
-- "SCHEDULED_OPEN" means hours exist, NOT that the facility is open this minute.
CREATE VIEW v_today_hours AS
SELECT scope.service_id, scope.scope_name,
       CASE WHEN ov.time_override_id IS NOT NULL THEN ov.opens_at ELSE ot.opens_at END AS opens_at,
       CASE WHEN ov.time_override_id IS NOT NULL THEN ov.closes_at ELSE ot.closes_at END AS closes_at,
       CASE WHEN ov.time_override_id IS NOT NULL THEN 'OVERRIDE' ELSE 'WEEKLY' END AS schedule_source,
       CASE WHEN ov.time_override_id IS NOT NULL AND ov.is_closed THEN 'SCHEDULED_CLOSED'
            WHEN ov.time_override_id IS NOT NULL THEN 'SCHEDULED_OPEN'
            WHEN ot.operating_time_id IS NULL THEN 'UNCONFIGURED'
            WHEN ot.is_closed THEN 'SCHEDULED_CLOSED' ELSE 'SCHEDULED_OPEN' END AS schedule_status
  FROM (SELECT NULL::BIGINT AS service_id, 'Whole gym'::TEXT AS scope_name
        UNION ALL SELECT service_id, service_name FROM services WHERE is_active) AS scope
  LEFT JOIN LATERAL (
      SELECT * FROM time_overrides AS x
      WHERE x.service_id IS NOT DISTINCT FROM scope.service_id
        AND x.override_date = CURRENT_DATE LIMIT 1
  ) AS ov ON TRUE
  LEFT JOIN LATERAL (
      SELECT * FROM operating_times AS x
      WHERE x.service_id IS NOT DISTINCT FROM scope.service_id
        AND x.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)::SMALLINT LIMIT 1
  ) AS ot ON TRUE;

CREATE VIEW v_manager_dashboard AS
SELECT
    (SELECT COUNT(*) FROM v_current_memberships WHERE membership_status = 'ACTIVE') AS active_memberships,
    (SELECT COUNT(*) FROM v_current_memberships WHERE membership_status = 'EXPIRED') AS lapsed_members,
    (SELECT COUNT(*) FROM members
      WHERE registered_at >= DATE_TRUNC('month', NOW())
        AND registered_at < DATE_TRUNC('month', NOW()) + INTERVAL '1 month') AS new_members_this_month,
    (SELECT COUNT(*) FROM v_current_memberships
      WHERE membership_status = 'ACTIVE' AND days_remaining < 10) AS expiring_within_ten_days;

-- Attendance charts group according to the gym's local timezone.
CREATE VIEW v_weekly_checkins AS
SELECT DATE_TRUNC('week', checked_in_at AT TIME ZONE 'Africa/Mbabane')::DATE AS week_start,
       COUNT(*) AS successful_checkins
  FROM checkins
 GROUP BY 1;
CREATE VIEW v_monthly_checkins AS
SELECT DATE_TRUNC('month', checked_in_at AT TIME ZONE 'Africa/Mbabane')::DATE AS month_start,
       COUNT(*) AS successful_checkins
  FROM checkins
 GROUP BY 1;

COMMIT;
