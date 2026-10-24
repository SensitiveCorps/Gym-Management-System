# Selected UI: requirements fixes

Baseline: the team's `Gym Management System_1.html`, reviewed against [SRS v1.1](../Docs/SRS.md), [Project Plan v3.0](../Docs/PROJECT_PLAN.md) and the existing PostgreSQL logic. The SRS and client decisions marked PENDING remain proposed. Preserve the chosen design and make small, independently verifiable changes.

## Ordered checklist

| Step | Scope and acceptance evidence | Status |
| --- | --- | --- |
| 1 | Replace member deletion with suspension; retain identity/photo/payment/visit/denial history; keep subscription dates separate; support re-enable; reject suspended entry. Verify single/bulk operations, cancellation, permissions, reload and failed persistence. `FR-MEM-09`, `FR-HIS-01`, suspension portion of `FR-HIS-03`. | Implemented in the browser prototype; 16 checks pass. Server enforcement remains part of step 8. |
| 2 | Remove photos and complete identity numbers from reports. Refuse successful check-in when a photo is absent; log `PHOTO_NOT_CONFIRMED`. Test every report variant, own member/public views and direct check-in handler invocation. `NFR-06`, `FR-CHK-02–03`. | Next |
| 3 | Validate saleable plans before registration/renewal; prevent partial member saves; reject invalid prices/durations rather than silently rounding/clamping; preserve purchased terms. Add daily/weekly/monthly shortcuts if useful, with stored duration shown in days. Exercise no plans, stale selection and duplicate receipts. `FR-PLN`, `FR-PAY-01–07`. | Pending |
| 4 | Record checkout actor and time. Align payment timestamp/snapshots, latest-confirmed-payment selection, timezone and boundary arithmetic with the approved expiry policy. Test expiry-day, renewal and month/year boundaries. D07 remains pending; do not silently approve it. `FR-CHK-08`, `FR-PAY-05–07`, `FR-MEM-06`, `NFR-13`. | Pending |
| 5 | Add permitted member-detail editing, safe photo replacement and validation. Use member-chosen passwords or a forced first-login reset for temporary passwords. Exercise duplicate identity and reset behavior. `FR-MEM-03–07`, `FR-AUT-08–09`. | Pending |
| 6 | Show upcoming notices on the member home. Support gym/area dated hours, override precedence and configurable weekly closed days, preserving the current schedule until the client confirms it. Retain append-only notice/hours audit events with actor/time. `FR-NOT-01–07`, `FR-POR-02`. | Pending |
| 7 | Surface failed saves across all workflows; add consistent action-level demo guards and understandable errors. Check modal keyboard operation and 360px layout. Remove booking wording because reservations are outside scope. `FR-AUT-07`, `NFR-07–09`. | Pending |
| 8 | Connect the selected design to the planned React/Express/PostgreSQL application: server sessions, password hashes, staff role enforcement, member ownership, protected photos, transactional/idempotent cash registration and renewal, immutable histories and authenticated actors. Test unauthorized requests and retry/interruption handling against PostgreSQL. Browser guards alone cannot close these requirements. | Pending: repository currently has database SQL and UI prototypes, no running API. |
| 9 | Run SRS AT-01–18 and NFR evidence: Chrome/Firefox/Edge, phone, performance/load, HTTPS, backup/restore and concurrency. Add idle logout and automatic closing checkout according to approved policy/Should priority. Confirm hours, minor-ID, lock/idle and expiry decisions with the client. | Pending |

## Scope of step 1

The selected UI replaces the earlier prototype at `dist/index.html`; there is one active UI entry point. Old source remains in Git history. No database migration is required for this browser-prototype change; the existing SQL already prohibits ordinary hard deletion.

The existing `gms-demo-v3` key and version are unchanged. Optional `memberStatusLog` data is added only when a status actually changes. A suspension does not automatically close a visit, change paid expiry, remove a member from paid dashboard totals, or delete historical entries. Existing suspended accounts receive no invented historical events.

Verification: `node tests/check-workflows.mjs` from `GMS/UI`, 16/16 passing. The suite executes the real inline application script in Node's VM with synthetic state and a minimal DOM. It does not establish production security or visual/cross-browser acceptance. Other review defects are intentionally tracked as open above.
