# Database

PostgreSQL schema, workflow functions, migrations and SQL checks for the Gym Management System. The [backend](../backend/README.md) applies these files and enforces authentication and authorization; browsers do not connect to PostgreSQL directly.

## Application setup

Create a local PostgreSQL 14+ database, configure `backend/.env`, and install dependencies using the [root quick start](../README.md#run-the-application-in-vs-code). From the repository root, run:

```bash
npm run migrate
```

The migration runner initializes a fresh database using `01` and `02`, then applies `04`, `05` and `06`. On an existing base schema it applies only the additive application migrations. Successful migrations are recorded in `gms_migrations`. The optional demo seed is never run automatically.

Back up an existing database before migrating. Do not run the initial schema or archived combined script on a populated application database.

## Files

| File | Purpose |
| --- | --- |
| [00_create_database.sql](00_create_database.sql) | Optional one-time database creation; use instead of pgAdmin or `createdb`. |
| [01_schema.sql](01_schema.sql) | Base tables, relationships, checks and indexes. |
| [02_logic_and_views.sql](02_logic_and_views.sql) | Integrity triggers, cash/entry workflows and public/reporting views. |
| [03_seed_demo.sql](03_seed_demo.sql) | Optional synthetic data for a disposable SQL demonstration database. |
| [04_application.sql](04_application.sql) | Sessions, private photo bytes, plan snapshots, request deduplication and application metadata. |
| [05_workflow_fixes.sql](05_workflow_fixes.sql) | Preserve purchased terms, retry retired plans safely and require stored entry photos. |
| [06_payment_previews.sql](06_payment_previews.sql) | Shared expiry function for server previews and committed payments. |
| [tests/01_smoke_tests.sql](tests/01_smoke_tests.sql) | Workflow/integrity checks; synthetic rows are rolled back. |
| [ERD.md](ERD.md) | Relationships in the base data model. The SQL migrations define the complete application schema. |
| [archive/](archive/README.md) | Original combined SQL script, retained as a reference. |

Keep applied migration files unchanged when adding a new database change. Add the next numbered SQL file and register it in [backend/scripts/migrate.mjs](../backend/scripts/migrate.mjs) and the [integration suite](../backend/tests/integration.test.mjs).

## Explore the base SQL model separately

These commands create a **new disposable study database**, not the full application's database. Run them from the repository root with PostgreSQL client tools on PATH:

```bash
createdb -U postgres gms_sql_demo
psql -U postgres -d postgres -c "ALTER DATABASE gms_sql_demo SET timezone TO 'Africa/Mbabane';"
psql -U postgres -d gms_sql_demo -v ON_ERROR_STOP=1 -f database/01_schema.sql
psql -U postgres -d gms_sql_demo -v ON_ERROR_STOP=1 -f database/02_logic_and_views.sql
psql -U postgres -d gms_sql_demo -v ON_ERROR_STOP=1 -f database/tests/01_smoke_tests.sql
```

Replace `postgres` with your PostgreSQL username if needed. To populate that disposable study database with examples, optionally apply `database/03_seed_demo.sql` after `02`. Its synthetic SQL accounts use the password documented in that seed. Placeholder photo paths are not real photos and cannot support photo-confirmed entry in the connected application without an authorized upload.

## Membership dates and history

Current plan and expiry come from the latest confirmed payment; members have no independently editable expiry field. Confirmed cash payments retain price/name/duration snapshots and cannot be silently edited or deleted. Each accepted or refused entry records its handling staff member. Account suspension keeps history and is separate from paid membership validity.

The proposed inclusive expiry convention is:

- New or expired membership: payment date plus duration minus one day.
- Active renewal: previous expiry plus the purchased duration.
- A membership remains valid on its expiry date.

For example, a new 30-day purchase on 24 October expires on 22 November. The gym timezone is `Africa/Mbabane`. This convention remains pending under [SRS decision D07](../docs/SRS.md#11-open-decisions-and-assumptions); existing purchased dates must be preserved when policies change.

## Checks and operations

Run `npm test` from the repository root for UI and API checks. The API suite applies actual SQL migrations to isolated PGlite databases by default and supports a disposable native PostgreSQL database through `TEST_DATABASE_URL`.

See [validation](../docs/VALIDATION.md) for recorded results, [backend setup](../backend/README.md#backup-and-restore) for backup/restore commands, and [acceptance](../docs/ACCEPTANCE.md) for outstanding native database and deployment evidence. Keep backups, credentials, member IDs and photos out of Git.
