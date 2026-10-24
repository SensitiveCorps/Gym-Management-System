-- Smoke tests need a fresh schema; no demo data dependency.
-- All test data are synthetic and are rolled back at the end.
-- psql -v ON_ERROR_STOP=1 -d gym_management_system -f database/tests/01_smoke_tests.sql
BEGIN;
DO $$
DECLARE
    v_manager BIGINT;
    v_staff BIGINT;
    v_member BIGINT;
    v_plan BIGINT;
    v_payment1 BIGINT;
    v_payment2 BIGINT;
    v_expiry DATE;
    v_visit BIGINT;
    v_accepted BOOLEAN;
    v_denial BIGINT;
    v_reason TEXT;
    v_notice BIGINT;
    v_note_phase TEXT;
    v_count BIGINT;
BEGIN
    INSERT INTO staff_accounts(username,password_hash,role)
    VALUES('dbtest_manager','TEST_HASH_VALUE_NOT_A_REAL_PASSWORD','MANAGER')
    RETURNING staff_account_id INTO v_manager;
    INSERT INTO staff_accounts(username,password_hash,role)
    VALUES('dbtest_staff','TEST_HASH_VALUE_NOT_A_REAL_PASSWORD','STAFF')
    RETURNING staff_account_id INTO v_staff;
    INSERT INTO members(first_name,surname,id_type,id_number,photo_path,password_hash)
    VALUES('Test','Member','STUDENT_ID','DB-TEST-0001','protected/dummy/test.jpg',
           'TEST_HASH_VALUE_NOT_A_REAL_PASSWORD')
    RETURNING member_id INTO v_member;
    -- The connected API requires stored photo bytes; keep this test compatible
    -- with both the original 01/02 schema and the additive 04/05 migrations.
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='members' AND column_name='photo_bytes') THEN
        EXECUTE 'UPDATE members SET photo_bytes=decode($1, ''base64'') WHERE member_id=$2'
        USING 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', v_member;
    END IF;
    INSERT INTO plans(plan_name,price,duration_days)
    VALUES('Test 30 Day Plan', 99.00, 30) RETURNING plan_id INTO v_plan;

    -- Day of payment counts as Day 1. Two back-to-back 30-day payments stack.
    v_payment1 := record_cash_payment(v_member,v_plan,'DB-TEST-RECEIPT-1',v_staff,CURRENT_DATE);
    SELECT resulting_expiry_date INTO v_expiry FROM payments WHERE payment_id=v_payment1;
    IF v_expiry <> CURRENT_DATE + 29 THEN RAISE EXCEPTION 'New membership expiry error: %',v_expiry; END IF;
    v_payment2 := record_cash_payment(v_member,v_plan,'DB-TEST-RECEIPT-2',v_staff,CURRENT_DATE);
    SELECT resulting_expiry_date INTO v_expiry FROM payments WHERE payment_id=v_payment2;
    IF v_expiry <> CURRENT_DATE + 59 THEN RAISE EXCEPTION 'Renewal did not stack: %',v_expiry; END IF;
    IF (SELECT COUNT(*) FROM payments WHERE member_id=v_member) <> 2 THEN
        RAISE EXCEPTION 'Payment history count incorrect';
    END IF;
    IF record_cash_payment(v_member,v_plan,'DB-TEST-RECEIPT-2',v_staff,CURRENT_DATE) <> v_payment2 THEN
        RAISE EXCEPTION 'Payment receipt retry should be idempotent';
    END IF;

    -- No photo confirmation => a logged denial, never a check-in.
    SELECT accepted, checkin_id, denial_id, reason
      INTO v_accepted,v_visit,v_denial,v_reason
      FROM attempt_checkin(v_member,'DB-TEST-0001',v_staff,FALSE);
    IF v_accepted OR v_visit IS NOT NULL OR v_denial IS NULL OR v_reason <> 'PHOTO_NOT_CONFIRMED' THEN
        RAISE EXCEPTION 'Unconfirmed identity was not denied properly';
    END IF;

    SELECT accepted, checkin_id, denial_id, reason
      INTO v_accepted,v_visit,v_denial,v_reason
      FROM attempt_checkin(v_member,'DB-TEST-0001',v_staff,TRUE);
    IF NOT v_accepted OR v_visit IS NULL OR v_denial IS NOT NULL THEN
        RAISE EXCEPTION 'Valid paid/photo-confirmed check-in failed';
    END IF;

    SELECT accepted, checkin_id, denial_id, reason
      INTO v_accepted,v_payment1,v_denial,v_reason
      FROM attempt_checkin(v_member,'DB-TEST-0001',v_staff,TRUE);
    IF v_accepted OR v_reason <> 'ALREADY_INSIDE' THEN
        RAISE EXCEPTION 'Duplicate check-in was not rejected';
    END IF;
    PERFORM record_checkout(v_visit,v_staff);
    IF (SELECT checkout_method FROM checkins WHERE checkin_id=v_visit) <> 'MANUAL' THEN
        RAISE EXCEPTION 'Checkout was not recorded';
    END IF;

    -- An unknown identity cannot appear as a successful member visit.
    SELECT accepted, checkin_id, denial_id, reason
      INTO v_accepted,v_payment1,v_denial,v_reason
      FROM attempt_checkin(NULL,'INVALID-UNKNOWN-000',v_staff,TRUE);
    IF v_accepted OR v_reason <> 'UNKNOWN_ID' OR v_denial IS NULL THEN
        RAISE EXCEPTION 'Unknown identifier was not logged';
    END IF;

    -- Only manager actor can publish a notice, and tomorrow's is visible today.
    INSERT INTO notices(title,message,starts_on,ends_on,posted_by)
    VALUES('DBTEST upcoming closure','Synthetic test notice',CURRENT_DATE+1,CURRENT_DATE+2,v_manager)
    RETURNING notice_id INTO v_notice;
    SELECT phase INTO v_note_phase FROM v_public_notices WHERE notice_id=v_notice;
    IF v_note_phase <> 'UPCOMING' THEN RAISE EXCEPTION 'Future closure not visible now'; END IF;
    SELECT COUNT(*) INTO v_count FROM audit_events
    WHERE entity_name='notices' AND entity_id=v_notice AND actor_staff_account_id=v_manager;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Missing manager audit event'; END IF;

    -- Row-level constraints and immutability are enforced regardless of API.
    BEGIN
        INSERT INTO members(first_name,surname,id_type,id_number,photo_path,password_hash)
        VALUES('Duplicate','Test','STUDENT_ID','DB-TEST-0001','protected/test.jpg',
               'TEST_HASH_VALUE_NOT_A_REAL_PASSWORD');
        RAISE EXCEPTION 'Duplicate ID wrongly accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    BEGIN
        UPDATE payments SET amount=100 WHERE payment_id=v_payment2;
        RAISE EXCEPTION 'History update wrongly accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'History update wrongly accepted' THEN RAISE; END IF;
    END;
    BEGIN
        INSERT INTO notices(title,message,starts_on,ends_on,posted_by)
        VALUES('Not authorized','No staff posting',CURRENT_DATE,CURRENT_DATE,v_staff);
        RAISE EXCEPTION 'Nonmanager posting wrongly accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'Nonmanager posting wrongly accepted' THEN RAISE; END IF;
    END;
    RAISE NOTICE 'GMS schema smoke tests passed (transaction will roll back).';
END;
$$;
ROLLBACK;
