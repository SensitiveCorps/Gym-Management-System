# API contract

All routes are same-origin. Responses use JSON except `/` (selected UI) and the protected JPEG photo route. Errors have `{ "error": "readable message" }` with 400 validation, 401 expired/missing session, 403 forbidden, 404 missing record or 409 conflict. Internal SQL, passwords, hashes and private storage paths are not returned.

## Sessions and reads

| Route | Access | Contract |
| --- | --- | --- |
| `POST /api/login` | Public, rate limited | `{role, username, password}` for staff/manager or `{role:"member", idType, idNum, password}`. Sets HttpOnly session cookie; returns `{session:{role,id},csrf}`. ID type labels match the UI. |
| `POST /api/logout` | Signed in + CSRF | Ends the current session and staff presence record. |
| `GET /api/state` | Role projected | Returns `{state,session,csrf}`. Anonymous: public information only. Member: own masked record/history only. Staff: current open visits, own account and addressed messages; use bounded search/detail routes for other members. Manager: management data. No credentials are returned. |
| `GET /api/public` | Public | Public information without refreshing an authenticated idle timer. |
| `GET /api/members?q=...` | Staff/manager | Name or ID search, at most 50 matches with current payment snapshots. |
| `GET /api/members/:id` | Staff/manager; member self only | Member data and permitted payment/visit history. A temporary-password member must change it first. |
| `GET /api/payments/preview?planId=...&memberId=...` | Staff/manager | Read-only payment preview using the gym database date. Omit `memberId` for registration. Returns the complete `expected` object below; creates no member/payment. |
| `GET /api/members/:id/photo` | Staff/manager | Protected JPEG, `Cache-Control: no-store`; members/public are denied. |
| `GET /api/manager/reports` | Manager | Internal member reference, names, paid status/expiry/days. Omits document IDs and photographs. |
| `GET /api/manager/dashboard` | Manager | Database-derived summary, weekly accepted visits and monthly accepted visits. |

Staff/manager session IDs are derived from the server cookie on every protected request. Supplying an actor, role, amount or expiry in an action body does not grant authority or override the database calculation.

## Commands

Use `POST /api/actions/:action` with JSON, the session cookie, `X-CSRF-Token` and a unique `Idempotency-Key` (16–100 ASCII letters/digits/hyphens). Retry an uncertain response using the **same key and identical body**. A successful result is stored in the same transaction as its changes. Reusing a key for different input is rejected. Financial receipt uniqueness is also enforced independently of the key.

| Action | Roles | Body |
| --- | --- | --- |
| `register` | Staff/manager | `first,sur,idType,idNum,password,photo,plan,receipt,expected` |
| `renew` | Staff/manager | `id,plan,receipt,expected` |
| `checkin` | Staff/manager | `memberId` (nullable for unknown), `entered,confirmed` (boolean). Returns `accepted,checkin_id,denial_id,reason`. |
| `checkout` | Staff/manager | `id` (member's open visit); actor is taken from the session. |
| `memberedit` | Staff/manager | `id,first,sur,idType,idNum,photo` (nullable means retain existing protected photo). |
| `memberstatus` | Staff/manager | `ids` array, `enabled` boolean; `inactiveOnly:true` requires manager and rechecks inactivity. |
| `plans` | Manager | `plans:[{id,name,price,days,on}]`; temporary new IDs use `p` plus digits. Used plans are retired via `on:false`. |
| `mempw` | Manager | `id,password`; forces a member password change and revokes sessions. |
| `changepw` | Member | `current,password,confirm`; allowed during a forced password change. |
| `newstaff` | Manager | `name,username,password` |
| `staffedit` | Manager | `username,newUsername,name`; roles cannot be changed here. |
| `staffreset` | Manager | `username,password`; invalidates prior sessions. |
| `stafftoggle` | Manager | `username`; staff enable/disable only. |
| `hours` | Manager | `scope` (service ID or null), `week:[{closed,open,close}]`, exactly seven entries Monday–Sunday. |
| `override` | Manager | `scope,date,closed,open,close,reason`; date `YYYY-MM-DD`, time `HH:mm`. |
| `overridecancel` | Manager | `id`; retains the override and audit trail. |
| `notice` | Manager | Optional `id`, `scope,message,start,end`; optional title defaults to the message's opening text. |
| `noticecancel` | Manager | `id`; retains the notice and audit trail. |
| `contact` | Manager | `address,phone,email` |
| `service` | Manager | `service:{id,name,desc,tag,art,photo,on,instructors:[{name,role}],slots:[{days,start,end}]}`; days 0–6 = Monday–Sunday. New IDs use `s` plus digits. |
| `staffmsg` | Manager | `to` username or `all`, `message` |
| `messagecancel` | Manager | `id`; retains the row. |
| `readmessages` | Staff/manager | `{}`; marks only the authenticated actor's addressed messages read. |

For a new sale, first request `GET /api/payments/preview?planId=...` (registration) or add `&memberId=...` (renewal). Display its response to staff, then send that complete object as `expected` on confirmation:

```json
{
  "planId": "1",
  "planName": "Monthly",
  "price": 250,
  "days": 30,
  "memberId": null,
  "paymentDate": "2026-10-24",
  "expiryBefore": null,
  "expiryAfter": "2026-11-22"
}
```

Record IDs are strings; dates are `YYYY-MM-DD` in `Africa/Mbabane`. For renewals, `memberId` is the selected member's string ID and `expiryBefore` is their last confirmed payment's expiry (or null). Previewing does not reserve terms or record cash. Preview and confirmation use the same SQL function, `calculate_membership_expiry`.

The API recomputes and compares **every field** under member/plan locks before recording new cash. Missing preview fields return 400. Changed plan name/price/duration, member scope, payment date or expiry returns 409 with no partial records; fetch and display a new preview and explicitly confirm again. Older three-field previews are rejected. The connected UI provides **Review payment**, followed by **Confirm payment**, and keeps entered member details when a preview expires. Use a fresh request key after changing the payload. A retry of an already recorded receipt returns its original result even if the plan has since been retired.

Photos are JPEG/PNG/WebP data URLs, maximum decoded upload 2 MB and 40 million input pixels. The server decodes and normalizes them to JPEG. Passwords are 8–256 characters, stored as Argon2id hashes. Prices are nonnegative with at most two decimals; durations are whole days, 1–3650. The UI's Monthly shortcut means **30 days**, not a calendar-month billing rule.

Read state is a view model, never an accepted write payload. Manager public-status changes append audit events; ordinary API routes cannot hard-delete members or mutate confirmed financial/attendance/denial histories.
