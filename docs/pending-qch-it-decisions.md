# Pending QCH IT Architecture Decisions

**Status: draft.** Part of the handoff documentation. It does not complete production deployment, restore verification, or QCH handoff acceptance. Nothing here has run in QCH's environment: the application runs on in-memory stores with synthetic data.

**Authority.** Frozen Handoff PRD (October 28, 2026) §21, §22, §26 to §32 and §37, and Handoff MVP §21, §22 and §28 to §31. The full architecture reference is [production-architecture.md](production-architecture.md); the dependency list is in [handoff-checklist.md](handoff-checklist.md).

This page keeps two things apart:

- **Confirmed architecture.** Decided in the frozen PRD/MVP. These are not open questions. Provisioning them is QCH/QCH IT work, which is a production dependency and not a Capstone failure (PRD 37; MVP 28, 31).
- **Still outstanding.** What QCH or QCH IT has not yet provisioned, configured or decided.

## Confirmed architecture

| Area | Confirmed | Source |
| --- | --- | --- |
| Data | SharePoint Lists in a dedicated, private QCH Connect SharePoint site. There is no separate production database. Direct access to the site is limited to appropriate QCH IT administrators; employees reach referral information through QCH Connect. | PRD 27; MVP 28 |
| Privacy in the Lists | Production Lists must not store participant exact age, age range, or unnecessary discovery or interpretation inputs. | PRD 28; MVP 29 |
| Server side | Azure Functions with a managed identity. No production secrets or long-lived service keys in source or browser code. | PRD 29; MVP 28 |
| Microsoft Graph for the site | `Sites.Selected` on the dedicated site, not tenant-wide `Sites.ReadWrite.All`. | PRD 30; MVP 28 |
| Email | Notifications are sent after the referral is saved, from the shared mailbox named in PRD 21, through Microsoft Graph `Mail.Send`, restricted to that mailbox by Exchange RBAC for Applications. The frozen PRD names the restriction (Exchange RBAC for Applications) and says "approved Microsoft Graph permissions"; the permission name `Mail.Send` comes from the Task 205 instructions, and QCH IT confirms the exact permission at configuration. | PRD 21, 30; MVP 21, 28 |
| Sign-in | Microsoft Entra ID single sign-on with MFA according to QCH policy. | PRD 22; MVP 22 |
| Archival | When the active referral list reaches 2,500 records, the 500 oldest eligible closed/completed referrals are archived. Open and Awaiting Response referrals are never archived, even if fewer than 500 are eligible. Archived records stay read-only and available for authorized reporting and audit until QCH sets a retention/deletion policy. | PRD 31; MVP 30 |
| AI | No external AI in the MVP. | PRD 7; MVP 26 |

## How each earlier decision stands

This page used to list eight decisions as "Open". Their current state:

| # | Earlier decision | Confirmed | Still outstanding |
| --- | --- | --- | --- |
| 1 | Where production data lives | SharePoint Lists, private site, no separate database (PRD 27) | The site and Lists are not provisioned (dependency 2). The Azure SQL design in `db/` is an earlier-plan record, not the production store. |
| 2 | Server-side hosting and compute | Azure Functions with managed identity (PRD 29) | Azure resources are not provisioned (dependency 1). Where the frontend is hosted is a separate decision (dependency 12). |
| 3 | SharePoint site and access model | Dedicated private site; direct access for QCH IT administrators only; `Sites.Selected` (PRD 27, 30) | Site provisioning and Graph permission grants (dependencies 2, 4). |
| 4 | Archive behavior | The rule above (PRD 31) | The archival process is not built. Who builds it is not stated in the frozen documents (question Q9 in [handoff-questions.md](handoff-questions.md)). |
| 5 | Entra application registration | Entra ID SSO with MFA (PRD 22) | Application configuration, and the connection to the app (dependency 3). |
| 6 | Graph and mail sending | Shared mailbox, Graph `Mail.Send`, Exchange RBAC for Applications (PRD 21, 30) | Graph permissions, Exchange RBAC and shared mailbox configuration (dependencies 4 to 6). No Graph sender exists in the code. Where a Program's notification address is held is open (known-limitations B5, question Q8). |
| 7 | AI boundary | Out of MVP scope (PRD 7, MVP 26) | Nothing. Not a pending item. |
| 8 | Retention and audit | Application-level audit of workflow-changing actions (PRD 26) | The formal retention/deletion policy is QCH's to set (dependency 10). |

The configuration values QCH IT will supply are listed in [qch-it-requirements.md](qch-it-requirements.md). That page and [deployment.md](deployment.md) still describe parts of the earlier App Service / Azure SQL plan; read them with [production-architecture.md](production-architecture.md) section 4.

## What in this repository depends on what

| Not done yet | Kind | Waits on |
| --- | --- | --- |
| A production data store on SharePoint Lists (the code has only in-memory stores) | External, then engineering | Site and Lists provisioned (dependency 2) |
| Staff sign-in through Entra ID | External, then engineering | Entra configuration (dependency 3) |
| Demo sign-in for non-production demos | Done (Task O, #60, merged) | Nothing |
| Permission administration screens | Done (Task Y, #63, merged) | Remaining policy questions are in the README's Permission administration section |
| Microsoft Graph sender, and starting the notifier and retry timer in the hosted app | External, then engineering | Dependencies 1, 4, 5, 6 |
| Managing a Program's notification address | Open | Question Q8; no screen or route sets it yet |
| Describe-the-need step | Requirement | Frozen Handoff PRD 5.1 to 5.3 and 7; Handoff MVP 5, 6 and 26 |
| Language of service, availability, Program information, contact guidance, multiple locations | Requirement | Frozen Handoff PRD 6.3, 6.4 and 8 to 14; Handoff MVP 8 to 14 |
| Hosting, monitoring and alerts | External | Azure provisioning (dependency 1) and frontend hosting (dependency 12); the frozen documents do not specify a monitoring approach |
| Backup, restore, and one restore test in an isolated environment (PRD 19.5) | External | Provisioned SharePoint and Azure (dependencies 1, 2), then QCH IT's backup approach |
| Archival process | External or engineering (unassigned) | Question Q9; retention policy (dependency 10) for what happens to archived records |
