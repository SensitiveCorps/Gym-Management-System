# Validation record — 24 October 2026

Synthetic data only. No user database, production deployment or live member records were changed.

| Check | Result |
| --- | --- |
| Repository cleanup | Root `npm run setup` and `npm test` pass after the folder moves. SQL, original Word/PDF documents and UI assets match their original Git blobs. Runtime paths and local documentation links were checked. |
| Node runtime | 24.22.1 |
| `node frontend/tests/check-workflows.mjs` | 34/34 passing |
| `npm test` from `backend` | 40/40 passing using PGlite 0.5.11 |
| Actual selected UI API adapter | Executed in a minimal DOM against the live test Express HTTP server; signed in, searched, reviewed/confirmed registration and renewal, changed selected plans and rejected an edited plan before a new review; zero private localStorage writes. |
| Migration | Fresh schema through `06_payment_previews.sql` and additive upgrade with existing synthetic member/payment rows tested; legacy data retained without fabricated snapshots/photos. |
| Existing SQL smoke suite | Pass against the migrated 01/02/04/05/06 application schema; all synthetic rows roll back. |
| Server payment previews | Staff-only, read-only terms; database calendar date; shared SQL expiry function; all preview fields checked; date/name/price/duration/member/expiry conflicts rejected without recording cash. |
| Concurrent HTTP confirmations | Same request returns one payment; competing stale previews produce one acceptance and one conflict. PGlite serializes its one connection; native multi-connection locking remains to verify. |
| `npm audit --omit=dev --audit-level=moderate` | Zero reported vulnerabilities at validation time. |
| JavaScript syntax / `git diff --check` | Pass |

Not completed here: native PostgreSQL server tests, pg_dump/pg_restore execution, rendered mobile/browser/keyboard review, representative network/load timing, trained-staff usability, scheduled weekly backups, production HTTPS/availability and client policy approval. This run used the embedded PostgreSQL engine for SQL/API verification. The Playwright package was available, but its Chromium executable was not installed, so the attempted browser check did not run. No rendered browser/device result is claimed.

The proposed inclusive expiry convention, 15-minute lock/idle defaults, actual hours, minors/ID procedures and optional automatic closing still require client sign-off. See [ACCEPTANCE.md](ACCEPTANCE.md); open checks are not certified by this record.
