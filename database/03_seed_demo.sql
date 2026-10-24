-- OPTIONAL: synthetic demo fixture. Never run in production.
-- Login password for ALL demo accounts: DemoOnly-ChangeMe123!
-- Stored only as Argon2id hashes. Use fake identity/photo placeholders only.
-- Repeat-safe for same named demo users/receipts, not a production migration.
BEGIN;
INSERT INTO staff_accounts(username, password_hash, role) VALUES
  ('demo_manager', '$argon2id$v=19$m=32768,t=2,p=1$+xggIuHsOa507/YbcigG2Q$ONNNprfOhn7IS06LCN/iYWt6dGqfTXfN9W21/I5naqU', 'MANAGER'),
  ('demo_staff', '$argon2id$v=19$m=32768,t=2,p=1$+xggIuHsOa507/YbcigG2Q$ONNNprfOhn7IS06LCN/iYWt6dGqfTXfN9W21/I5naqU', 'STAFF')
ON CONFLICT (username) DO NOTHING;

INSERT INTO plans(plan_name, description, price, duration_days) VALUES
  ('30 Day', 'Demonstration monthly membership', 150.00, 30),
  ('7 Day', 'Demonstration weekly membership', 50.00, 7)
ON CONFLICT (plan_name) DO NOTHING;

-- Paths are dummy strings. Real photo files must be uploaded to protected storage.
INSERT INTO members(first_name,surname,id_type,id_number,photo_path,password_hash) VALUES
  ('Demo', 'Active', 'STUDENT_ID', 'DEMO-STUDENT-0001', 'protected/demo/active.jpg', '$argon2id$v=19$m=32768,t=2,p=1$+xggIuHsOa507/YbcigG2Q$ONNNprfOhn7IS06LCN/iYWt6dGqfTXfN9W21/I5naqU'),
  ('Demo', 'Expired', 'PASSPORT', 'DEMO-PASSPORT-0002', 'protected/demo/expired.jpg', '$argon2id$v=19$m=32768,t=2,p=1$+xggIuHsOa507/YbcigG2Q$ONNNprfOhn7IS06LCN/iYWt6dGqfTXfN9W21/I5naqU')
ON CONFLICT (id_type, id_number) DO NOTHING;

DO $$
DECLARE
  v_actor BIGINT;
  v_active BIGINT;
  v_expired BIGINT;
  v_plan BIGINT;
BEGIN
  SELECT staff_account_id INTO v_actor FROM staff_accounts WHERE username='demo_staff';
  SELECT member_id INTO v_active FROM members WHERE id_type='STUDENT_ID' AND id_number='DEMO-STUDENT-0001';
  SELECT member_id INTO v_expired FROM members WHERE id_type='PASSPORT' AND id_number='DEMO-PASSPORT-0002';
  SELECT plan_id INTO v_plan FROM plans WHERE plan_name='30 Day';
  IF NOT EXISTS (SELECT 1 FROM payments WHERE receipt_number='DEMO-REC-001') THEN
     PERFORM record_cash_payment(v_active, v_plan, 'DEMO-REC-001', v_actor, CURRENT_DATE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payments WHERE receipt_number='DEMO-REC-002') THEN
     PERFORM record_cash_payment(v_expired, v_plan, 'DEMO-REC-002', v_actor, CURRENT_DATE - 65);
  END IF;
END;
$$;

INSERT INTO services(service_name,description) VALUES
  ('Weights area','Free weights and resistance training'),
  ('Cardio area','Exercise bikes and treadmills')
ON CONFLICT (service_name) DO NOTHING;

DO $$
DECLARE
  v_manager BIGINT;
  v_service BIGINT;
  v_dow INTEGER;
BEGIN
  SELECT staff_account_id INTO v_manager FROM staff_accounts WHERE username='demo_manager';
  SELECT service_id INTO v_service FROM services WHERE service_name='Cardio area';
  FOR v_dow IN 0..6 LOOP
    -- Whole-gym weekly example, NOT confirmed actual gym operating hours.
    IF NOT EXISTS (SELECT 1 FROM operating_times WHERE service_id IS NULL AND day_of_week=v_dow) THEN
      IF v_dow=0 THEN
        INSERT INTO operating_times(service_id,day_of_week,is_closed,changed_by)
        VALUES(NULL,v_dow,TRUE,v_manager);
      ELSE
        INSERT INTO operating_times(service_id,day_of_week,opens_at,closes_at,changed_by)
        VALUES(NULL,v_dow,'06:00','20:00',v_manager);
      END IF;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM notices WHERE title = 'DEMO: cardio area maintenance') THEN
    INSERT INTO notices(service_id,title,message,starts_on,ends_on,posted_by)
    VALUES(v_service, 'DEMO: cardio area maintenance',
           'Example only: cardio area planned closure; not an actual university gym announcement.',
           CURRENT_DATE + 1, CURRENT_DATE + 2,v_manager);
  END IF;
END;
$$;
COMMIT;
