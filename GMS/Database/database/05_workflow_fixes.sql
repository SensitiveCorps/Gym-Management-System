-- Preserve plan terms, allow safe retries after plan retirement, require stored photos.
BEGIN;
CREATE OR REPLACE FUNCTION record_cash_payment(
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
    SELECT * INTO v_existing FROM payments WHERE LOWER(receipt_number) = LOWER(BTRIM(p_receipt_number));
    IF FOUND THEN
        IF v_existing.member_id = p_member_id AND v_existing.plan_id = p_plan_id
           AND v_existing.recorded_by = p_staff_account_id
           AND v_existing.payment_date = p_payment_date THEN
            RETURN v_existing.payment_id; -- safe retry: the same receipt is never charged twice
        END IF;
        RAISE EXCEPTION 'Receipt % already belongs to another payment', p_receipt_number;
    END IF;

    SELECT * INTO v_plan FROM plans WHERE plan_id = p_plan_id AND is_available FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Membership plan % is not available', p_plan_id;
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

CREATE OR REPLACE FUNCTION attempt_checkin(
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
        ELSIF p_photo_confirmed IS DISTINCT FROM TRUE OR v_member.photo_bytes IS NULL THEN
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

CREATE OR REPLACE VIEW v_current_memberships AS
SELECT m.member_id, m.first_name, m.surname, m.account_status, m.registered_at,
       p.payment_id AS latest_payment_id, p.plan_id, COALESCE(p.plan_name_snapshot, 'Legacy payment (plan ' || p.plan_id || ')') AS plan_name,
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

CREATE OR REPLACE VIEW v_today_hours AS
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
        AND NOT x.is_cancelled AND x.override_date = CURRENT_DATE LIMIT 1
  ) AS ov ON TRUE
  LEFT JOIN LATERAL (
      SELECT * FROM operating_times AS x
      WHERE x.service_id IS NOT DISTINCT FROM scope.service_id
        AND x.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)::SMALLINT LIMIT 1
  ) AS ot ON TRUE;

COMMIT;
