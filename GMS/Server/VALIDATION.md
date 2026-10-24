# Validation record — 24 October 2026

Synthetic data only. No user database, production deployment or live member records were changed.

| Check | Result |
| --- | --- |
| Node runtime | 24.22.1 |
| `node GMS/UI/tests/check-workflows.mjs` | 34/34 passing |
| `npm test` from `GMS/Server` | 35/35 passing using PGlite 0.5.11 |
| Actual selected UI API adapter | Executed in a minimal DOM against the live test Express HTTP server; signed in, searched and registered through the API; zero private localStorage writes. |
| Migration | Fresh schema and additive upgrade with existing synthetic member/payment rows tested; legacy data retained without fabricated snapshots/photos. |
| Existing SQL smoke suite | Pass against both the base 01/02 schema and the migrated 01/02/04/05 application schema; all synthetic rows roll back. |
| Concurrent HTTP confirmations | Same request returns one payment; competing stale previews produce one acceptance and one conflict. PGlite serializes its one connection; native multi-connection locking remains to verify. |
| `npm audit --omit=dev --audit-level=moderate` | Zero reported vulnerabilities at validation time. |
| JavaScript syntax / `git diff --check` | Pass |

Not completed here: native PostgreSQL server tests, pg_dump/pg_restore execution, rendered mobile/browser/keyboard review, representative network/load timing, trained-staff usability, scheduled weekly backups, production HTTPS/availability and client policy approval. The managed test environment maps only OS UID 0; native PostgreSQL initialization requires a non-root OS user, so native initialization could not run. The embedded PostgreSQL tests were used for SQL/API verification instead.

The proposed inclusive expiry convention, 15-minute lock/idle defaults, actual hours, minors/ID procedures and optional automatic closing still require client sign-off. See [ACCEPTANCE.md](ACCEPTANCE.md); open checks are not certified by this record.
