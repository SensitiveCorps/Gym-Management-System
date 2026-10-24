# Frontend

The team's selected interface uses HTML, CSS and JavaScript. It includes public, member, staff and manager screens, with the blue-and-yellow gym design. There is no frontend package installation or build step.

## Files

| File | Purpose |
| --- | --- |
| [public/index.html](public/index.html) | Page markup, styles, UI handlers and the synthetic standalone demo. |
| [public/server-bridge.js](public/server-bridge.js) | Connects the selected UI to the Express API. The backend injects this file at runtime. |
| [tests/check-workflows.mjs](tests/check-workflows.mjs) | UI workflow checks using a minimal DOM and synthetic browser storage. |

`public/` is maintained source, not generated output. The earlier Gymflow prototype remains in Git history.

## Full application

Follow the [backend setup](../backend/README.md) or [root quick start](../README.md#run-the-application-in-vs-code). Express serves this interface at [http://localhost:8000](http://localhost:8000) with shared PostgreSQL records, server sessions, role checks and protected photos.

Registration and renewal use **Review payment**, then **Confirm payment**. The displayed terms come from the server and are checked again before saving. Private application records are not written to demo localStorage.

## Standalone demo

For an interface demonstration without PostgreSQL, run this from the repository root in PowerShell:

```powershell
py -m http.server 8001 --directory frontend/public
```

On macOS/Linux:

```bash
python3 -m http.server 8001 --directory frontend/public
```

Open [http://localhost:8001](http://localhost:8001). Keep the terminal running. Port 8001 allows the demo to run alongside the full application on port 8000.

### Demo sign-ins

| Role | Login | Password |
| --- | --- | --- |
| Manager | `manager` | `manager123` |
| Staff | `vusi` or `nelisiwe` | `staff123` |
| Member | Student ID, `202301234` | `member123` |

Choose the corresponding sign-in tab. These credentials belong to the standalone demo only. It stores synthetic records and sample passwords in browser localStorage; use fictional data. Reloading retains that browser's demo data.

## Checks and requirements

From the repository root, run:

```bash
npm run test:ui
```

The checks execute the real interface's handlers with a minimal DOM; they do not replace rendered browser, keyboard or phone testing. The API suite also exercises the real adapter against the HTTP server.

See the [implementation checklist](../docs/IMPLEMENTATION.md), [SRS](../docs/SRS.md), [validation record](../docs/VALIDATION.md) and [remaining acceptance checks](../docs/ACCEPTANCE.md). Account suspension retains member/payment/visit history and remains separate from paid subscription validity. The inclusive expiry convention still requires client sign-off; the Monthly shortcut means 30 days.
