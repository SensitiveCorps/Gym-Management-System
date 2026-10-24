# Contributing

This is a four-person course project. Work on a focused branch and open a pull request for another team member to review.

## Set up once

Follow the [root README](README.md#run-the-application-in-vs-code). Run all commands below from the repository root.

```bash
npm run setup
npm test
```

`npm run setup` installs the backend's locked dependencies. The frontend is plain HTML/CSS/JavaScript and has no package installation or build step.

## Find the right file

| Change | Location |
| --- | --- |
| HTTP routes and session handling | [backend/src/app.mjs](backend/src/app.mjs) |
| Registration, renewals and manager commands | [backend/src/actions.mjs](backend/src/actions.mjs) |
| Payment previews and confirmation validation | [backend/src/payments.mjs](backend/src/payments.mjs) |
| Password, input and photo validation | [backend/src/security.mjs](backend/src/security.mjs) |
| Data returned to each role | [backend/src/state.mjs](backend/src/state.mjs) |
| Database connection and transactions | [backend/src/database.mjs](backend/src/database.mjs) |
| Session cleanup and optional automatic checkout | [backend/src/maintenance.mjs](backend/src/maintenance.mjs) |
| UI markup, styles and standalone demo behavior | [frontend/public/index.html](frontend/public/index.html) |
| UI requests to the backend | [frontend/public/server-bridge.js](frontend/public/server-bridge.js) |
| Schema, SQL workflows and migrations | [database/](database/README.md) |
| Requirements, design and acceptance evidence | [docs/](docs/README.md) |

The backend injects the API adapter into the selected HTML at runtime. Keep its `/* ---------- events ---------- */` injection marker when editing the interface. `frontend/public/` contains maintained source files, not generated build output.

## Before opening a pull request

1. Run `npm test`; include the result and any unverified behavior in the PR description.
2. Update the [API contract](docs/API.md) if a request or response changes.
3. Add a new numbered SQL migration for database changes; preserve already recorded migrations and historical data.
4. Update requirements, plan and acceptance evidence together when a client-approved business rule changes. Keep pending decisions labelled as pending.

Keep `.env`, database backups, dependencies, real member IDs and member photos out of commits. Use synthetic data for tests and demonstrations. Commit dependency changes with `backend/package-lock.json`.

## Review workflow

Use branch names such as `feat/member-search`, `fix/payment-preview` or `docs/setup-guide`. Describe the problem, resulting behavior and checks in the pull request. Merge only after the team has reviewed the change.
