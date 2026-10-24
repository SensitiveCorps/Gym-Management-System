# Acceptance evidence and remaining checks

The [SRS](../Docs/SRS.md) remains proposed. Automated regression tests establish the behavior described below; they do not approve client policies or certify an unseen production deployment.

## Automated coverage

| SRS test | Evidence in repository |
| --- | --- |
| AT-01 | API role checks for manager commands, reports/dashboard; disabled staff and password-reset session invalidation. |
| AT-02 | Member identity/password login, five-failure lock and reset. |
| AT-03 | Required identity/photo, image decoding, duplicate identity/receipt rollback, protected bytes/hash. Physical ID inspection remains a staff task. |
| AT-04 | Latest confirmed payment, separate suspension, retained records and database mutation guards. |
| AT-05 | Plan input validation, availability, name/price/duration snapshots and UI duration shortcuts. |
| AT-06 | Proposed inclusive boundary examples, renewal stacking, a shared SQL calculation for server previews/confirmation, and rejection of stale dates, plan/member scope and expiry. The connected UI requires review before confirmation. Acceptance awaits D07. |
| AT-07 | Atomic registration rollback; same request/receipt retry; conflicting receipts and concurrent HTTP confirmation. |
| AT-08–10 | Required stored photo, explicit authenticated confirmation, all denial categories, one open visit, manual checkout actor/time. |
| AT-11 | UI expiry-day and under-ten-days calculation; warning components are exercised by the real templates. |
| AT-12–13 | Upcoming publication, notice edit/cancel audit, all seven days, gym/area overrides, whole-gym closure precedence. |
| AT-14 | Own-record API projection, cross-member denial, protected photo denial and report/public masking. Phone use still needs device evidence. |
| AT-15 | SQL dashboard/visit views, preserved paid totals during suspension and exclusion of denials from check-in tables. Seed-count acceptance on the approved demo dataset remains a team check. |
| AT-16 | Responsive rules and keyboard handling implemented; representative phone/network, performance and trained-user evidence remain open. |
| AT-17 | Transaction/retry integration checks, HTTPS enforcement, backup/restore tooling, API documentation and PR review. Deployment, weekly scheduling and observed availability remain open. |
| AT-18 | Idle expiration and optional AUTO checkout implemented/tested; plan retirement and masked IDs are included. Closing-time policy remains opt-in. |

Commands:

```powershell
node ../UI/tests/check-workflows.mjs
npm test
```

The API tests use actual PostgreSQL SQL/functions/triggers through PGlite by default. They also support a disposable native PostgreSQL database through `TEST_DATABASE_URL`, including actual multi-connection transaction/locking checks. The UI adapter test runs the selected UI script against the live test HTTP API with a minimal DOM; this is not a rendered browser test.

## Human/device evidence to collect

| Check | Procedure | Evidence needed |
| --- | --- | --- |
| Chrome/Firefox/Edge | Register, renew, verify photo, deny entry, check out, edit plan, change hours/notice and open own member portal. | Browser/OS versions, date, results and any screenshots. |
| 360px and phone | Open public and member views at 360px and on the agreed representative phone. Operate navigation and inspect all messages without losing actions. | Device, viewport, browser, result. |
| Keyboard | Open/close dialogs, cycle Tab/Shift+Tab, use Escape and check returned focus. Include photo/edit/renew dialogs and password reset. | Focus order and observed result. |
| Public load | Record a cold load on the agreed phone/network profile. | Three or more timings; target under 3 seconds. |
| Desk load | Five staff sessions, 50 lookups/minute including matching photo retrieval. | Dataset size, network, concurrent users and search-to-photo timings; target under 2 seconds. |
| Staff usability | Give a new tester about 15 minutes of guidance; ask them to register and admit a synthetic member. | Task completion, time, errors and assistance required. |
| Native PostgreSQL | Run `npm test` with a disposable `TEST_DATABASE_URL`; repeat retry/concurrency checks on the target database version. | Database/Node versions and saved test output. |
| Backup/restore | Run the provided utilities against a separate test database; compare source/restored counts. | Date, protected backup location, restored counts and responsible person. |
| Hosting | Use the production configuration behind TLS; test HTTP rejection, secure cookies, outage handling and operating-hours availability. | Host, certificate, observed checks and agreed support plan. |

## Pending client decisions

- D07: approve the inclusive day-counting examples, then update the SRS and `EXPIRY_POLICY_APPROVED` deliberately. If another rule is approved, change SQL/preview/tests together.
- Confirm gym and area hours, Sunday openings, minor/guardian requirements and accepted ID procedures.
- Confirm the 15-minute lock/idle defaults and whether AUTO checkout is in the release scope.
- Agree the phone/network test profile, pilot hosting, backup ownership and availability plan.

Do not mark these rows passed merely because code exists. No production deployment or client sign-off has been performed by this change.
