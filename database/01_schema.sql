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
