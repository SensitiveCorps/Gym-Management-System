# Gym Management System

A web application for the University of Eswatini gym, developed by a four-person team for **Practices in Software Engineering II (CSC491)**.

Staff register members, verify entry against protected photos, and record cash payments and visits. Managers maintain plans, accounts, notices and hours. Members can view their own subscription, while visitors can check public gym information.

## Start here

| I want to… | Guide |
| --- | --- |
| Run the full application | [Backend setup](backend/README.md) |
| Preview the interface without a database | [Standalone UI demo](frontend/README.md#standalone-demo) |
| Understand the requirements and design | [Documentation index](docs/README.md) |
| Work on the project | [Contributing guide](CONTRIBUTING.md) |
| Use the API | [API contract](docs/API.md) |
| Check what has been tested | [Validation record](docs/VALIDATION.md) and [acceptance checklist](docs/ACCEPTANCE.md) |

## Repository layout

| Folder | Contents |
| --- | --- |
| [backend/](backend/README.md) | Express API, authentication, business workflows, database connection, scripts and integration tests. |
| [frontend/](frontend/README.md) | Selected HTML/CSS/JavaScript interface, API adapter and UI tests. No frontend build step is required. |
| [database/](database/README.md) | Numbered SQL migrations, optional demo seed, database relationships and SQL smoke tests. |
| [docs/](docs/README.md) | Requirements, project plan, API reference, acceptance evidence, diagrams and original Word documents. |

The application uses **Node.js, Express and PostgreSQL**. The backend serves the same interface that is available as a standalone demo.

## Run the application in VS Code

Install **Node.js 22+** and **PostgreSQL 14+**, then create an empty local database named `gym_management_system` using pgAdmin or `createdb`.

Open the repository root in VS Code. In a PowerShell terminal, run:

```powershell
npm run setup
Copy-Item backend/.env.example backend/.env
```

Edit `backend/.env` and set `DATABASE_URL` to your local PostgreSQL connection. Then, still from the repository root:

```powershell
npm run migrate
npm run create-manager -- manager "Gym Manager"
npm start
```

The manager command prompts for a password. Open [http://localhost:8000](http://localhost:8000), select **Manager**, and sign in with that account. There are no built-in accounts in the full application.

On macOS/Linux, use `cp backend/.env.example backend/.env` for the copy step. See [backend setup](backend/README.md) for existing databases, configuration, backups and troubleshooting.

If updating an existing clone, follow the [folder migration notes](docs/README.md#updating-an-existing-local-checkout) to carry over private configuration and backup settings.

## Run the checks

After `npm run setup`, run this from the repository root:

```bash
npm test
```

This runs the UI checks and API integration tests. The API tests use an isolated embedded PostgreSQL engine by default, so they do not need your application database.

| Command | Purpose |
| --- | --- |
| `npm run test:ui` | Run the selected interface's workflow checks. |
| `npm run test:api` | Run the HTTP/database integration tests. |
| `npm run migrate` | Apply database migrations using `backend/.env`. |
| `npm start` | Start the application using `backend/.env`. |

## Project status

The selected interface and connected backend are implemented. The automated checks cover accounts, privacy, registration, plans, payment previews and renewals, attendance, notices, hours and retained histories.

Native PostgreSQL concurrency checks, rendered browser/device acceptance, production deployment and client policy approvals remain open. The inclusive membership expiry convention is still proposed; see the [acceptance checklist](docs/ACCEPTANCE.md) for the outstanding decisions.

The standalone UI demo uses synthetic browser-local data and separate demonstration credentials. Use the full application for shared database records and server-enforced authentication.

## License

The team has not selected a license yet.
