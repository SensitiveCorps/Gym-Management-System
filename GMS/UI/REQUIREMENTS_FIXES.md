# Selected UI: requirements fixes

Baseline: the team's `Gym Management System_1.html`, [SRS v1.1](../Docs/SRS.md), [Project Plan v3.0](../Docs/PROJECT_PLAN.md) and existing PostgreSQL model. The chosen design is retained. The SRS decisions marked PENDING remain proposed.

| Step | Result | Verification/status |
| --- | --- | --- |
| 1 — Retention | Permanent member deletion replaced by reversible suspension. Identity/photo, payment, visit and denial history remain linked. Account status is separate from paid validity. | Implemented in demo and API; database guards retain history. |
| 2 — Privacy/entry | Reports use internal references and initials; no full IDs/photos. A missing stored photo cannot be bypassed with a confirmation flag. | UI and API privacy/entry tests pass. |
| 3 — Plans/cash | Nonnegative prices and integer days validated; Daily/Weekly/Monthly shortcuts; retirement; no-plan states; preserved price/name/duration terms. Registration/payment atomic; request/receipt retries safe; stale previews rejected. | UI and PostgreSQL-engine/API transaction checks pass. |
| 4 — Dates/actors | Latest confirmed payment determines membership. Checkout records time/exit actor. New payments retain time, receipt and purchased terms. Gym timezone fixed. Inclusive arithmetic matches the proposed SQL policy. | Boundary tests pass; D07 client sign-off remains pending. |
| 5 — Member editing/passwords | Authorized name/ID/photo editing with duplicate protection. Member-chosen registration password; temporary resets revoke sessions and force a different password. | UI and API checks pass; physical ID verification is a staff task. |
| 6 — Notices/hours | Member upcoming notices; seven-day gym/area schedules; scoped date overrides; gym closure precedence; immutable author metadata and append-only audits. | UI and API checks pass. Actual hours still need client confirmation. |
| 7 — Errors/accessibility | Failed demo saves roll back; API errors surfaced; action guards; modal focus cycle/Escape/return; narrow-layout rules; booking wording removed. | Logic tests pass. Rendered keyboard/phone/browser checks remain unverified. |
| 8 — Connected backend | Express/PostgreSQL API, Argon2id hashes, HttpOnly sessions, CSRF/origin checks, idle expiration, role/ownership checks, protected decoded photos, atomic/idempotent transactions and histories. Selected design connected through an API adapter. | 35 automated HTTP/SQL integration checks pass using PGlite, plus 34 UI checks. Native PostgreSQL and production deployment still require verification. The proposed React port is not performed. |
| 9 — Acceptance/operations | Optional AUTO checkout; backup and guarded restore tooling; documented API and acceptance procedures. | Automation code implemented. Native PostgreSQL, actual backup/restore, Chrome/Firefox/Edge, representative phone/network/load, trained-staff usability, production HTTPS/availability and client-policy sign-off remain open. |

## Data compatibility

Demo data retains `gms-demo-v3` and existing expiry snapshots; no reset or retrospective financial rewrite is required. The server migrations are additive and preserve history. Existing immutable database payments without name/duration snapshots are labelled legacy rather than assigned current catalogue terms. Existing placeholder photo paths require an authorized upload before entry.

## Run and verify

- [Standalone demo and UI checks](README.md)
- [Connected application setup](../Server/README.md)
- [API contract](../Server/API.md)
- [Acceptance evidence and outstanding checks](../Server/ACCEPTANCE.md)

All checks use synthetic data. Passing code tests does not approve the gym's expiry, operating-hours, minor-ID, lock/idle, closing-time or pilot-hosting policies.
