# Gym Management System: connected server

The selected team UI now has an Express/PostgreSQL mode. The same design is served from this process; authentication, authorization, private photos, cash transactions and histories are enforced by the API. The standalone Python-served UI remains a separate synthetic demo.

## Start in VS Code on Windows

Install Node.js 22 or newer and PostgreSQL 14 or newer. Create a local database named `gym_management_system` using pgAdmin or `createdb`. An existing database initialized with the repository's `01_schema.sql` and `02_logic_and_views.sql` is also supported; back it up before applying the additive migrations.

From the **repository root**, open PowerShell and run:

```powershell
cd GMS/Server
npm ci
Copy-Item .env.example .env
```

Edit `.env` in VS Code and replace `REPLACE_PASSWORD` with your PostgreSQL password. Keep this file private. If the password contains URL punctuation such as `@`, use its percent-encoded form in `DATABASE_URL`.

Then run:

```powershell
npm run migrate
npm run create-manager -- manager "Gym Manager"
npm start
```

The manager-creation command prompts for a password without displaying it. Open [http://localhost:8000](http://localhost:8000), select **Manager** and use that account. Create staff, plans, services and the approved hours from the manager screens. Staff can then register members with verified IDs, required photos, member-chosen passwords and cash receipt numbers. On registration and renewal, choose **Review payment**, check the server-provided terms, then collect cash and choose **Confirm payment**. Changed terms require another review; reviewing alone saves no records.

There are **no built-in server login credentials**. Do not run the older synthetic SQL seed on a live database. The API supports the Argon2id hashes used by that seed, but its placeholder photo paths are not real images; authorized staff must capture actual protected photos before those dummy members can check in.

Run the Python demo and connected server on different ports if using both. If PowerShell cannot find `node`, `npm`, `pg_dump` or `pg_restore`, restart VS Code after installing the relevant program and adding it to PATH.

## What is enforced

- Argon2id password hashes; no passwords/hashes are returned in API state. Temporary member resets force a new password and revoke existing sessions.
- Random, HttpOnly, SameSite cookies backed by hashed database session tokens, CSRF tokens, origin checks and server-side idle expiration. Staff enablement/roles are rechecked on protected requests.
- Members receive only their own masked record, payments and visits. Staff searches are bounded to 50 results. Photos are decoded, resized, stripped of metadata, stored as private database bytes and served only to authorized staff/manager.
- Payment previews use the gym database date and the same SQL expiry function as confirmed payments. Confirmation checks the displayed plan, price, duration, date, member and expiry again under locks.
- Confirmed cash registration/payment run in one PostgreSQL transaction. Renewals lock the member, calculate expiry on the server, preserve purchased plan/price/duration snapshots, and reject stale previews. Retrying the same request key or receipt cannot extend a membership twice.
- Check-in requires a stored photo and an explicit authenticated staff decision. Denials use the five SRS reason codes. Manual checkout records both time and the actual exit actor.
- Member history is retained through suspension/re-enable. Public notices show upcoming and current changes. Seven-day gym/area hours and dated overrides are editable and audited; whole-gym closure closes every area.
- Manager-only reports omit full document IDs/photos. Staff accounts, services, notices, hours and plans have validated server commands.

The frontend retains the selected HTML/CSS/JavaScript design with a separate API adapter; the server is organized into authentication, validation, state projection, action, database and maintenance modules. The earlier planned React port has not been performed; it is not required to use the connected interface.

## Migrations and existing data

`npm run migrate` initializes a fresh schema using `01`/`02`, then adds `04_application.sql`, `05_workflow_fixes.sql` and `06_payment_previews.sql`. It records successful migrations atomically. On an existing `01`/`02` database it applies only the additive migrations. No reset, member deletion or fabricated financial backfill is performed. Existing connected installations must rerun `npm run migrate` before starting this version; `06` adds the shared expiry calculation without rewriting purchased dates.

Case-insensitive identity, receipt and plan-name indexes fail safely if old duplicates exist. Resolve those records with the team before rerunning; do not delete historical records to force migration. Existing immutable payments lack name/duration snapshots and are labelled **Legacy payment**/**not recorded** rather than borrowing an edited catalogue value. Existing database photo paths require an authorized photo upload; the API never exposes or reads arbitrary filesystem paths.

The application connection needs data access on the GMS tables/sequences and execute permission for the workflow functions. Use a separate migration owner for DDL, and a dedicated application database role; do not expose PostgreSQL directly to browsers.

## Policies needing client sign-off

The code matches the database's **proposed inclusive convention**: a new 30-day purchase on 24 October 2026 expires on 22 November; an active renewal adds the plan's days to its current expiry. Existing expiry snapshots are preserved. D07 remains pending. Change SQL, UI preview and boundary tests together if the gym approves another convention.

The gym timezone is `Africa/Mbabane`. Lock and idle defaults are 15 minutes, configurable in `.env`; they remain working assumptions under D11. Weekly hours start unconfigured on a fresh database, so the application does not invent an approved schedule. Minor eligibility/guardian rules and hosting/pilot policies also remain pending.

Automatic closing checkout is implemented but **off by default**. Set `AUTO_CHECKOUT=true` only after the gym approves the rule and configures its hours. Maintenance runs once a minute, records `AUTO` with no invented staff actor, and leaves visits with unknown closing times for manual resolution.

Production startup requires `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, and `EXPIRY_POLICY_APPROVED=true` after sign-off. Use TLS hosting/reverse proxy and set `TRUST_PROXY=1` only behind a trusted single proxy. These controls are implemented; no production host has been deployed or certified.

## Test

```powershell
npm test
node ../UI/tests/check-workflows.mjs
```

The API suite applies the real SQL migrations to an isolated embedded PostgreSQL engine (PGlite), starts Express, and exercises HTTP authentication, privacy, transactions, retries, cash snapshots, audit history and the real UI adapter. It uses synthetic data only.

For the same suite against a native PostgreSQL server, create a **new, disposable empty database**, then:

```powershell
$env:TEST_DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/gms_acceptance_test"
npm test
Remove-Item Env:TEST_DATABASE_URL
```

Never point `TEST_DATABASE_URL` at an application database. The suite refuses a database already containing the members table and does not erase its test records afterward. Native PostgreSQL validates actual multi-connection locking; PGlite serializes access to its one embedded connection.

## Backup and restore

PostgreSQL client utilities must be on PATH. Backups include protected photos and financial records, so keep them in an access-restricted location outside Git.

```powershell
node scripts/backup.mjs
```

Create a separate, empty test database, set `RESTORE_DATABASE_URL` to it, then run:

```powershell
$env:RESTORE_DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/gms_restore_test"
node scripts/restore-check.mjs "backups/YOUR_BACKUP.dump"
Remove-Item Env:RESTORE_DATABASE_URL
```

Restore refuses a populated target and the application database. It reports member/payment/visit/denial/photo counts for comparison with the source. Connection passwords are passed through the child environment rather than command arguments.

Schedule `node scripts/backup.mjs` weekly in Windows Task Scheduler with `GMS/Server` as **Start in**, and run it before demonstrations. Record the backup path, date, restore result and responsible team member. The repository provides the tooling; a task has not been installed on your computer.

See [ACCEPTANCE.md](ACCEPTANCE.md) for the remaining human/device/deployment evidence.
