# L3-Capstone-QCH

QCH Connect - L3 Capstone Project

## Database

The Azure SQL schema, migrations, and synthetic development seed in
[`db/`](db/README.md) are a **design record from the earlier plan**, not the
production store. Changes to them go through their own reviewed pull
requests, separate from application code.

**Production data lives in SharePoint Lists** in a dedicated private QCH
Connect SharePoint site, reached by **Azure Functions** with a managed
identity; there is **no separate production database** (Frozen Handoff PRD
§27, §29). That architecture is confirmed; QCH IT still has to provision it.
See [`docs/production-architecture.md`](docs/production-architecture.md).
Today the app runs on in-memory stores with synthetic data. Credentials and
secrets must never be committed to this repository. Locally they belong in
the gitignored `.env` file; in production no secrets or long-lived keys go in
source or browser code (PRD §29).

## Stack

- **Frontend** — plain HTML, CSS, and JavaScript. No framework, no build step.
- **Backend** — Node.js with Express 5.
- **Tests** — Node's built-in runner (`node:test`) with supertest.

## Requirements

Node.js **24.15.0** exactly, pinned in `.nvmrc`, in `package.json` under
`"engines"`, and in `package-lock.json`. This is the team's settled development
policy (decided Oct 11). `npm run check-runtime` verifies the running version.

> **QCH's production Node version is unconfirmed.** 24.15.0 is the team's agreed
> local development version only. The version QCH runs in production remains
> pending QCH IT confirmation of the Azure App Service configuration.

## Setup

```bash
nvm use            # selects the version in .nvmrc
npm install
cp .env.example .env
```

`.env` is gitignored and must never be committed. Values marked
`PROVIDED_BY_QCH_IT` have to come from QCH IT — do not guess them and do not
reuse values from another project. In production, `AZURE_CLIENT_SECRET` and
`DATABASE_URL` come from Azure Key Vault (PRD 15.2) rather than from a `.env`
file.

## Configuration

Every variable in `.env.example`. "Read by code yet?" means this scaffold
actually loads the value — `PORT` and `NODE_ENV` are the only two.

| Variable               | What it's for                                           | Secret? | Provided by                                    | Where it lives in production                   | Read by code yet? |
| ---------------------- | ------------------------------------------------------- | ------- | ---------------------------------------------- | ---------------------------------------------- | ----------------- |
| `PORT`                 | Port the Express server listens on                      | no      | Set locally in `.env` (`.env.example` uses 3000) | App Service settings, to be confirmed by QCH IT | yes               |
| `NODE_ENV`             | Run mode; exactly `development`, `test`, or `production` | no      | Set locally in `.env`                          | App Service settings, to be confirmed by QCH IT | yes               |
| `AZURE_TENANT_ID`      | Entra ID tenant that sign-in authenticates against      | no      | QCH IT                                         | App Service settings, to be confirmed by QCH IT | no                |
| `AZURE_CLIENT_ID`      | Identifier of the Entra ID app registration             | no      | QCH IT                                         | App Service settings, to be confirmed by QCH IT | no                |
| `AZURE_CLIENT_SECRET`  | Secret for the Entra ID app registration                | **yes** | QCH IT                                         | Azure Key Vault (PRD 15.2)                     | no                |
| `AZURE_REDIRECT_URI`   | Address Entra ID returns to after sign-in               | no      | QCH IT                                         | App Service settings, to be confirmed by QCH IT | no                |
| `KEY_VAULT_URI`        | Address of the Key Vault holding the secrets            | no      | QCH IT                                         | App Service settings, to be confirmed by QCH IT | no                |
| `DATABASE_URL`         | Database connection string                              | **yes** | QCH IT                                         | Azure Key Vault (PRD 15.2)                     | no                |
| `NOTIFICATION_MAILBOX` | Shared mailbox that notifications are sent from         | no      | QCH IT                                         | App Service settings, to be confirmed by QCH IT | no                |

## Run

```bash
npm start          # http://localhost:3000
npm run dev        # same, restarts on file change
```

`PORT` and `NODE_ENV` are the only environment variables this scaffold reads.

`NODE_ENV` is **required** and must be exactly `development`, `test`, or
`production`. There is no default: if it is missing or unrecognized, the server
refuses to start (fails closed). `.env.example` sets it to `development`.

## Test

```bash
npm test
```

The suite covers:

- the server process boots and answers `/health` over real HTTP
- `/health` returns exactly `{"status":"ok"}`
- the `/health` body carries no secrets, config values, connection strings, or
  error details
- the server does not send an `X-Powered-By` header
- configuration fails closed: a missing or invalid `NODE_ENV` stops startup
- the error handler returns no stack traces or internal details, keeps valid
  4xx statuses, logs only safe metadata (never the error object or message),
  and closes the connection if a response had already started
- new-referral notifications (card 15): see Notifications below
- the accessibility and end-to-end regression suite (card 17) in
  `test/regression/`: see [docs/regression-coverage.md](docs/regression-coverage.md),
  which also holds the manual keyboard checklist

Browser tests (card 17: keyboard, focus, text size, and an axe
accessibility scan) run separately, because they need a browser:

```bash
npx playwright install chromium firefox webkit   # once per machine
npm run test:e2e                # Chromium
npm run test:e2e:browsers       # Edge, Chromium, Firefox, WebKit (docs/browser-verification.md)
```

## Notifications (card 15)

`src/notifications/` sends the "new referral" email to the receiving Program
(PRD 11.2 to 11.6).

**Wired into referral creation (Task E).** After a referral commits, the
referral service starts `notifyReferralCommitted()` for it and does not wait:
the browser gets its answer at once, and nothing the notification does can
change, delay or undo the referral. A retry of the same Submission ID starts
it again, which is safe (one delivery per referral, never a second email) and
fills the gap if the first request stopped between the commit and the
notification. `createApp({ notifier })` turns this on; without a notifier
nothing is sent.

- **`npm run dev:synthetic`** uses the simulated outbox (no email is sent)
  and runs `retryPendingDeliveries()` every 60 seconds
  (`src/notifications/retryTimer.js`: one run at a time, never throws).
  Sample Programs have invented `example.org` recipients; Program 5 has none,
  to show the `NO_RECIPIENT` failure. Each delivery logs one
  `[notification]` line with IDs and the outcome only.
- **`npm start` (production)** has no notifier yet. It needs the production
  store and the Microsoft Graph sender (see Remaining tasks).
- In the in-memory store, recipients are seeded as
  `programNotificationEmails` and kept apart from Program rows, so no
  Program read can return them. `store.notificationStore` is the delivery
  store over the referral store's committed referrals.
- Tests: `test/notificationWiring.test.js` (through the HTTP route) and
  `test/notifications.test.js` (the module on its own).

How it behaves:

- `notifyReferralCommitted({ referralId, correlationId })` runs only after the
  referral transaction commits (PRD 11.4). It never throws, and nothing it does
  can change or roll back the referral (PRD 11.6).
- The recipient is the receiving Program's `notification_email`, read
  server-side. Callers cannot pass a recipient (PRD 11.3). A Program with no
  email ends `FAILED` with category `NO_RECIPIENT`.
- The message is fixed generic text with no participant data (PRD 11.2),
  in `content.js`.
- Each delivery is one `notification_deliveries` row: `PENDING`, then `SENT`
  or `FAILED`, with IDs, counts, timestamps, a failure category, and a
  correlation ID only (PRD 11.5).
- `THROTTLED`, `UNAVAILABLE`, `TIMEOUT`, `CLAIM_EXPIRED`, and `INTERNAL_ERROR` failures stay
  `PENDING` and are retried by `retryPendingDeliveries()`, at least
  `retryAfterMs` apart (default 60s), up to `maxAttempts` (default 3). Every
  other failure ends `FAILED` at once.
- Attempt ownership: claiming an attempt bumps `attempt_count`, and every
  result is written only while the row is still at that attempt. An older
  attempt can never overwrite a newer one's result.
- An attempt may only **start** a send before
  `claim start + retryAfterMs - sendTimeoutMs`, and only if it still owns
  the row. The ownership re-read comes first; the deadline is checked after
  it, in the same synchronous step that calls `sender.send()`, so a slow
  recipient lookup or ownership read can never carry an expired attempt into
  a send. Past the deadline nothing is sent and the attempt records
  `CLAIM_EXPIRED` (retried, or `FAILED` on the last attempt). A superseded
  attempt sends nothing.
- After `sendTimeoutMs` (default 30s, must be shorter than `retryAfterMs`)
  the app **stops waiting** for the send and aborts its `AbortSignal`. That
  is best-effort: it cannot force the send to stop, and the provider may
  already have the message. So a timed-out send can still complete at the
  provider after the lease ends, even while a newer attempt is sending. Its
  late result is ignored and never written.
- Interrupted attempts: if our own step fails after the claim (recipient
  lookup, status write), the attempt is recorded as `INTERNAL_ERROR` and
  retried, or `FAILED` on the last attempt. If even that write fails, the
  retry run picks the row up later. A row stuck `PENDING` at `maxAttempts`
  is closed as `FAILED` / `INTERRUPTED`. Nothing stays `PENDING` forever.
- Logs hold IDs, outcome, attempt, category, correlation ID, and an
  allowlisted error kind (`Error`, `TypeError`, ... or `OtherError`). Never
  the recipient, subject, body, provider error text, or a raw error name
  (PRD 15.3). Final failures log at `warn` for monitoring.
- `simulatedOutbox.js` keeps messages in memory for development, tests, and
  demos (PRD 16.4). It refuses to start unless `NODE_ENV` is `development` or
  `test`.

Delivery guarantee: **at least once while attempts remain, not exactly
once.** Guaranteed: an attempt never *starts* a send after its deadline or
after losing its claim. Not guaranteed: that a started send has stopped
before a newer attempt starts. The remaining duplicates come from
provider-acceptance uncertainty, when:

- a send times out (we stop waiting) but the mail provider accepts it
  anyway, possibly while a retry is also sending, or
- the provider accepts the message and we cannot record `SENT`.

An `INTERRUPTED` row means the last attempt's outcome is unknown: the email
may or may not have gone out. The message is generic, so a duplicate only
tells the Program twice.

Remaining tasks, all waiting on QCH IT decisions (not assumed here):

- **The Microsoft Graph sender.** QCH IT has created the shared mailbox. Still
  to confirm: the Entra app registration, the Graph permission and how the
  app may send as that mailbox (Send As, application permission and any
  access policy), and the production configuration values
  (`NOTIFICATION_MAILBOX`, `AZURE_*`). The sender must meet the contract in
  `simulatedOutbox.js` and use `categoryForHttpStatus()` for failures.
- **The production store**, meeting the delivery contract in
  `memoryDeliveryStore.js`, plus each Program's notification email
  (`programs.notification_email` in the current SQL design). Where data
  lives is not decided yet.
- **Production wiring**: `src/server.js` creates the notifier and starts
  `startNotificationRetries()` once the sender and store exist, and stops
  the timer on shutdown.
- **Who sets each Program's notification email.** No screen or route sets
  it yet.
- **Monitoring**: alerts on final failures (`warn` lines, PRD 11.6) in the
  monitoring service QCH IT chooses.

## Endpoints

| Method | Path      | Response              |
| ------ | --------- | --------------------- |
| `GET`  | `/health` | `200 {"status":"ok"}` |

`/health` reports availability and nothing else. Per PRD 15.3 and 9.12 it must
never return secrets, connection strings, config values, or error details.

## Guided Program Matching (GPME, card 10)

| Method | Path                         | Response                                                        |
| ------ | ---------------------------- | --------------------------------------------------------------- |
| `GET`  | `/api/gpme/need-categories`  | `200 {"needCategories":[{needCategoryId, name}]}`               |
| `POST` | `/api/gpme/match`            | `200` with `RESULTS` or `NO_PLAUSIBLE_MATCH`; `503` with `UNABLE_TO_MATCH` |

`POST /api/gpme/match` accepts only `needCategoryIds` (required),
`ageRange: {min, max}` (optional), and `participantZip` (optional). Anything
else is rejected, so Notes and Referral Context can never reach matching
(Handoff PRD: GPME matching inputs). It uses POST because the inputs describe a participant and must not
appear in a URL (PRD 5.5). Nothing is stored.

The rules live in `src/gpme/matchPrograms.js` (rule version `gpme-v1`) and
follow the GPME Decision Proposal the team approved on Oct 18:

- A Program is **plausible** when every criterion passes, **possible** when
  none fails but at least one could not be checked, and left out when one
  fails. A fail needs a limit on file AND a participant answer outside it.
- Missing Program information is never "no restriction" (PRD 8.10).
- Explanations use Program facts only, never the participant's age or ZIP.
- Order is Department name, then Program name. It never means "better match".
- Direct Referral never calls GPME and keeps working if GPME fails (PRD 8.8).
  Inconsistent matching facts (for example service area `SET` with no ZIP
  codes) never stop the store or Direct Referral from starting; GPME reads
  them as "not on file".
- Neither GPME route accepts query parameters. Any query string gets a fixed
  `400 UNEXPECTED_FIELD` that does not echo the parameter.
- **Language of service (Task W)** is not a matching criterion. After
  matching, each result gets `serviceLanguages`: `{ status: "ON_FILE",
  names: [...] }` or `{ status: "NOT_ON_FILE", names: [] }` (never "English
  only"). If the language list cannot be read, results come back without it
  rather than failing. Program Management keeps a Program's `languageIds`
  with its matching facts; a save that leaves `languageIds` out keeps the
  saved languages. Schema: `db/migrations/004_language_of_service.sql`.
- **Write-path requirement (open, for the production store):** matching facts are validated when a Program is edited
  (`updateProgramMatchingFacts`). A relational production store must change the state
  columns and `program_service_area_zips` rows in one transaction after that
  validation, because the database cannot CHECK the state/ZIP rule across
  tables. Read-time fail-safe handling does not replace this.

The database side (state columns, `program_service_area_zips`) is migration
003 (merged in #15).

## Program maintenance (card 14, slice 14A)

| Method  | Path                                                      | Body                          |
| ------- | --------------------------------------------------------- | ----------------------------- |
| `GET`   | `/api/program-management/programs/:programId`             | none                          |
| `PATCH` | `/api/program-management/programs/:programId`             | `{ version, site?, description?, eligibilityNotes?, scheduleNotes?, costNotes? }` |
| `POST`  | `/api/program-management/programs/:programId/discontinue` | `{ version }`                 |
| `POST`  | `/api/program-management/programs/:programId/reactivate`  | `{ version }`                 |

- **Who:** an active user with an active `MANAGE_PROGRAM` grant at PROGRAM
  scope for that Program (PRD 3.6). A grant for another Program, a revoked or
  DEMO grant, admin/organization/receiving grants, DEPARTMENT or ORG scope,
  and Program affiliation do not count. Discontinue/reactivate also uses
  `MANAGE_PROGRAM` for that Program: the Program Director discontinues and
  reactivates their own Program (team decision, confirmed Oct 19).
- **How:** one transaction holds the Program for update, reads the user and
  grants with locking reads, checks the `version` the worker last saw, writes
  the change, and writes an audit event with before/after values. A stale
  version gets `409 PROGRAM_CHANGED` with the current Program; nothing is
  written. If the audit write fails, the change rolls back.
- **Not editable here:** name, Department, notification email (routing), and
  lifecycle status (only via discontinue/reactivate). GPME matching facts
  are edited through their own route in Program Management (merged in #32).
- **Lifecycle (PRD 4.4):** a discontinued Program drops out of new referral
  choices; past referrals keep it. Reactivating needs an active Department.
  A discontinue waits for any referral already being created against it.
- No query parameters are accepted. No schema change: the columns exist in
  migration 001.

## Configurable Program fields (card 14, slice 14B)

Routes are under `/api/program-management` (see `src/programs/routes.js`):
list and create a Program's fields, use an existing field in another
Program, set required/optional and display order, rename, replace,
discontinue, reactivate, retire, and manage choice options.

- **Identity follows meaning (PRD 4.3):** a wording-only change is a rename
  (same field ID). A meaning change is a replacement: the old field is
  discontinued and points to a new field used by the same Programs. Values
  collected under the old field stay with it.
- **Who:** Program-level actions need `MANAGE_PROGRAM` for that Program.
  Changing a field's definition or options needs `MANAGE_PROGRAM` for every
  Program that uses it, so the manager of one Program can't change a field
  another Program shares. Retiring needs `MANAGE_ORGANIZATION` at ORG scope
  and only after the field has been discontinued for 90 days ("approximately
  three months", team decision). Retiring deletes nothing.
- Same transaction rules as 14A: rows held for update, version checks,
  audit events (`FIELD`, `FIELD_OPTION`, `PROGRAM_FIELD`) in the same
  transaction, full rollback on audit failure.
- Only `PROGRAM_INFO` fields in this slice. No schema change.

## Program field values (card 14, slice 14B-2)

`PUT /api/program-management/programs/:programId/field-values/:fieldId`
with `{ version, value }` sets a Program's value for one field. `value: null`
clears it. Values also appear in the Program's field list (`value` on each
field).

- **Checked by data type:** TEXT (up to 2,000 characters, trimmed, line
  breaks and tabs allowed), NUMBER (fits `DECIMAL(18,4)`), DATE
  (`YYYY-MM-DD`, a real date), BOOLEAN, SINGLE_SELECT (an option ID), and
  MULTI_SELECT (a list of distinct option IDs). Empty text or an empty list
  clears the value.
- **Options:** must belong to that field and be active. An option that was
  already selected may stay selected after it is discontinued.
- **Required fields** can't be cleared (`422 VALUE_REQUIRED`). The same field
  can be required in one Program and optional in another.
- **Discontinued fields** keep their values as history but take no new ones.
- **Who:** `MANAGE_PROGRAM` for that Program.
- **Version:** the field's applicability `version` for that Program. Each
  value change (and each required/order change) moves it, so a stale save
  gets `409 PROGRAM_CHANGED` with the current state.
- Lock order is field, then applicability. The old values are replaced, the
  version moves, and a `PROGRAM_FIELD` `UPDATED` audit event with the old and
  new value is written in the same transaction. If the audit fails, nothing
  changes. No schema change.

## Creating Programs and managing Departments (card 14, slice 14C)

| Method  | Path (under `/api/program-management`)        | Body |
| ------- | --------------------------------------------- | ---- |
| `GET`   | `/departments`                                | none (each with active and total Program counts) |
| `POST`  | `/departments`                                | `{ name }` |
| `PATCH` | `/departments/:departmentId`                  | `{ version, name }` (rename) |
| `POST`  | `/departments/:departmentId/discontinue`      | `{ version }` |
| `POST`  | `/departments/:departmentId/reactivate`       | `{ version }` |
| `POST`  | `/programs`                                   | `{ departmentId, name, site?, description?, eligibilityNotes?, scheduleNotes?, costNotes? }` |
| `POST`  | `/programs/:programId/move`                   | `{ version, departmentId }` |

- **Who (PRD 3.6):** `MANAGE_ORGANIZATION` as an active ORG-scope grant
  ("Create Programs, administer Department lifecycle"). `MANAGE_PROGRAM`,
  `ADMINISTER_PERMISSIONS`, and PROGRAM-scope grants don't count.
- **Department rule (PRD 4.4):** a Department with ACTIVE Programs can't be
  discontinued; move or discontinue those Programs first. A discontinued
  Department drops out of new choices, and its Programs can't be
  reactivated until it is. Retired Departments aren't changed here.
- **New Programs** start ACTIVE in an ACTIVE Department. Nobody manages a
  new Program until a permission administrator grants `MANAGE_PROGRAM`.
  Its notification email (routing) and GPME matching facts are set up
  separately.
- **Names are unique** like the schema says (`uq_departments_name`,
  `uq_programs_name_site`), ignoring upper/lower case. Two people creating
  the same name at once can't both succeed.
- **Moving a Program** needs an ACTIVE target Department. Past referrals
  keep their historical Department context.
- **No race with the Department rule:** every change that can make a
  Program ACTIVE in a Department (create, reactivate, move in) and every
  Department change holds that Department for update first. Lock order:
  Program, then Department, then name keys. 14A's reactivate now holds
  the Department too.
- Same transaction rules as 14A/14B: version checks, `DEPARTMENT` and
  `PROGRAM` audit events in the same transaction, full rollback on audit
  failure. No schema change.

## Permission administration (Trello Task Y)

| Method | Path (under `/api/permissions`) | Body |
| ------ | ------------------------------- | ---- |
| `GET`  | `/overview` | none (staff names, Programs that are not retired, what can be granted) |
| `GET`  | `/users/:userId/grants` | none (that person's active grants) |
| `POST` | `/users/:userId/grants` | `{ permission, programId? }` (201) |
| `POST` | `/users/:userId/grants/:grantId/revoke` | `{}` |

- **Who:** an active user with `ADMINISTER_PERMISSIONS` as an
  organization-scope grant, checked on the server inside the transaction,
  so an administrator who just lost the right is refused. DEMO grants count
  only when demo grants are on (development and test).
- **What can be granted:** the receiving capabilities and `MANAGE_PROGRAM`
  for one Program, and `MANAGE_ORGANIZATION` organization-wide. The server
  picks the scope; each permission has exactly one, so no grant can be
  saved that the app would then ignore.

**Assessment against the frozen documents (October 29, 2026).** Governing
text: Frozen Handoff PRD 23 and 24, Handoff MVP 22 and 23, acceptance gates
27 and 28, Current Handoff Wireframes screen 16. PRD 24 lists what every
permission change must do (server-side authorization, validate the target
user, validate relevant Program scope, preserve least privilege, create
audit evidence, prevent self-elevation) and adds: "Implementation-specific
restrictions beyond these requirements must not be treated as QCH policy
unless QCH approves them." Each rule in this build:

| Rule | Governing requirement | Result |
| --- | --- | --- |
| Only an `ADMINISTER_PERMISSIONS` holder can change permissions, decided on the server | PRD 23 ("administrative permission management must itself require authorized administrative capability"), 24; MVP 22, 23 | Required. Kept |
| Nobody can add a permission to themselves | PRD 23, 24 (prevent self-elevation); MVP 22, 23; wireframe 16 ("cannot be used for self-elevation") | Required. Kept |
| Nobody can remove their own permissions | None. Removing is not elevation | **Removed.** Unsupported; you can now remove your own permissions. Your own administrator capability still cannot be removed here (row below) |
| Every add and removal is audited in the same transaction; a failed audit changes nothing | PRD 24 (create audit evidence), 26 | Required. Kept |
| Each permission has one honored scope; the browser never chooses it; a Program grant needs an existing, not retired Program | PRD 24 (validate relevant Program scope); MVP 22 (no trust in browser-supplied authorization claims) | Required. Kept |
| JSON-only changes (415 otherwise), empty-object revoke body | PRD 34 (security; secure error handling) | Security protection. Kept |
| Errors do not reveal whether a user exists to a non-administrator; staff names shown, never email addresses | PRD 34 (secure error handling, data minimization) | Supported. Kept |
| Duplicate grant (`ALREADY_GRANTED`) and already-removed grant (`GRANT_CHANGED`) are refused with the current list | PRD 24, 26 (accurate audit evidence) | Supported (integrity). Kept |
| DEMO grants are read-only here; new grants are always `IN_APP` | PRD 22 and MVP 22 (demo identity stays distinguishable from production), PRD 34 (environment separation) | Supported. Kept. DEMO grants exist only in development and test; seeded synthetic grants are `IN_APP` and can be removed |
| Only an organization-scope administrator capability counts | PRD 24 (least privilege). The documents define no Program- or Department-limited administrator | Supported (fail closed). Kept. **Open question Q2** |
| New grants only for active users; removal works for anyone | PRD 24 (validate the target user), read with least privilege | Supported by interpretation. Kept. **Open question Q3** |
| `ADMINISTER_PERMISSIONS` is not granted or removed on this screen | **Unclear.** PRD 24: administrators manage "appropriate" permissions, without saying whether that includes the administrator capability. Initial production users and permissions are a QCH IT production dependency (PRD 37 item 6; MVP 31 item 7). Wireframe 16 shows an Administrator role in the list, but not how it is assigned | **Not built pending open question Q1.** Not QCH policy |

**Open questions for QCH (not policy until answered):**

1. **Q1.** May authorized administrators give or remove the administrator
   capability itself on the Permissions screen, or is it assigned only
   through QCH's own process (for example, the production user and group
   configuration)? If on the screen, should the app stop the last
   administrator from being removed?
2. **Q2.** Are all permission administrators organization-wide, or may an
   administrator be limited to certain Programs or Departments?
3. **Q3.** Should new permissions be allowed for a staff account that is not
   active yet (for example, to prepare access before someone starts)?

- **Safety:** one change at a time across the whole screen (a global hold
  taken first), so two administrators cannot deadlock or both add the same
  grant. A duplicate answers 409 `ALREADY_GRANTED` and a removal of a grant
  that is already gone answers 409 `GRANT_CHANGED`, each with the current
  list. A removal waits for any receiving action already in progress for
  that person, then takes effect for the next one.
- **Audit:** every add and removal writes a `USER_GRANT` audit event
  (`GRANTED` / `REVOKED`) in the same transaction. If the audit fails,
  nothing changes. No schema change.
- **Screen:** `/permissions/` (linked from the start page).

## Referral activity report (card 12)

`GET /api/reports/referral-activity?period=&date=&programId|departmentId`
uses the same query rules and access rule as Total Referrals (any active
signed-in user, aggregate only). It returns a summary plus breakdowns by
Program and by Department: made, received, accepted, not appropriate,
awaiting response, resulted in service, and the rates from PRD 12.4.

`GET /api/reports/departments` lists every Department (ID, name and status only, including Departments with no referrals and ones no longer active) so the Reporting Center can scope a report to any of them. Same sign-in rule as the other reports. It takes no query parameters.

- **One consistent result (PRD 12.7):** every number comes from one store
  read (`aggregateReferrals`), so the total and the breakdowns always agree.
- **Rates** show `CALCULATED`, `PENDING` (nothing decided yet, but some
  could still be), or `NO_DATA`. Never 0% for "nothing decided yet".
- **History:** Programs group by Program identity; Departments group by the
  Department each Program had when the referral was created.
- **One setup and date rule for every report** (`resolveReportQuery` and
  `resolveReportDay`): a date after today in New York, or before
  2000-01-01, is a 400 on `date` for Total Referrals, Timing Metrics, and
  Referral activity alike.
- Responses, outcomes, and corrections come from cards 7 and 8; the tests
  use those real services.

## Deployment and handoff

[`docs/`](docs/README.md) holds the handoff documentation (PRD 18, 19):
the confirmed production architecture and outstanding QCH IT dependencies,
the earlier open decisions, architecture, data dictionary, admin guide,
troubleshooting, operations, the deployment runbook, everything QCH IT needs
to provide, the handoff checklist, and dependency licenses.
`npm run licenses` lists every installed package's license.

## What is built and what is not

Built and tested on in-memory stores with synthetic data: Direct
Referrals, receiving (the received list and referral screens: respond,
record and correct outcomes, correct decisions; merged in #37), Referrals
I sent (Task L, #49), Guided Program Matching, Program Management
(Programs, matching facts, fields, values, Departments, current Program
information; Task C, #44), the report APIs (Total Referrals, Timing
Metrics, Referral activity) and the Reporting Center screens (Task B, #41;
Task M), new-referral notifications started after each referral commits
(Task E, #42; simulated outbox), permission checks by grant, giving and
removing permissions (Task Y, `/permissions/`), demo sign-in for
non-production demos (Task O, #60; `npm run dev:demo`), and the audit
trail. The schema design and migrations are in `db/`.
**Not built yet:** a production data store, Entra sign-in, a way to set
a Program's notification email, the Microsoft Graph sender (notifications
run on a simulated outbox in development), and any Azure resources. Some
of these wait on QCH IT decisions;
[`docs/pending-qch-it-decisions.md`](docs/pending-qch-it-decisions.md)
says which. Any data used for demos must be synthetic.
