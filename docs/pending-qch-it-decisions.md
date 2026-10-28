# Pending QCH IT Architecture Decisions

**Status: draft.** Part of the handoff documentation. It does not complete production deployment, restore verification, or QCH handoff acceptance.

Production decisions that belong to QCH IT (or to QCH), are not settled,
and change how QCH Connect is deployed or stored. Until each one is made,
this repository does **not** assume an answer. The application code runs
against an in-memory store with synthetic data; nothing here has run in
QCH's environment.

How to read this page:

- **Decision**: what QCH IT or QCH needs to decide.
- **Why it matters**: what in the application depends on it.
- **Until then**: what the team does in the meantime.
- **Status**: Open, or Answered (with the date and where the answer is
  recorded). Update a row when QCH IT responds.

Configuration values QCH IT will supply once these are settled (Entra IDs,
secrets, the mailbox, the database connection) are listed separately in
[qch-it-requirements.md](qch-it-requirements.md).

## The decisions

### 1. Where production data lives: SharePoint Lists or the Azure SQL design

| | |
| --- | --- |
| Decision | Whether QCH Connect stores its data in SharePoint Lists or in a relational database such as the Azure SQL design in [`db/migrations/`](../db/migrations/). |
| Why it matters | Every stored thing depends on it: referrals and their three-part lifecycle, Programs, Departments, configurable fields, users and permission grants, audit events, notification deliveries. The application relies on transactions (a change and its audit event commit together or not at all), row versions for "someone else changed this" checks, and uniqueness rules (for example one referral per Submission ID). Whichever store is chosen has to provide those guarantees, or the application has to be redesigned where it cannot. |
| Until then | The services talk to a store **contract**, implemented today only by the in-memory stores (`src/referrals/memoryReferralStore.js`, `src/affiliation/memoryStore.js`). Their header comments describe each operation and, where written, the SQL it would run. The SQL schema in `db/migrations/` is the team's **current design**, not a confirmed production store. No production store is built. |
| Status | **Answered** Oct 27, 2026 (QCH IT): SharePoint Lists, no separate database. The SQL design in `db/migrations/` will not be the production store. How the app keeps its transaction, version and uniqueness guarantees on SharePoint is team design work still to do. See R19 in [requirements-reconciliation-register.md](requirements-reconciliation-register.md) |

### 2. Server-side hosting and compute

| | |
| --- | --- |
| Decision | Where the Node.js server runs in production (the earlier plan named Azure App Service), its Node version, and how its port and settings are provided. |
| Why it matters | QCH Connect is a server application: authorization, validation and every state change happen on the server (PRD 3.7, 6.4). It cannot run as static pages alone. The Node version is pinned to 24.15.0 for development; production may differ. |
| Until then | `npm start` runs `node src/server.js` on any Node host. [deployment.md](deployment.md) keeps hosting-specific steps marked **PROVIDED BY QCH IT**. |
| Status | **Answered** Oct 27, 2026 (QCH IT): a lightweight Azure Functions app in a QCH-owned subscription, with a managed identity (no stored secrets or keys) and no separate database. QCH IT provisions the subscription and resource group. The team owes QCH IT its planned functions, triggers and outbound dependencies. See R20 |

### 3. SharePoint site and access model

| | |
| --- | --- |
| Decision | If SharePoint is used, which site holds the lists, who can open them directly, and which identity the application uses to read and write them. |
| Why it matters | QCH Connect enforces "who may see or change what" itself (capability, resource and scope, PRD 3.6). If staff can also open the lists directly in SharePoint, those rules can be bypassed: for example a receiving worker editing a referral's decision without an audit event, or anyone reading Not Appropriate explanations. The access model must keep the application as the only way to change referral data. |
| Until then | No SharePoint code exists. Access rules live in `src/authorization/referralAccess.js` and the services. |
| Status | **Answered** Oct 27, 2026 (QCH IT): a dedicated private site; the application identity scoped with Sites.Selected to that site only; staff reach referral data only through QCH Connect; direct access limited to QCH IT administrators. See R21 |

### 4. Archive behavior

| | |
| --- | --- |
| Decision | Whether and when referrals (and their audit history) are archived or moved out of the working store, and what staff can still see afterwards. |
| Why it matters | Committed referrals are never hard-deleted (PRD 6.5; the SQL design blocks deletes with a trigger). Reports count by date ranges back to 2000 (`src/reporting/periods.js`). Moving records elsewhere would change what reports and "my referrals" lists show. |
| Until then | Nothing is archived or deleted. No archive code exists. |
| Status | **Answered** Oct 27, 2026 (QCH IT): archive the 500 oldest closed or completed referrals; open referrals never; audit history moves with its referral; archived referrals read-only and still reportable. The opening of that answer (when archiving runs) needs checking against the email. Not built. See R25 |

### 5. Entra application registration

| | |
| --- | --- |
| Decision | The Microsoft Entra ID app registration for staff sign-in: who creates it, its allowed sign-in addresses, and which Entra group or assignment gives access to the app. |
| Why it matters | Identity must come from the server's sign-in, never from the browser (PRD 3.2). Today the app has a single seam for this, `resolveIdentity(req)` in `src/app.js`, and production passes none, so every `/api` route answers 401 (fails closed). |
| Until then | Development uses a fixed synthetic identity (`npm run dev:synthetic`); tests pass their own `resolveIdentity`. Entra sign-in is not built. |
| Status | Open. Oct 27, 2026: QCH IT will coordinate the app registration and security groups with the team when ready. See R22 |

### 6. Microsoft Graph and Send As configuration

| | |
| --- | --- |
| Decision | How QCH Connect sends the "new referral" email: the shared mailbox it sends from, the Graph permission QCH IT approves (Send As or equivalent), and whether mail sending shares the sign-in app registration. |
| Why it matters | The notification module (`src/notifications/`) is built and tested with a simulated outbox, and is started after each referral commits (Task E), but there is no Graph sender, so production sends nothing yet. Recipients come from each Program's `notification_email`, which has no management screen yet. |
| Until then | The simulated outbox, which refuses to start outside development and test. |
| Status | **Answered** Oct 27, 2026 (QCH IT): the application identity with Mail.Send, restricted to the shared mailbox only through Exchange Online RBAC for Applications; no tenant-wide mail permissions. The Graph sender is not built yet. See R23 |

### 7. Approved AI or language-processing boundary

| | |
| --- | --- |
| Decision | Whether any AI or language-processing service may be used, where it would run (for example inside QCH's own Microsoft tenant), and what data may be sent to it. |
| Why it matters | Earlier guidance was no outside AI services for referral data, and Guided Program Matching is rules-based (`src/gpme/matchPrograms.js`, rule version `gpme-v1`). At the Oct 23 midpoint check-in, QCH program staff asked for open-ended, AI-assisted matching. Any change to matching has to be reconciled with the Final Technical PRD first, and must keep participant data inside the approved boundary. |
| Until then | Rules-based matching only. The options are compared, without code, in [ai-interpretation-options.md](ai-interpretation-options.md) (Trello Task I). |
| Status | **Answered** Oct 27, 2026 (QCH IT): GPME runs entirely inside QCH Connect's approved environment with no external AI processing; any future change that would send participant or referral information to another service needs QCH IT approval first. See R5 |

### 8. Retention and audit policy

| | |
| --- | --- |
| Decision | How long referral data and audit history are kept, who may read audit history, and whether anything is ever purged. |
| Why it matters | Audit events are append-only and written in the same transaction as each change (PRD 6.5, 9.6). The team will not invent a deletion rule (PRD 9.11). |
| Until then | Everything is kept. No route returns audit events; no purge exists. |
| Status | Open (QCH policy). Oct 27, 2026 (QCH IT): no referral retention policy yet; QCH Connect keeps its own audit history (who, what, when), and Microsoft 365 audit logging also captures SharePoint activity. See R26 and R27 |

## Engineering gaps vs external dependencies

What is not done yet, split by who can move it forward. **Engineering**
means the team can do it now with no QCH answer. **Waits on** names the
decision above (or another QCH input) it depends on.

| Not done yet | Kind | Waits on |
| --- | --- | --- |
| A production data store (anything other than the in-memory stores) | Engineering | Decision 1 answered (SharePoint Lists); the team designs and builds it |
| Migration-history handling and a database readiness check | External, then engineering | Decision 1 |
| Staff sign-in through Entra ID | External, then engineering | Decision 5 |
| Demo sign-in for non-production demos (PRD 16.1) | Engineering | Nothing |
| Permission administration screens (grant and remove capabilities in the app, PRD 3.8) | Engineering | Nothing to build; QCH names the first administrators (policy) |
| Microsoft Graph sender, and starting the notifier and retry timer in the hosted app | Engineering, then external | Decisions 2 and 6 answered; QCH IT sets up the identity |
| Managing a Program's notification email (routing) | Engineering | Nothing; Program creation says routing is set up separately, and no screen or route sets it yet |
| Find a Program changes asked for at the midpoint (describe the need in your own words) | Requirement | PR #43 (Task D) in review; team decisions R3 and R4 in [requirements-reconciliation-register.md](requirements-reconciliation-register.md). Program information from Task C is merged (#44) |
| Further midpoint requests confirmed by QCH on Oct 26 (language of service, availability and contact shown in Find a Program, two ways to list multiple locations) | Requirement | Not built; see the register (R7, R8, R12 to R14) |
| AI-assisted matching | Not approved | Decision 7 answered: no external AI without QCH IT approval |
| Hosting, monitoring (Application Insights) and alerts | External | Decision 2 |
| Backup, restore, and one restore test in an isolated environment (PRD 19.5) | External | Decisions 1 and 2 |
| Archive behavior (500 oldest closed or completed referrals) | Engineering | Decision 4 answered; trigger wording to check |
| Retention and deletion policy | Policy | Decision 8 |
| List of planned functions, triggers and outbound dependencies for QCH IT | Engineering | Nothing; QCH IT asked for it on Oct 27 |
