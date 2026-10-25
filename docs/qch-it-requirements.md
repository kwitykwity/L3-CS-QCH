# What QCH IT needs to provide

Everything QCH Connect needs from QCH IT to run in production, in one list
(Final Technical PRD 1.4, 11, 15, 18, 19, 22). Nothing here holds a real
value. Real values are entered by QCH IT into App Service settings or Azure
Key Vault, never into this repository.

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
| `AZURE_CLIENT_SECRET` | Secret for that app registration | Azure Key Vault (PRD 15.2) | Staff sign-in; Microsoft Graph too, if QCH IT uses the same registration | Needed |
| `AZURE_REDIRECT_URI` | Address Entra ID returns to after sign-in | App Service settings | Staff sign-in | Needed |
| `KEY_VAULT_URI` | Address of the Key Vault that holds the secrets | App Service settings | Reading secrets at startup | Needed |
| `DATABASE_URL` | Azure SQL connection information | Azure Key Vault (PRD 15.2) | Everything that stores data | Needed |
| `NOTIFICATION_MAILBOX` | Exchange Online shared mailbox that sends referral emails | App Service settings | New-referral emails (Card 15) | Needed |

`PORT` and `NODE_ENV` are not QCH IT secrets or settings to invent. `PORT`
is supplied by the hosting platform (App Service) at runtime; QCH IT
confirms how their setup provides it, and the deployment must not hard-code
it. `NODE_ENV` is set by the deployment and must be exactly `production`.

## Azure and Microsoft 365 setup

| Item | What QCH Connect needs | PRD | Status |
| --- | --- | --- | --- |
| US regions | Every QCH Connect resource (App Service, Azure SQL, Key Vault, monitoring) in an approved US region. Referral data stays in QCH-approved Microsoft infrastructure unless QCH IT approves otherwise in writing. | 1.4 | Needed |
| Azure App Service | A QCH-owned App Service to host the Node.js app, and confirmation of its Node version. The team develops on Node 24.15.0; the production version is not confirmed. If QCH IT selects a different version, the team updates the repository's exact pin and tests and validates that version before deployment (see deployment.md step 1). | 1.4 | Needed |
| Application address (URL) | The production web address of QCH Connect. **Required**: the Entra ID redirect URI (`AZURE_REDIRECT_URI`) and the app registration's allowed sign-in addresses are built from it, so sign-in cannot be configured without it. Emails may also link to it later. | 1.4, 3.1 | Needed |
| Azure SQL Database | A QCH-owned database that is not publicly reachable (private endpoint or firewall rules limited to the app), encrypted at rest and in transit with TLS 1.2 or higher. | 1.4, 15.1 | Needed |
| Separate database privileges | Two different database identities: a least-privilege **runtime** identity the app uses (read and write data only, no schema changes), and a separate **migration/admin** identity used only to apply reviewed migrations. The app never holds migration rights. | 9.2 | Needed |
| Database migration access | Who applies schema migrations in production, with the migration identity above. Migrations are applied on purpose, never by the app at startup. | 9.8, 18.3 | Needed |
| Backup and restore | QCH's backup approach for Azure SQL, and an isolated non-production place where the team can test one restore before handoff. | 18.4, 19.5 | Needed |
| Entra ID app registration | The app registration for QCH Connect sign-in, and the Microsoft Graph permission QCH IT approves for sending mail as the shared mailbox. QCH IT decides whether sign-in and mail sending share one registration. | 3.1, 11.1 | Needed |
| Entra access | Which Entra group or assignment grants access to the app. Entra decides who can open the app; action permissions are managed inside QCH Connect. | 3.4, 22 | Needed |
| Tenant MFA | Confirmation that QCH's tenant-level MFA applies to QCH Connect sign-in. The app relies on Entra for MFA and does not add its own. | 3.1 | Needed |
| Azure Key Vault | A Key Vault for production secrets, and the way the app is allowed to read it. | 15.2 | Needed |
| Shared mailbox | The Exchange Online shared mailbox notifications are sent from. QCH IT has created it (the address is not recorded here). Still needed: how the app may send as it (Send As or Graph permission, app identity) and the production configuration. Until then the app uses the simulated outbox. | 11.1 | Needed (mailbox created; sending permission and configuration pending) |
| Azure Monitor / Application Insights | A resource for app logs and alerts, including alerts on repeated notification failures. Logs never hold participant data. | 11.6, 15.3 | Needed |
| Deployment tooling | Which CI/CD tool or process QCH IT wants for deployments. | 18.2, 22 | Needed |
| Non-production environment | A QCH-provided non-production environment, if one is available in time (Plan A). Otherwise the team uses its own synthetic-only environment (Plan B). | 16.4 | Needed |
| Source repository | The QCH-owned repository where the source lives after handoff. | 19.3 | Needed |
| Supported browsers | The browsers and versions QCH staff use. | 22 | Needed |

## QCH policy decisions

| Item | Why it matters | PRD | Status |
| --- | --- | --- | --- |
| Retention and purge | How long referral data is kept. The team will not invent an automatic deletion rule. | 9.11, 22 | Policy |
| Initial permission administrators and break-glass access | Who the first designated permission administrators are, and the controlled, documented, QCH-approved emergency (break-glass) administrative access. Administrator identity is configuration, never hard-coded. | 3.8 | Policy |
| Business time zone | The QCH-approved business time zone for displaying times and drawing reporting period boundaries (with daylight-saving handling). Times are stored in UTC; a fixed offset such as UTC-5 is not allowed. | 9.7 | Policy |

## Credentials and ownership

QCH or authorized QCH IT administrators own every production credential,
secret, and service identity (PRD 19.4). Production must never depend on a
team member's personal account. QCH IT can rotate credentials and remove
team access at any time.
