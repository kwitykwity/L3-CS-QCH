# Production architecture and handoff dependencies

**Status: confirmed design, not provisioned.** This page states the
production architecture that the Frozen Handoff PRD confirms, and lists what
QCH and QCH IT still have to provision before QCH Connect can run in
production. It does not complete production deployment, and nothing here has
run in QCH's environment.

**Authority.** Frozen Handoff PRD (October 28, 2026) §21, §22, §23, §26 to §32
and §37, and the Handoff MVP §21, §22 and §28 to §31. Where an older page in
`docs/` says one of these choices is still open, this page and the frozen PRD
govern. Section 4 lists those older statements.

Three kinds of statement appear below, and they are kept apart:

- **Confirmed**: decided in the frozen PRD/MVP. Not a question any more.
- **Outstanding**: QCH or QCH IT has to provision, configure or decide it.
  An outstanding item is a production dependency, not a Capstone failure, and
  not completed Capstone infrastructure (PRD §37, MVP §28, §31).
- **In this repository today**: what the Capstone code actually does, on
  synthetic data only.

## 1. Confirmed production architecture

```
Frontend  ->  Azure Functions  ->  SharePoint Lists / approved Microsoft services
             (managed identity)    (private QCH Connect site, via Graph Sites.Selected)
```

(MVP §28.)

| Area | Confirmed design | Source |
| --- | --- | --- |
| Data | **SharePoint Lists in a dedicated, private QCH Connect SharePoint site.** There is **no separate production database.** Employees reach referral information only through QCH Connect; direct access to the site is limited to appropriate QCH IT administrators. | PRD §27; MVP §28 |
| Privacy in the Lists | Production referral, evaluation and supporting Lists must not store the participant's exact age, age range, unnecessary discovery inputs, or unnecessary interpretation inputs. Age and age range stay temporary matching inputs. | PRD §5.4, §28; MVP §29 |
| Server-side authority | **Azure Functions** are the production server side. They may provide authorization, business logic, validation, referral transactions, GPME execution, notification orchestration, reporting support and audit handling. | PRD §29, §32; MVP §28 |
| Service identity and secrets | Azure Functions use a **managed identity**. Production secrets and long-lived service keys must not be in source code or in browser code. | PRD §29 |
| Microsoft Graph | Minimum required permissions. For the QCH Connect site: **`Sites.Selected`**, not tenant-wide `Sites.ReadWrite.All`. | PRD §30; MVP §28 |
| Email | New-referral notifications go out from the QCH shared mailbox **named in PRD §21** through Microsoft Graph, after the referral is saved. The Graph mail-sending permission is restricted to that mailbox through **Exchange RBAC for Applications**. (Task PP names this permission `Mail.Send`; the PRD says "approved Microsoft Graph permissions".) | PRD §21, §30; MVP §21, §28 |
| Sign-in | **Microsoft Entra ID single sign-on** with QCH Microsoft accounts, and **MFA according to QCH policy**. Identity is derived on the server; client-supplied authorization claims are never trusted; least privilege. | PRD §22; MVP §22 |
| Authorization | Enforced on the server for every protected operation; Program affiliation validated; no self-elevation; permission administration itself needs an administrative capability. | PRD §23, §24, §32 |
| Audit | Application-level audit of sensitive and workflow-changing actions (who, what, when), plus Microsoft 365 audit. Audit records must not become a second store of participant information. | PRD §19, §26; MVP §19, §28 |
| Archival | See section 2. | PRD §31; MVP §30 |
| Frontend | Presentation and interaction only. Identity, authorization, validation, workflow transitions, matching, persistence, auditing and reporting rules are the server side's. Where the frontend is hosted is **outstanding** (section 3, item 12). | PRD §32, §37 |
| External AI | None in the MVP. Any future external AI processing of participant or referral information needs QCH approval, QCH IT approval, a security and privacy review, approved data handling, and explicit authorization. | PRD §7; MVP §26 |

## 2. Confirmed archival behavior

From PRD §31 and MVP §30:

1. When the **active referral list reaches 2,500 records**, the planned
   process archives the **500 oldest eligible closed/completed referrals**.
2. **Open and Awaiting Response referrals are never archived.**
3. If fewer than 500 referrals are safely eligible, the process archives only
   those, and never an open or Awaiting Response referral to reach 500. (The
   PRD records this last safeguard as a protective implementation
   interpretation, not a separate QCH policy statement.)
4. Archived records stay **read-only**, **available for authorized
   reporting**, and **subject to audit requirements**, until QCH sets a formal
   retention/deletion policy (section 3, item 10).

In this repository today: there is no archival process. The in-memory stores
hold synthetic data that is reset on every start.

## 3. Production dependency checklist

Everything QCH or QCH IT still has to provide. The list combines PRD §37
(items 1 to 11) and MVP §31 (items 1 to 12). Every item is **outstanding**
unless its row says otherwise. Real values never go into this repository.

| # | Dependency | Owner | What is confirmed already | Status |
| --- | --- | --- | --- | --- |
| 1 | Azure production resources: the Azure Functions and their managed identity | QCH IT | Azure Functions with managed identity (PRD §29) | Outstanding |
| 2 | The private QCH Connect SharePoint site and its Lists | QCH IT | SharePoint Lists, private site, no separate database, privacy boundary (PRD §27, §28) | Outstanding |
| 3 | Entra ID application configuration for single sign-on | QCH IT | Entra ID with QCH Microsoft accounts and MFA per QCH policy (PRD §22) | Outstanding |
| 4 | Microsoft Graph permissions | QCH IT | `Sites.Selected` for the site; mail sending limited to the shared mailbox (PRD §30) | Outstanding |
| 5 | Exchange RBAC for Applications for the shared mailbox | QCH IT | Sending restricted to the approved mailbox (PRD §21, §30) | Outstanding |
| 6 | Shared mailbox configuration | QCH IT | The shared mailbox named in PRD §21. QCH IT earlier reported the mailbox as created; the sending permission and its configuration are not in place | Outstanding (sending) |
| 7 | Production users, groups and permissions, including the first permission administrators | QCH IT and QCH | Permissions are administered in QCH Connect by authorized administrators (PRD §24) | Outstanding |
| 8 | Production Program Directory configuration | QCH | The internal Program Directory is never committed to a public repository (PRD §8, §35) | Outstanding |
| 9 | Authoritative Department taxonomy | QCH | The demo seed's four Departments are demo values only (PRD §11) | Outstanding |
| 10 | Formal retention/deletion policy after archival | QCH | Archived records stay read-only until this exists (PRD §31) | Outstanding |
| 11 | Supported production browser and version baseline | QCH IT | None from QCH yet. The team's test baseline (Edge, Chromium, Firefox, Playwright WebKit) is not QCH policy ([browser-verification.md](browser-verification.md)) | Outstanding |
| 12 | Production frontend/browser hosting decision | QCH IT | The frontend is presentation only (PRD §32) | Outstanding |

PRD §37 asks that these dependencies are clearly documented at handoff. This
table is that list; do not mark a row done until QCH or QCH IT confirms it.

## 4. What the repository does today (non-production)

| Area | In this repository | Production equivalent (section 1) |
| --- | --- | --- |
| Server | One Node.js/Express app (`src/`). `npm start` serves the pages and `/health`; every `/api` route answers 401 because no sign-in is connected (it fails closed) | Azure Functions |
| Data | In-memory stores with synthetic data, rebuilt on every start | SharePoint Lists |
| Sign-in | None in production. Two non-production modes, below | Entra ID SSO with MFA |
| Email | A simulated outbox that refuses to run outside development and test | Graph, shared mailbox, Exchange RBAC |
| Archival | None | Section 2 |

**Non-production demo identities (unchanged by this page).** Demo mode uses
**preconfigured synthetic identities**, chosen on screen, with **no username
or password entry**:

- `npm run dev:demo` offers three invented demo people on `/demo/`
  (Referring Worker, Housing Help Desk Staff, Older Adult Wellness Center
  Staff), with **Switch person** to change. Every page says "Demo sign-in.
  Production uses QCH Microsoft sign-in."
- `npm run dev:synthetic` signs in one fixed synthetic developer identity.
- Both refuse to start unless `NODE_ENV` is exactly `development`, and the
  production server rejects demo sign-in.

Details and evidence: [demo-environment.md](demo-environment.md) and the
tests `test/demoSignIn.test.js`, `test/demoEnvironment.test.js` and
`test/demoVerification.test.js`. **Production authentication remains
Microsoft Entra ID single sign-on**; the demo modes are never a production
sign-in path (PRD §22: development/demo identity stays clearly separate).

### Earlier-plan material still in the repository

These came from the plan the team started with, before QCH IT confirmed the
architecture. They are **superseded by the frozen PRD** but are not deleted
here, because this is a documentation-only change:

| Item | Where | What it means now |
| --- | --- | --- |
| Azure SQL schema and migrations | `db/`, [data-dictionary.md](data-dictionary.md) | A design record of the data the app uses. **Not the production store**: there is no separate production database (PRD §27) |
| Azure App Service hosting | [deployment.md](deployment.md), [qch-it-requirements.md](qch-it-requirements.md), README | Superseded for the server side by Azure Functions (PRD §29). Frontend hosting is still outstanding (item 12) |
| `DATABASE_URL`, `AZURE_CLIENT_SECRET`, `KEY_VAULT_URI` placeholders | `.env.example`, README Configuration | Placeholders no code reads. Under the confirmed design the Functions use a managed identity and there is no database connection string; QCH IT decides what configuration production actually needs |
| "Open decisions" 1 to 7 | [pending-qch-it-decisions.md](pending-qch-it-decisions.md) | Mostly settled; see the table below |

| Earlier "open decision" | Now |
| --- | --- |
| 1. SharePoint Lists or Azure SQL | **Confirmed**: SharePoint Lists, no separate database (PRD §27). Provisioning outstanding (item 2) |
| 2. Server-side hosting and compute | **Confirmed**: Azure Functions with managed identity (PRD §29). Provisioning outstanding (item 1); frontend hosting outstanding (item 12) |
| 3. SharePoint site and access model | **Confirmed**: dedicated private site, direct access for QCH IT administrators only, Graph `Sites.Selected` (PRD §27, §30). Provisioning outstanding (items 2, 4) |
| 4. Archive behavior | **Confirmed**: section 2 (PRD §31) |
| 5. Entra application registration | **Confirmed**: Entra ID SSO with MFA (PRD §22). Configuration outstanding (item 3) |
| 6. Graph and Send As configuration | **Confirmed**: shared mailbox, Graph, Exchange RBAC for Applications (PRD §21, §30). Configuration outstanding (items 4 to 6) |
| 7. AI boundary | **Confirmed out of MVP scope**: no external AI (PRD §7) |
| 8. Retention and audit policy | Retention/deletion policy **outstanding** (item 10); application audit confirmed (PRD §26) |
