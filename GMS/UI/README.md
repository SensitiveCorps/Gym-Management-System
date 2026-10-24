# Gym Management System interface

This folder now uses the team's selected interface from `Gym Management System_1.html`. Its blue-and-yellow design, public page and staff, manager and member screens are retained. The earlier Gymflow prototype is available in Git history.

## Run in VS Code

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

## Step 1: preserve member history

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

The 16 checks execute the actual selected UI script and handlers with a minimal DOM and isolated synthetic storage. They cover single/bulk suspension, cancellation, retention, re-enable, check-in denial, role guards, reload compatibility and failed persistence.

These checks verify this step's behavior; they are not full acceptance or visual browser testing.

## Remaining work

See [REQUIREMENTS_FIXES.md](REQUIREMENTS_FIXES.md) for the ordered checklist. Report privacy, photo verification, plan validation, payment atomicity, date-policy alignment, member editing, notices/hours auditing and production API integration remain open.

The selected interface is still one standalone HTML file with embedded CSS/JavaScript and a background image. Google Fonts is optional; local fallback fonts are defined. A shared database, secure password hashing, server authorization and protected photo storage have not been connected. Browser role checks do not provide server security.

