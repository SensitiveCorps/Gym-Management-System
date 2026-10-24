# Gym Management System interface

This folder now uses the team's selected interface from `Gym Management System_1.html`. Its blue-and-yellow design, public page and staff, manager and member screens are retained. The earlier Gymflow prototype is available in Git history.

## Run the standalone demo in VS Code

No package installation or build step is required. From the repository root, run this in a PowerShell terminal:

```powershell
cd GMS/UI
py -m http.server 8000 --directory dist
```

Open [http://localhost:8000](http://localhost:8000). Keep that terminal running. If your terminal is already in `GMS/UI/dist`, run `py -m http.server 8000` there instead; do not append `GMS/UI` again.

On macOS/Linux, use `python3` instead of `py`.

### Synthetic demonstration accounts

| Role | Login | Password |
| --- | --- | --- |
| Manager | `manager` | `manager123` |
| Staff | `vusi` or `nelisiwe` | `staff123` |
| Member | Student ID, `202301234` | `member123` |

Choose the matching sign-in tab. These are browser-local demo accounts, not production authentication. The prototype stores sample records and passwords in localStorage; use synthetic data only.

## Connected application

To use shared PostgreSQL data, real server sign-in, protected photos and enforced staff/member permissions, follow [GMS/Server setup](../Server/README.md). It serves this same selected design at localhost:8000. It needs Node.js and a configured local PostgreSQL database; the Python command above runs only the synthetic demo.

New UI controls include report privacy, required-photo entry, validated plans with Daily/Weekly/Monthly shortcuts, unavailable-plan empty states, atomic demo saves, member editing/photo replacement, forced temporary-password change, checkout attribution, upcoming notices, gym/area weekly hours and date overrides, and retained notice/hours audits.

In connected mode, registration and renewal use **Review payment**, followed by **Confirm payment**. The preview comes from the server and uses the database date and shared expiry function; changed terms require a new review. The standalone demo calculates its own preview using the same proposed inclusive policy. Existing purchased dates are not rewritten. The client still needs to approve D07; Monthly is explicitly 30 days.

## Retained member history

Requirements: [SRS](../Docs/SRS.md) `FR-MEM-09`, `FR-HIS-01` and the suspension portion of `FR-HIS-03`.

- Inactive-member deletion has been replaced by confirmed single/bulk account suspension.
- Members, photos, payment receipts, visits and denied attempts remain linked and searchable.
- Authorized staff can suspend or enable from Members; inactive-page bulk actions are manager-only.
- Account access remains separate from payment-derived plan, expiry and paid-member dashboard totals.
- Suspended check-in attempts create a `SUSPENDED` denial and no visit.
- Account changes record their actor and timestamp in the member detail history.
- Status changes are published in memory only after their complete browser-storage write succeeds. A failed write shows an error and leaves the prior state intact.
- Existing `gms-demo-v3` records load without a reset or a required status-history field.

The existing `active` boolean is retained for compatibility: true means account enabled and false means suspended. Subscription validity is still derived from payments. Records already removed by an older copy cannot be recovered by this update.

## Verification

From `GMS/UI`, with Node.js 18 or later:

```bash
node tests/check-workflows.mjs
```

The 34 checks execute the actual selected UI script and handlers with a minimal DOM and isolated synthetic storage. They cover retention, suspension/re-enable, privacy, missing photos, plan validation, failed/partial saves, cash snapshots, expiry boundaries, member edits, temporary passwords, notice audits and override precedence. The API suite adds 35 HTTP/database checks, including the actual UI adapter.

These checks verify this step's behavior; they are not full acceptance or visual browser testing.

## Verification still needed

See [REQUIREMENTS_FIXES.md](REQUIREMENTS_FIXES.md) for implemented steps and [the acceptance checklist](../Server/ACCEPTANCE.md) for native PostgreSQL, backup/restore, browser/device, performance, staff usability and client-policy evidence still to collect. These are not marked complete by the automated tests.

The standalone demo still stores synthetic passwords in localStorage. The connected application bypasses that storage and uses server sessions and Argon2id password hashes; private server records are never copied to demo storage. Google Fonts is optional and local fallback fonts are defined.
