# Handoff checklist

Every handoff item in PRD 19, where it lives, and what it still waits on.

**Status: draft.** Production deployment, the operational documentation,
restore verification and handoff acceptance are all unfinished. Writing
these documents does not complete any of them. Several items wait on
production decisions that are still open with QCH IT, including where data
will live; see [pending-qch-it-decisions.md](pending-qch-it-decisions.md).

Handoff is complete when each deliverable is delivered and any remaining
gap has an agreed resolution or acceptance plan (PRD 19.6). **An agreed gap
plan does not waive an explicit requirement.** In particular, the backup and
restore procedure must be exercised successfully at least once in an
isolated, QCH-approved environment before handoff acceptance (PRD 19.5); a
plan to do it later does not satisfy that.

Status key: **Done**, **Draft** (written, not final), **In review** (open
pull request), **Not started**.

## What QCH receives, and what it does not

[prd-traceability.md](prd-traceability.md) audits `main` at `cd22455` against
the frozen Handoff PRD, the Handoff MVP (its 36 acceptance gates) and the
Current Handoff Wireframes, using the MVP 33 classifications. In short:

- **A working application on synthetic data**, with its tests: both referral
  paths, receiving response and outcome, corrections and audit, Program
  Management, Guided Program Matching, aggregate reporting, simulated
  notifications, and a demo environment. It has only ever run on in-memory
  stores, never in QCH's environment. Most gates are `VERIFIED` for that
  environment only; the page lists the limits.
- **Production dependencies** (QCH or QCH IT provides these; they are not
  Capstone failures and not completed Capstone infrastructure): SharePoint Lists
  in a private site, Azure Functions with managed identity, Graph
  `Sites.Selected`, the shared mailbox and Exchange RBAC, Entra sign-in,
  production users and permissions, the Program Directory, the Department
  taxonomy, a retention policy, a browser baseline, and the hosting decision.
  PRD 27 to 30 confirm the architecture; provisioning and production
  verification are still to do. See [pending-qch-it-decisions.md](pending-qch-it-decisions.md).
- **Not delivered:** an external AI service. It is excluded from the MVP (PRD 7,
  MVP 26), so it is not a pending item.
- **Gates not yet met on `main`:** items in open pull requests (an open pull
  request is not an approved deferral) and the `TRUE-GAP` rows in
  [prd-traceability.md](prd-traceability.md). Until each is merged and its
  evidence run, or has a recorded decision, it is not a handoff gap-plan item.

## Deliverables (PRD 19.2)

| Deliverable | Where it lives | Status | Waiting on |
| --- | --- | --- | --- |
| Authoritative source code | This repository during development; a QCH-owned repository at handoff. How it is built: [architecture.md](architecture.md) | Draft | QCH IT repository location (19.3) |
| Deployment documentation | `docs/deployment.md` | Draft | QCH IT deployment tooling and resource details |
| Environment and configuration documentation | `docs/qch-it-requirements.md`, README Configuration table | Draft | QCH IT values and confirmations |
| Database schema and migrations | `db/migrations/`, `db/README.md` | Draft (design) | The storage decision (pending decision 1): the SQL design (001 to 003) is the team's current design, not a confirmed production store. Migration-history handling not built. |
| Data Dictionary | [data-dictionary.md](data-dictionary.md) | Draft | Revisit once the storage decision is made |
| Administrative instructions | [admin-guide.md](admin-guide.md) | Draft | Permission administration screens (not built) and Program notification email management (not built) |
| Backup and restore procedure | Not written | Not started | Storage and hosting decisions (pending decisions 1 and 2), then QCH IT's backup approach |
| Recovery procedure | [operations.md](operations.md) (concepts); [deployment.md](deployment.md) (failed release); `db/README.md` (failed migration) | Draft | QCH IT backup and restore details |
| Troubleshooting guide | [troubleshooting.md](troubleshooting.md) | Draft | Production-specific problems, once hosting, store, sign-in and email exist |
| Dependency and licensing information | `docs/dependencies.md`, `npm run licenses` | Draft | QCH decision on the project's own license |
| Operational and monitoring guidance | [operations.md](operations.md) (expectations and verification); README Notifications section | Draft | Hosting and monitoring decision (pending decision 2); readiness check not built |
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
- [ ] Backup and restore exercised successfully in an isolated, QCH-approved
      environment, with the result documented (PRD 19.5). Required; a gap
      plan cannot replace it.
- [ ] Remaining gaps written down with an agreed resolution or acceptance
      plan. A gap plan never waives an explicit PRD requirement.
