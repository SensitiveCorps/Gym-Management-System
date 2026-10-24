-- One calendar-day calculation for preview and committed cash payments.
-- The inclusive convention remains provisional (SRS D07).
BEGIN;
CREATE FUNCTION calculate_membership_expiry(
    p_previous_expiry DATE,
    p_payment_date DATE,
    p_duration_days INTEGER
) RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF p_payment_date IS NULL OR p_duration_days IS NULL OR p_duration_days < 1 THEN
        RAISE EXCEPTION 'A payment date and positive duration are required';
    END IF;
    IF p_previous_expiry IS NOT NULL AND p_previous_expiry >= p_payment_date THEN
        RETURN p_previous_expiry + p_duration_days;
    END IF;
    RETURN p_payment_date + (p_duration_days - 1);
END;
$$;

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

    v_expiry := calculate_membership_expiry(v_previous_expiry, p_payment_date, v_plan.duration_days);
    INSERT INTO payments(member_id, plan_id, payment_date, amount, receipt_number,
                         recorded_by, resulting_expiry_date)
    VALUES(p_member_id, p_plan_id, p_payment_date, v_plan.price, BTRIM(p_receipt_number),
           p_staff_account_id, v_expiry)
    RETURNING payment_id INTO v_payment_id;
    RETURN v_payment_id;
END;
$$;

COMMIT;
