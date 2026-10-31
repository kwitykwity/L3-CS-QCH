# Handoff checklist

Every handoff item in PRD 19, where it lives, and what it still waits on.

**Status: draft.** Production deployment, the operational documentation,
restore verification and handoff acceptance are all unfinished. Writing
these documents does not complete any of them. The production architecture
is confirmed (Frozen Handoff PRD 27 to 30); what is unfinished is QCH and
QCH IT provisioning and production verification. See
[production-architecture.md](production-architecture.md) and
[pending-qch-it-decisions.md](pending-qch-it-decisions.md).

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
  Capstone failures and not completed Capstone infrastructure): the 12 items
  in the next section. The architecture they serve is confirmed (PRD 27 to
  30): SharePoint Lists in a private site with no separate production
  database, Azure Functions with managed identity, Graph `Sites.Selected`,
  a Graph mail-sending permission with Exchange RBAC for Applications (permission model to be confirmed with QCH IT), and Entra SSO with MFA.
- **Not delivered:** an external AI service. It is excluded from the MVP (PRD 7,
  MVP 26), so it is not a pending item.
- **Gates not yet met on `main`:** items in open pull requests (an open pull
  request is not an approved deferral) and the `TRUE-GAP` rows in
  [prd-traceability.md](prd-traceability.md). Until each is merged and its
  evidence run, or has a recorded decision, it is not a handoff gap-plan item.

## Production dependencies (Handoff MVP 31)

These twelve items are QCH or QCH IT handoff dependencies. Each stays
**Outstanding** until QCH or QCH IT confirms it; do not tick one on the
team's say-so. Real values never go into this repository. This list follows
MVP 31; PRD 37 lists eleven, with the mailbox configuration included under
Exchange RBAC. Details: [production-architecture.md](production-architecture.md)
section 3.

| # | Dependency | Owner | Already confirmed (not a question) | Status |
| --- | --- | --- | --- | --- |
| 1 | Azure production resource provisioning (Azure Functions, managed identity) | QCH IT | Azure Functions with managed identity (PRD 29) | Outstanding |
| 2 | SharePoint site and List provisioning (private QCH Connect site) | QCH IT | SharePoint Lists, private site, no separate database, privacy boundary (PRD 27, 28) | Outstanding |
| 3 | Entra ID application configuration (single sign-on, MFA per QCH policy) | QCH IT | Entra ID SSO with MFA (PRD 22) | Outstanding |
| 4 | Microsoft Graph application permissions: `Sites.Selected` for the site; a Graph permission for sending mail (the name `Mail.Send` comes from the Task 205 instructions, not the frozen PRD) | QCH IT | `Sites.Selected`, not `Sites.ReadWrite.All` (PRD 30). QCH IT confirms the exact mail permission | Outstanding |
| 5 | Exchange RBAC for Applications role assignment, limiting sending to the shared mailbox. This is separate from the Entra Graph permission in item 4 and does not by itself restrict a tenant-wide `Mail.Send` grant. **Effective mailbox-scope verification is required** | QCH IT | Sending restricted through Exchange RBAC for Applications (PRD 21, 30) | Outstanding |
| 6 | Shared mailbox configuration | QCH IT | The shared mailbox named in PRD 21. Sending permission and its configuration are not in place | Outstanding |
| 7 | Production users, groups and permissions, including the first permission administrators | QCH IT and QCH | Permissions are administered in QCH Connect by authorized administrators (PRD 24) | Outstanding |
| 8 | Production Program Directory configuration | QCH | The internal Program Directory is never committed to a public repository (PRD 8, 35) | Outstanding |
| 9 | Authoritative Department taxonomy | QCH | The demo seed's four Departments are demo values only (PRD 11) | Outstanding |
| 10 | Formal retention/deletion policy after archival | QCH | Archival rule: 2,500 active records, 500 oldest eligible closed/completed; archived records stay read-only (PRD 31) | Outstanding |
| 11 | Supported production browser and version baseline | QCH IT | None. The team's test browsers are not QCH policy ([browser-verification.md](browser-verification.md)) | Outstanding |
| 12 | Production frontend/browser hosting decision | QCH IT | The frontend is presentation only (PRD 32). Azure Functions are the server side, not the frontend host | Outstanding |

The archival process itself is not built, and the frozen documents do not
say who builds it (question Q9 in [handoff-questions.md](handoff-questions.md)).

## Deliverables (PRD 19.2)

| Deliverable | Where it lives | Status | Waiting on |
| --- | --- | --- | --- |
| Authoritative source code | This repository during development; a QCH-owned repository at handoff. How it is built: [architecture.md](architecture.md) | Draft | QCH IT repository location (19.3) |
| Deployment documentation | `docs/deployment.md` | Draft | Azure Functions provisioning (dependency 1) and QCH IT deployment details; parts still describe the earlier App Service plan |
| Environment and configuration documentation | `docs/qch-it-requirements.md`, README Configuration table | Draft | QCH IT values and confirmations (dependencies 3 to 6) |
| Database schema and migrations | `db/migrations/`, `db/README.md` | Draft (earlier-plan record) | Not the production store: there is no separate production database (PRD 27). The production Lists design is not written |
| Data Dictionary | [data-dictionary.md](data-dictionary.md) | Draft | Still describes the SQL design; a mapping to SharePoint Lists is not written |
| Administrative instructions | [admin-guide.md](admin-guide.md) | Draft | Permission administration is built (PR #63); confirm the guide covers it. Program notification address management is not built (known-limitations B5) |
| Backup and restore procedure | Not written | Not started | Provisioned SharePoint and Azure (dependencies 1, 2), then QCH IT's backup approach |
| Recovery procedure | [operations.md](operations.md) (concepts); [deployment.md](deployment.md) (failed release); `db/README.md` (failed migration) | Draft | QCH IT backup and restore details |
| Troubleshooting guide | [troubleshooting.md](troubleshooting.md) | Draft | Production-specific problems, once hosting, store, sign-in and email exist |
| Dependency and licensing information | `docs/dependencies.md`, `npm run licenses` | Draft | QCH decision on the project's own license |
| Operational and monitoring guidance | [operations.md](operations.md) (expectations and verification); README Notifications section | Draft | Frontend hosting (dependency 12) and QCH IT's monitoring approach; readiness check not built |
| App registration, shared mailbox and environment guidance | `docs/qch-it-requirements.md` | Draft | QCH IT setup (dependencies 3 to 6). Key Vault is not part of the confirmed design; QCH IT decides what configuration production needs |

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
