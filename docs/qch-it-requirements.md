# What QCH IT needs to provide

Everything QCH Connect needs from QCH IT to run in production, in one list
(Final Technical PRD 1.4, 11, 15, 18, 19, 22). Nothing here holds a real
value. Real values are entered by QCH IT into App Service settings or Azure
Key Vault, never into this repository.

**The production architecture is confirmed** by the Frozen Handoff PRD
(§21, §22, §27 to §31, §37): SharePoint Lists in a dedicated private QCH
Connect site with no separate production database, Azure Functions with a
managed identity, Microsoft Graph `Sites.Selected`, mail sending from the
shared mailbox restricted through Exchange RBAC for Applications, and
Microsoft Entra ID single sign-on with MFA. What is still outstanding is
QCH/QCH IT **provisioning and configuration**. The full checklist, and which
older statements this replaces, are in
[production-architecture.md](production-architecture.md). Rows below that
name Azure App Service, Azure SQL or Key Vault come from the earlier plan
and are marked as such.

Status key: **Needed** = not yet recorded here as provided. **Provided** = in
place. Update a row as QCH IT responds.
**Policy** = a QCH decision, not an IT setup item.

## Configuration values

Every variable in `.env.example` that QCH IT must supply. A test
(`test/docs.test.js`) fails if `.env.example` gains a variable that this
table does not list.

| Variable | What it is | Where it lives in production | Needed for | Status |
| --- | --- | --- | --- | --- |
| `AZURE_TENANT_ID` | QCH's Microsoft Entra ID tenant | App Service settings | Staff sign-in | Needed |
| `AZURE_CLIENT_ID` | The QCH Connect app registration in Entra ID | App Service settings | Staff sign-in; Microsoft Graph too, if QCH IT uses the same registration | Needed |
| `AZURE_CLIENT_SECRET` | Secret for that app registration (earlier plan) | Earlier plan: Azure Key Vault. Under the confirmed design the Azure Functions use a managed identity and no secret is kept in source or browser code (PRD §29); QCH IT decides whether sign-in still needs one | Staff sign-in | Needed (earlier-plan placeholder) |
| `AZURE_REDIRECT_URI` | Address Entra ID returns to after sign-in | App Service settings | Staff sign-in | Needed |
| `KEY_VAULT_URI` | Address of the Key Vault that holds the secrets (earlier plan) | Earlier plan: App Service settings. Not named in the confirmed architecture; QCH IT decides whether a secret store is needed alongside the managed identity | Reading secrets at startup | Needed (earlier-plan placeholder) |
| `DATABASE_URL` | Connection string for a production database (earlier plan) | **Superseded**: there is no separate production database; data lives in SharePoint Lists reached through Graph with the Functions' managed identity (PRD §27, §29, §30). No code reads this placeholder | Nothing under the confirmed design | Not needed under the confirmed design (placeholder kept in `.env.example`) |
| `NOTIFICATION_MAILBOX` | Exchange Online shared mailbox that sends referral emails (the address is named in PRD §21; not recorded here) | Production configuration (QCH IT) | New-referral emails (Card 15) | Needed |

`PORT` and `NODE_ENV` are not QCH IT secrets or settings to invent. `PORT`
is supplied by the hosting platform at runtime (App Service in the earlier
plan); QCH IT
confirms how their setup provides it, and the deployment must not hard-code
it. `NODE_ENV` is set by the deployment and must be exactly `production`.

## Azure and Microsoft 365 setup

The confirmed design is in [production-architecture.md](production-architecture.md)
section 1. Each row is a provisioning or configuration item that QCH IT still
has to do.

| Item | What QCH Connect needs | Frozen PRD | Status |
| --- | --- | --- | --- |
| Azure Functions | The production server side (authorization, business logic, validation, referral transactions, GPME execution, notification orchestration, reporting support, audit handling), in QCH-owned Azure | §29, §32 | Needed |
| Managed identity | The Functions' managed identity. No production secrets or long-lived service keys in source or browser code | §29 | Needed |
| SharePoint site and Lists | A dedicated, private QCH Connect SharePoint site with its Lists. No separate production database. Direct site access only for appropriate QCH IT administrators. The Lists must not store exact age, age range, or unnecessary discovery or interpretation inputs | §27, §28 | Needed |
| Graph site permission | `Sites.Selected`, granted for the QCH Connect site only (not `Sites.ReadWrite.All`) | §30 | Needed |
| Shared mailbox and mail sending | The shared mailbox named in PRD §21 (address not recorded here). QCH IT earlier reported the mailbox as created; still needed: the Graph mail-sending permission (named `Mail.Send` on Task PP) restricted to this mailbox through Exchange RBAC for Applications. Until then the app uses the simulated outbox | §21, §30 | Needed (mailbox reported created; sending permission and RBAC pending) |
| Entra ID single sign-on | The app registration for staff sign-in with QCH Microsoft accounts, its allowed sign-in addresses, and the group or assignment that grants access. Action permissions are managed inside QCH Connect | §22 | Needed |
| MFA | Confirmation that QCH's MFA policy applies to QCH Connect sign-in. The app relies on Entra for MFA | §22 | Needed |
| Production users, groups and permissions | Who has access, and the first permission administrators | §24, §37 item 6 | Needed |
| Frontend hosting | Where the browser pages are hosted | §32, §37 item 11 | Needed |
| Supported browsers | The browsers and versions QCH staff use | §37 item 10 | Needed |
| Monitoring | Where production logs and alerts go (for example on repeated notification failures). Logs never hold participant data | §21, §34 | Needed |
| Deployment process | How releases reach production | §37 | Needed |
| Source repository | The QCH-owned repository where the source lives after handoff | Final Technical PRD 19.3 | Needed |
| Non-production environment | A QCH-provided non-production environment, if available; otherwise the team's synthetic-only environment | §35 | Needed |

**Earlier-plan rows, superseded** (kept so readers of older pages can match
them up): Azure App Service hosting is replaced on the server side by Azure
Functions; the Azure SQL Database, its two database identities, migration
access and Azure SQL backup do not apply because there is no separate
production database (§27); Key Vault is not named in the confirmed
architecture. Backup and restore of the SharePoint data is a QCH IT matter
under the confirmed design.

## QCH policy decisions

| Item | Why it matters | PRD | Status |
| --- | --- | --- | --- |
| Production data store | **Confirmed**: SharePoint Lists in a private site, no separate database (Frozen PRD §27). Provisioning is in the table above | §27 | Confirmed |
| AI boundary | **Confirmed**: no external AI in the MVP; any future use needs QCH and QCH IT approval, a security and privacy review, approved data handling and explicit authorization (Frozen PRD §7). Nothing in the app uses AI | §7 | Confirmed |
| Archive | **Confirmed**: at 2,500 active referrals, archive the 500 oldest eligible closed/completed ones; never open or Awaiting Response; archived records read-only and available for authorized reporting and audit ([production-architecture.md](production-architecture.md) section 2) | §31 | Confirmed |
| Retention and purge | How long referral data is kept after archival. The team will not invent an automatic deletion rule | §31, §37 item 9 | Policy |
| Initial permission administrators and break-glass access | Who the first designated permission administrators are, and the controlled, documented, QCH-approved emergency (break-glass) administrative access. Administrator identity is configuration, never hard-coded. | 3.8 | Policy |
| Business time zone | The QCH-approved business time zone for displaying times and drawing reporting period boundaries (with daylight-saving handling). Times are stored in UTC; a fixed offset such as UTC-5 is not allowed. | 9.7 | Policy |

## Credentials and ownership

QCH or authorized QCH IT administrators own every production credential,
secret, and service identity (PRD 19.4). Production must never depend on a
team member's personal account. QCH IT can rotate credentials and remove
team access at any time.
