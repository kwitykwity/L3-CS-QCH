# Handoff checklist

Every handoff item in PRD 19, where it lives, and what it still waits on.
Handoff is complete when each row is done or has an agreed plan (PRD 19.6).

Status key: **Done**, **Draft** (written, not final), **In review** (open
pull request), **Not started**.

## Deliverables (PRD 19.2)

| Deliverable | Where it lives | Status | Waiting on |
| --- | --- | --- | --- |
| Authoritative source code | This repository during development; a QCH-owned repository at handoff | Draft | QCH IT repository location (19.3) |
| Deployment documentation | `docs/deployment.md` | Draft | QCH IT deployment tooling and resource details |
| Environment and configuration documentation | `docs/qch-it-requirements.md`, README Configuration table | Draft | QCH IT values and confirmations |
| Database schema and migrations | `db/migrations/`, `db/README.md` | In review | PR #4; GPME schema change (migration 003, pending team decisions); migration-history handling |
| Data Dictionary | Not written | Not started | Schema settling (PR #4 and migration 003) |
| Administrative instructions | Not written | Not started | Permission administration and Program management features |
| Backup and restore procedure | Not written | Not started | QCH IT backup approach |
| Recovery procedure | `docs/deployment.md` (app); `db/README.md` (failed migration) | Draft | QCH IT backup and restore details |
| Troubleshooting guide | Not written | Not started | Features and monitoring in place |
| Dependency and licensing information | `docs/dependencies.md`, `npm run licenses` | Draft | QCH decision on the project's own license |
| Operational and monitoring guidance | Not written (PR #12 adds notification logging notes to the README) | Not started | Application Insights resource from QCH IT |
| App registration, Key Vault, shared mailbox and environment guidance | `docs/qch-it-requirements.md` | Draft | QCH IT setup |

## Ownership and access (PRD 19.4)

- [ ] Every production credential, secret, and service identity is owned by
      QCH or QCH IT.
- [ ] Production does not depend on any team member's personal account.
- [ ] QCH IT has confirmed it can rotate credentials and remove team access.

## Knowledge transfer (PRD 19.5)

- [ ] QCH IT can find and understand the source and architecture.
- [ ] QCH IT can configure the environment, deploy, and apply migrations.
- [ ] QCH IT can verify critical features after a deployment.
- [ ] QCH IT can find the troubleshooting, backup, restore, and recovery
      procedures.
- [ ] One backup restore has been tested in an isolated, QCH-approved
      environment, with the result and any limits written down.

## Acceptance (PRD 19.6)

- [ ] Agreed source, documentation, and configuration guidance delivered.
- [ ] Ownership and access arrangements in place.
- [ ] Knowledge-transfer activities complete.
- [ ] Remaining gaps written down with an agreed plan.
