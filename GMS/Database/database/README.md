# Gym Management System — PostgreSQL database

**Status:** implementation-ready *proposed database v1.0*, derived from the [revised project plan](../docs/PROJECT_PLAN.md), SRS v1.0 and revised ER/UML models. **Not yet approved for live gym-member data.** This folder contains SQL code. The connected Express API and selected UI are now available under [GMS/Server](../../Server/README.md); production hosting and client policy approval remain pending.

## Files

| File | Purpose |
| --- | --- |
| `00_create_database.sql` | Create the database, run once (optional if you use `createdb`). |
| `01_schema.sql` | Create 11 tables, foreign keys, unique rules and indexes. |
| `02_logic_and_views.sql` | Database integrity triggers, atomic workflows, public/reporting views. |
| `04_application.sql` | Additive sessions, private photo bytes, plan snapshots, request deduplication and application metadata. |
| `05_workflow_fixes.sql` | Preserve purchased terms, safely retry retired plans, require a stored photo and ignore cancelled overrides. |
| `03_seed_demo.sql` | **Optional** dummy-only staff, members, plans, hours and future notice. |
| `tests/01_smoke_tests.sql` | Checks key rules in a transaction that rolls back. |
| `ERD.md` | Mermaid entity–relationship overview for GitHub. |

## Requirements

- PostgreSQL **14+** recommended. The SQL avoids optional extensions.
- `psql` command-line client and credentials for a database owner/migration role.
- The React/Express application must implement authentication, RBAC, secure photo handling and API validation; **SQL alone is not a secure application**.

## Connected application

For the selected UI with server sign-in, use [the Windows/server setup](../../Server/README.md). Its `npm run migrate` initializes a fresh database or adds `04`/`05` to an existing `01`/`02` schema without resetting history. Back up an existing database first. Legacy payments without plan/duration snapshots are labelled accordingly; placeholder photo paths need an authorized image upload before check-in. The SQL-only initialization below still works for studying/testing the base model.

## Create and initialize locally

From the repository root:

```bash
# One-time database creation (requires your PostgreSQL user to have CREATEDB rights)
createdb -U postgres gym_management_system

# Critical for calendar membership dates and local gym hours
psql -U postgres -d postgres \
  -c "ALTER DATABASE gym_management_system SET timezone TO 'Africa/Mbabane';"

# Initialize on an empty database, in this exact order
psql -U postgres -d gym_management_system -v ON_ERROR_STOP=1 -f database/01_schema.sql
psql -U postgres -d gym_management_system -v ON_ERROR_STOP=1 -f database/02_logic_and_views.sql

# Optional, fake development data ONLY (includes demo accounts)
psql -U postgres -d gym_management_system -v ON_ERROR_STOP=1 -f database/03_seed_demo.sql

# Verify key rules; creates no persistent test rows
psql -U postgres -d gym_management_system -v ON_ERROR_STOP=1 -f database/tests/01_smoke_tests.sql
```

Instead of `createdb`, connect to the default `postgres` database and run `00_create_database.sql`. If your local PostgreSQL username is not `postgres`, replace `-U postgres` with your username. **Do not run `01_schema.sql` on an existing populated database**: this is an initial migration, not an upgrade or a reset script.

### Inspect the demo database

```sql
SELECT * FROM v_current_memberships ORDER BY member_id;
SELECT * FROM v_public_plans ORDER BY plan_id;
SELECT * FROM v_public_notices ORDER BY starts_on;
SELECT * FROM v_today_hours ORDER BY service_id NULLS FIRST;
SELECT * FROM v_manager_dashboard;
SELECT * FROM v_weekly_checkins ORDER BY week_start DESC;
SELECT * FROM v_monthly_checkins ORDER BY month_start DESC;
```

Demo staff logins (development only) are `demo_manager` and `demo_staff`; the two dummy members use their `id_type` + `id_number` (see `03_seed_demo.sql`). The demo password is **`DemoOnly-ChangeMe123!`**; only its Argon2id hashes are stored in the database. **Never deploy the demo seed, credentials or members.** Dummy photo paths are placeholders; no actual photo files are provided, so a future backend must create protected demo image assets for visual login/check-in demonstrations.

## Database relationships and constraints

| Table | Role / important rules |
| --- | --- |
| `staff_accounts` | Individual STAFF/MANAGER users, unique case-insensitive username, password hash, disable flag. |
| `members` | Identity `(id_type,id_number)` unique, protected photo path, hashed password, login lock, `ENABLED`/`SUSPENDED`. No hard deletes. Optional minor/guardian fields await approval. |
| `plans` | Name, fee, duration in days and sale availability. |
| `payments` | Cash-only confirmed receipts, immutable history, amount snapshot, staff actor, final expiry snapshot. |
| `checkins` | Staff-confirmed gym-level visit; one open record per member; checkout closes once. |
| `denied_attempts` | Rejection reason/time, entered identifier, responsible staff and nullable member. Immutable. |
| `services` | Gym areas (not plan/access tiers). |
| `notices` | Manager-only changes, future and current announcements, cancel rather than delete. `service_id IS NULL` means whole gym. |
| `operating_times` | Weekly whole-gym/service schedules; no duplicate day per scope. |
| `time_overrides` | One-date whole-gym/service exceptions; override normal hours for that date. |
| `audit_events` | Immutable manager change history for notices/hours. |

`v_current_memberships` derives current plan/expiry from the latest confirmed payment. There is **no** conflicting editable current-expiry column on the `members` table. `v_public_notices` shows published future notices as `UPCOMING`; it only hides them after expiry/cancellation. Dashboard and attendance counts are derived rather than stored.

## Key SQL workflow examples

The **backend must obtain the actual logged-in staff ID from its authenticated session**; never trust a caller-supplied staff ID.

```sql
-- Within a transaction, register the member and collect first cash payment.
-- Insert actual Argon2id/bcrypt hash and an internal protected photo path.
BEGIN;
INSERT INTO members(first_name, surname, id_type, id_number, photo_path, password_hash)
VALUES ('Dummy', 'Example', 'STUDENT_ID', 'EXAMPLE-UNIQUE-1001',
        'protected/path/created-by-backend.jpg', '<ARGON2ID_HASH_FROM_BACKEND>')
RETURNING member_id;
-- Use the returned member_id and the selected plan/staff IDs:
-- SELECT record_cash_payment(<member_id>, <plan_id>, 'RECEIPT-0001', <staff_id>, CURRENT_DATE);
COMMIT;
```

```sql
-- Retry-safe renewal, with a unique receipt and stored staff actor
SELECT record_cash_payment(1, 1, 'SAMPLE-RECEIPT-0099', 2, CURRENT_DATE);

-- Staff clicked the separate, explicit "photo matches" confirmation control
SELECT * FROM attempt_checkin(1, 'STUDENT-EXAMPLE-1', 2, TRUE);

-- Photo not confirmed -> denies and logs; does NOT admit the member
SELECT * FROM attempt_checkin(1, 'STUDENT-EXAMPLE-1', 2, FALSE);

-- Manual checkout of an accepted visit
SELECT record_checkout(1, 2);

-- A future announcement is listed publicly immediately after publishing
SELECT notice_id, title, starts_on, ends_on, phase FROM v_public_notices;
```

These parameter values are **illustrative only**. Prefer parameterized queries in the Express backend. No card payments, bulk import, cancellation of confirmed payments, or auto-checkout scheduler is included. Registration and first payment should be in the *same transaction*; never leave a half-completed initial registration after an API failure.

## Security boundary — important

The database enforces structural rules and validates that audit actor references point to enabled staff/manager accounts. **It cannot verify that a client truly is that staff member merely because an ID is supplied.** The Express backend must:

1. Authenticate members separately from staff; hash passwords using Argon2id or bcrypt; use secure sessions/tokens. Implement the five-failure member lock rule (`record_member_login_failure`/`reset_member_login_failures` are helpers; use the reset helper **only after password verification** and do not call it during a lock).
2. Restrict requests with server-side role checks. A member can read **only their own** membership/payment information. A regular staff user cannot create/edit notices, hours, staff accounts or manager dashboard data.
3. Use database credentials that are unavailable to browsers. Expose only safe public data (e.g. `v_public_notices`, `v_today_hours`, published plans). Do **not** expose internal views like `v_current_memberships` directly to unauthenticated users.
4. Store photographs outside public folders in authenticated, private storage. Never expose member photo paths through public/member endpoints; photos may be served to authorized staff through protected routes.
5. Derive `staff_account_id` on the server from the authenticated staff login, not from frontend JSON. Never let a frontend client issue arbitrary database writes. Limit grants to the app's database role and use parameterized queries. Consider PostgreSQL row-level security and separated read-only/public credentials before any production rollout.
6. Validate payment submission, photo confirmation and check-in eligibility **again on the server**, and handle unique violations, session expiry and retries safely.
7. Keep ID numbers and entered denial identifiers out of routine request/access logs; apply client-approved retention and privacy measures before real-world use.

The auto-checkout feature (`FR-CHK-09`) is currently a **Should** feature. The schema accommodates an `AUTO` checkout method, but no scheduler is implemented.

## Pending business-rule approvals

The current SQL implements the **proposed inclusive date policy**:

- New/expired membership: `expiry = payment_date + (duration_days - 1)`.
- Renewal while active: `expiry = previous_expiry + duration_days`.
- `days_remaining = max(0, expiry_date - today + 1)`.
- Today is included in a valid membership: `expiry_date >= CURRENT_DATE`.

For example, a plan lasting 30 days paid on its first day expires 29 days later; an early 30-day renewal with 8 days left leaves 38 days. **The gym has not formally approved this date rule.** Agree this before accepting real payments; changing rules after payments exist requires a reviewed migration and historical-data policy, not an ad hoc edit.

Other unresolved client decisions: minor eligibility/guardian data, maximum prepaid days, real operating hours and gym areas, receipt generation versus gym-issued receipts, identity-photo visibility, automatic checkout policy, and the 15-minute temporary login lock example used here. See `docs/PROJECT_PLAN.md` for governance.

## Backups and deployment

Use a dedicated restricted PostgreSQL role for the Express API, a separate owner role for migrations, encrypted connections in production, and regular backups (at least weekly during development per the SRS). Example development backup:

```bash
pg_dump -U postgres -Fc gym_management_system > gym_management_system.backup
```

Store database backups outside public GitHub repositories. Keep database passwords in an untracked `.env` or a secrets manager. Use staging with synthetic records first. Do not put real ID numbers or photos in Git history, issue descriptions, SQL dumps or screenshots.

## Test/execution status

The SQL files are provided for PostgreSQL. **A live PostgreSQL server/`psql` was not available in the authoring environment**, so execution of the smoke tests is not claimed. Run the commands above on your PostgreSQL installation and fix any environment-specific issues before merging to your main branch. The integration API and frontend are still separate development tasks.
