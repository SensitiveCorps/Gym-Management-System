# Gym Management System interface

A buildless, interactive interface for the Gym Management System software engineering project. The visual design uses a green workspace, restrained typography and clear attendance and membership states.

## Included workflows

- Front-desk overview, searchable members and member details.
- Member registration with a sample identity photo and initial cash receipt.
- Cash renewals with unique receipt validation and payment-derived expiry.
- Photo-confirmed entry, one open visit per member, refused-entry records and staff checkout.
- Manager-only notice publication/cancellation, weekly hours, date overrides and an audit trail.
- Public current/upcoming notices and resolved opening hours.
- Member membership summary and own recent visits.
- Attendance reports, CSV export and printable cash receipts.

The business-flow baseline is the revised Gym Management System diagrams version 3.0, dated 18 October 2026. The inclusive expiry arithmetic and receipt-number policy remain proposed. Closing-time automatic checkout is optional in the source and is not enabled in this interface.

## Scope

This is a browser-local prototype with clearly labelled sample data. Role preview is for demonstration, not authentication. Production sign-in, protected identity-file storage and a shared database are not connected. Sample passwords used for registration are discarded rather than retained. Do not use real personal information in the prototype.

The member and public views do not render identity photographs. Reports exclude photographs. Front-desk and manager actions are guarded by the demo model as well as the visible controls; production authorization would need server enforcement.

## Run the interface locally

No dependency installation or build step is required. With Python 3 installed, run the following from the repository root:

```bash
cd GMS/UI
python3 -m http.server 8000 --directory dist
```

Open [http://localhost:8000](http://localhost:8000). Keep that terminal running while you explore. Use **Preview as** to switch between Front desk, Manager, Member and Public visitor. Do not open `index.html` directly as a local file: the JavaScript modules require an HTTP server.

To run the checks, use Node.js 18 or later from `GMS/UI` in another terminal:

```bash
node tests/check-workflows.mjs
```

The tests use Node's built-in modules and require no npm installation. The original hosted Site configuration and Git metadata are excluded from this folder.

## Files

- `dist/index.html`: application entry.
- `dist/styles.css`: responsive styles and print layout.
- `dist/model.mjs`: state, transactions, rules and data derivation.
- `dist/app.js`: views and interaction handling.
- `tests/check-workflows.mjs`: focused model and template checks.

Run checks with Node:

```sh
node tests/check-workflows.mjs
```

All assets are local. There is no build step. The hosting manifest declares `dist` as the static output directory.

Browser visual QA was unavailable in the managed environment; functional model checks, executed UI templates and routing checks were used instead.

