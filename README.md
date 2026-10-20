# L3-Capstone-QCH

QCH Connect - L3 Capstone Project

## Database

The database schema, migrations, and synthetic development seed live in
[`db/`](db/README.md), which explains the run order and how to apply them.
Changes to them go through their own reviewed pull requests, separate from
application code.

Production Azure SQL is owned by QCH and is provided and configured through
QCH IT. Database connection details, credentials, and secrets must never be
committed to this repository. Locally they belong in the gitignored `.env`
file; in production they come from Azure Key Vault (PRD 15.2).

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

## Notifications (card 15)

`src/notifications/` sends the "new referral" email to the receiving Program
(PRD 11.2 to 11.6). It is built and tested on its own and is **not wired in
yet**: no route, server start-up, or referral code calls it.

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

Remaining tasks, not done here:

- Call `notifyReferralCommitted()` from the Direct Referral transaction once
  PR #8 merges.
- The Microsoft Graph sender, once QCH IT provides the shared mailbox and app
  registration (`NOTIFICATION_MAILBOX` and the `AZURE_*` values). It will use
  `categoryForHttpStatus()` to classify failures.
- The Azure SQL store, meeting the contract documented in
  `memoryDeliveryStore.js`.
- A timer that runs `retryPendingDeliveries()` in the hosted app.
- Azure Monitor / Application Insights alerts on final failures (PRD 11.6).

## Endpoints

| Method | Path      | Response              |
| ------ | --------- | --------------------- |
| `GET`  | `/health` | `200 {"status":"ok"}` |

`/health` reports availability and nothing else. Per PRD 15.3 and 9.12 it must
never return secrets, connection strings, config values, or error details.

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
  are edited in a follow-up once PR #16 merges.
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

## Deployment and handoff

[`docs/`](docs/README.md) holds the production deployment runbook, the list
of everything QCH IT needs to provide, the handoff checklist, and dependency
licenses (PRD 18, 19). `npm run licenses` lists every installed package's
license.

## Scope of this scaffold

Deliberately **not** built here: database code, schema, or migrations; Azure
resource provisioning; referrals; matching; reporting; Entra sign-in; roles
and permissions. Notifications exist as a standalone module, not yet wired in
(see Notifications above). Any data used for demos must be synthetic.
