# Documentation

Start with the [project README](../README.md) to run the application. This folder groups requirements, implementation references and original course documents.

## Requirements and design

| Document | Purpose |
| --- | --- |
| [SRS.md](SRS.md) | Current readable requirements baseline, use cases, business rules and acceptance criteria. Pending client decisions remain marked. |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | Proposed project plan, team responsibilities, milestones, risks and approvals. |
| [Database relationships](../database/ERD.md) | Overview of the base database model; SQL migrations define the full application schema. |
| [Revised ER/UML diagrams](source-documents/Gym_Management_System_Diagrams_Revised.docx) | Revised design document for team/client review. |

## Implementation and verification

| Document | Purpose |
| --- | --- |
| [API.md](API.md) | Sessions, read routes, role restrictions, commands and payment preview contract. |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Requirements fixes implemented in the selected UI and API. |
| [VALIDATION.md](VALIDATION.md) | Recorded automated check results and their limits. |
| [ACCEPTANCE.md](ACCEPTANCE.md) | Requirements coverage, remaining device/deployment checks and client decisions. |
| [Contributing](../CONTRIBUTING.md) | Code map, development commands and review workflow. |

## Original documents and diagrams

Original Word files are preserved in [source-documents/](source-documents/):

- [Project plan v2](source-documents/Gym_Management_System_Project_Plan_v2.docx)
- [Original SRS](source-documents/Gym_Management_System_SRS.docx)
- [Software design document](source-documents/Gym_Management_System_SDD.docx)
- [Original diagrams](source-documents/Gym_Management_System_Diagrams.docx)
- [Revised diagrams](source-documents/Gym_Management_System_Diagrams_Revised.docx)

The [data-flow diagrams](diagrams/) are available as [level 0](diagrams/dfd_level0.pdf) and [level 1](diagrams/dfd_level1.pdf) PDFs. Original files are retained for coursework reference; the linked Markdown requirements and acceptance records describe their current revision and approval status.

## Paths after repository cleanup

| Previous location | Current location |
| --- | --- |
| `GMS/Server/` | [backend/](../backend/README.md) |
| `GMS/UI/dist/` | [frontend/public/](../frontend/public/) |
| `GMS/UI/tests/` | [frontend/tests/](../frontend/tests/) |
| `GMS/Database/database/` | [database/](../database/README.md) |
| `GMS/Docs/` | [docs/](README.md) |
| `GMS/Server/API.md`, `ACCEPTANCE.md`, `VALIDATION.md` | This folder |
| `GMS/UI/REQUIREMENTS_FIXES.md` | [IMPLEMENTATION.md](IMPLEMENTATION.md) |
| Original combined database SQL file | [database/archive/](../database/archive/README.md) |

Open the repository root in VS Code after pulling these changes. The root `npm` commands use the new locations; the previous `cd GMS/...` commands no longer apply.

### Updating an existing local checkout

Git moves tracked source files, but your ignored configuration, dependencies and backups stay on your computer in their previous locations. In PowerShell, from the repository root, copy the existing configuration only if the new file does not already exist:

```powershell
if ((Test-Path "GMS/Server/.env") -and (-not (Test-Path "backend/.env"))) {
    Copy-Item "GMS/Server/.env" "backend/.env"
}
npm run setup
npm start
```

The same database and manager account can be reused; this cleanup does not introduce a database migration. Retain existing backups and update any Windows Task Scheduler **Start in** directory to the full path of `backend/`. Check local scripts and VS Code launch settings for the previous folder paths.
