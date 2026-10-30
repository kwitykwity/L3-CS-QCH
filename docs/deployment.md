# Deployment runbook

**Status: draft, not yet exercised.** The steps follow the order PRD 18.2
requires: known source, approved configuration, controlled migrations,
deployment, verification. Every blank marked **PROVIDED BY QCH IT** waits on
the items in [qch-it-requirements.md](qch-it-requirements.md). No resource
names or deployment tools are guessed here.

**The production architecture is now confirmed, and parts of this page
predate it.** The Frozen Handoff PRD (§21, §22, §27 to §31) confirms
SharePoint Lists in a dedicated private site with **no separate production
database**, **Azure Functions** with a managed identity as the server side,
Graph `Sites.Selected`, mail from the shared mailbox through Exchange RBAC for
Applications, and Entra ID single sign-on with MFA; see
[production-architecture.md](production-architecture.md). Steps that name
App Service, Azure SQL, Key Vault or `sqlcmd` describe the **earlier plan and
are superseded**; they are kept only until a runbook for the confirmed
architecture can be written, which needs QCH IT's provisioning first. No
production store exists yet: `npm start` today serves the pages and
`/health`, and every `/api` route answers 401.

## Environments

Production and development or demo are kept apart (PRD 18.1, 16.4).
Production is always a fresh deployment into QCH-owned Azure, never a copy of
a demo environment.

| | Development / demo | Production |
| --- | --- | --- |
| `NODE_ENV` | `development` or `test` | `production` |
| Data | Synthetic only | Real QCH data |
| Sign-in | Preconfigured synthetic demo identities chosen on screen, no username or password, labeled on screen ([demo-environment.md](demo-environment.md)) | Microsoft Entra ID single sign-on with MFA only |
| Notifications | Simulated in-app outbox | Microsoft Graph through the QCH shared mailbox, restricted through Exchange RBAC for Applications |
| Reset and seed | Allowed, synthetic only | Never |
| Data | In-memory stores, rebuilt on every start | SharePoint Lists in a private QCH Connect site (no separate database) |
| Server side | One Node.js app | Azure Functions with a managed identity |
| Secrets | `.env` file on the developer's machine (gitignored) | No secrets or long-lived keys in source or browser code (PRD §29). Earlier plan: Key Vault and App Service settings |

## 1. Pick a known version of the source

Deploy only a specific, reviewed commit or tag from the QCH-owned repository
(PRD 18.2, 19.3). Record which one.

```bash
git fetch
git checkout <release tag or commit>   # PROVIDED BY the release owner
npm ci
npm test
```

- `npm ci` installs the exact versions in `package-lock.json`.
- `npm test` must end with 0 failures.
- Node version, development vs production:
  - `npm run check-runtime` checks for exactly Node 24.15.0, the team's
    settled **development** version. Use it on developer machines and any
    build machine that is meant to match development.
  - QCH IT must confirm the supported Node.js runtime for the Azure Functions
    deployment. The development pin alone does not establish compatibility
    with that hosting environment. Validate the production implementation
    and its dependencies on the selected runtime before deployment.
  - **If QCH IT selects a production Node version other than 24.15.0,** the
    team must first reconcile the repository with it: update the exact pin
    in `.nvmrc`, `package.json` `engines`, `package-lock.json`, and
    `scripts/check-runtime.js`
    (and its test), run `npm ci` and the full `npm test` on that version,
    and merge that change through a reviewed pull request. Only then deploy.
    Do not deploy a version the repository and its tests were not validated
    on.

## 2. Set the configuration

The production configuration procedure for Azure Functions and Microsoft
Entra ID remains to be implemented and verified with QCH IT. See
[qch-it-requirements.md](qch-it-requirements.md) and
[production-architecture.md](production-architecture.md).

- Azure Functions uses a managed identity for approved service access.
- QCH IT supplies the approved Entra configuration and any required
  secret-management arrangements. No real values belong in this repository.
- `AZURE_CLIENT_SECRET`, `DATABASE_URL` and `KEY_VAULT_URI` are earlier-plan
  placeholders, not instructions to create a production database or secrets.
- `PORT` belongs to the current Node.js development/server entry point;
  confirm the Azure Functions hosting configuration with QCH IT.
- The current production Node.js entry point requires `NODE_ENV=production`
  and fails closed without identity integration. It is not a completed
  Azure Functions deployment.
- Production must never use demo identity selection or development defaults.

## 3. Apply database migrations

**Superseded: does not apply to the confirmed architecture.** There is no
separate production database (PRD §27), so the Azure SQL migrations in `db/`
are not run in production. The text below is the earlier plan, kept for
reference. Whatever store is chosen, the same rule holds: its
structure is changed on purpose, before the new app version starts, never
by the app on its own (PRD 9.8, 18.3).

- Follow [`db/README.md`](../db/README.md) for run order, the required
  `sqlcmd -I -b` flags, and what to do if a run fails partway. The current
  migrations are 001 and 002 (merged in PR #4) and 003 (merged in PR #15),
  applied in that order.
- Test every migration outside production first.
- Write down which migrations were applied, to which database, from which
  commit, by whom, and when. The database does not record this itself yet
  (remaining task: migration-history handling).
- Who runs production migrations, and with which account: **PROVIDED BY QCH
  IT.**

## 4. Deploy the app

The deployment tool or pipeline is **PROVIDED BY QCH IT** (PRD 22). Whatever
the tool, a deployment must:

- deploy the exact commit chosen in step 1;
- install dependencies with `npm ci --omit=dev`;
- start the app with `npm start` (runs `node src/server.js`);
- use the configuration from step 2.

## 5. Verify the release

A release counts as successful only after these checks pass (PRD 18.4).

| Check | Expected | Today |
| --- | --- | --- |
| `GET /health` | `200` with body exactly `{"status":"ok"}` | Built |
| Startup log | `QCH Connect listening on ... (production)`, and no startup error | Built |
| Data store reachable | A readiness check that reports only whether the SharePoint Lists can be reached (earlier plan: the database) | Not built yet |
| Staff sign-in | A QCH test account can sign in through Entra ID single sign-on, with MFA as QCH policy requires | Not built yet |
| Notification delivery | A test referral to a QCH-approved test Program sends one email **from** the shared mailbox that **arrives in that Program's configured, authorized recipient inbox** (not just leaves the mailbox). The email is generic with no participant data, and the delivery row ends `SENT`. Use synthetic referral data only. | Not built yet |

`/health` reports only that the app is up. It never returns secrets,
connection strings, or error details (PRD 9.12, 15.3).

## 6. If verification fails

1. Stop. Do not run further migrations.
2. If the cause is configuration, fix the configuration and verify again.
3. Otherwise, consider redeploying the last known-good commit. **First
   confirm that commit works with the schema already applied to the
   database.** Rolling back the app does **not** roll back the database
   (PRD 18.4), so the older app must run correctly against any migrations
   this release already applied.
   - Compatible (for example the new migrations only added columns or
     tables the older app ignores): redeploy it and verify again.
   - Not compatible, or unknown: do **not** redeploy it. Treat it as a
     database recovery and follow QCH's backup and restore procedure,
     **PROVIDED BY QCH IT**, together with QCH IT.
4. Record what was checked and decided.

## Never in production

- Demo sign-in, synthetic reset or seed, or the simulated notification outbox.
- Secrets in source code, in a committed file, or in the browser.
- Direct SQL edits as a normal way to change data. Any exceptional correction
  must be authorized, documented, and auditable (PRD 9.12).
- Production data copied to a developer machine or outside service (PRD 15.5).
