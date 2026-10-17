# Deployment runbook

**Status: draft, not yet exercised.** The steps follow the order PRD 18.2
requires: known source, approved configuration, controlled migrations,
deployment, verification. Every blank marked **PROVIDED BY QCH IT** waits on
the items in [qch-it-requirements.md](qch-it-requirements.md). No resource
names or deployment tools are guessed here.

## Environments

Production and development or demo are kept apart (PRD 18.1, 16.4).
Production is always a fresh deployment into QCH-owned Azure, never a copy of
a demo environment.

| | Development / demo | Production |
| --- | --- | --- |
| `NODE_ENV` | `development` or `test` | `production` |
| Data | Synthetic only | Real QCH data |
| Sign-in | Team demo sign-in, labeled on screen | Microsoft Entra ID only |
| Notifications | Simulated in-app outbox | Microsoft Graph through the QCH shared mailbox |
| Reset and seed | Allowed, synthetic only | Never |
| Secrets | `.env` file on the developer's machine (gitignored) | Azure Key Vault and App Service settings |

## 1. Pick a known version of the source

Deploy only a specific, reviewed commit or tag from the QCH-owned repository
(PRD 18.2, 19.3). Record which one.

```bash
git fetch
git checkout <release tag or commit>   # PROVIDED BY the release owner
npm ci
npm test
npm run check-runtime
```

- `npm ci` installs the exact versions in `package-lock.json`.
- `npm test` must end with 0 failures.
- `npm run check-runtime` confirms Node 24.15.0, the team's development
  version. The production Node version on App Service is **PROVIDED BY QCH
  IT**.

## 2. Set the configuration

Every variable, what it does, and where it lives in production is listed in
[qch-it-requirements.md](qch-it-requirements.md) and the README
Configuration table.

- `NODE_ENV` must be exactly `production`. The app refuses to start with a
  missing or unknown value.
- `PORT` is whatever App Service expects. **PROVIDED BY QCH IT.**
- Secrets (`AZURE_CLIENT_SECRET`, `DATABASE_URL`) come from Azure Key Vault,
  never from a `.env` file or source code (PRD 15.2).
- Production must never fall back to demo sign-in, development defaults, or
  an unapproved service (PRD 18.5).

## 3. Apply database migrations

Migrations are applied on purpose, before the new app version starts. The app
never changes the production schema on its own (PRD 9.8, 18.3).

- Follow `db/README.md` for run order, the required `sqlcmd -I -b` flags, and
  what to do if a run fails partway. (That file arrives when PR #4 merges.)
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
| Database reachable | A readiness check that reports database availability only | Not built yet |
| Staff sign-in | A QCH test account can sign in through Entra ID | Not built yet |
| Notification send | A test notification reaches the shared mailbox | Not built yet |

`/health` reports only that the app is up. It never returns secrets,
connection strings, or error details (PRD 9.12, 15.3).

## 6. If verification fails

1. Stop. Do not run further migrations.
2. If the cause is configuration, fix the configuration and verify again.
3. Otherwise, redeploy the last known-good commit and verify again.
4. Rolling back the app does **not** roll back the database (PRD 18.4). A
   database restore follows QCH's backup and restore procedure, **PROVIDED BY
   QCH IT.**

## Never in production

- Demo sign-in, synthetic reset or seed, or the simulated notification outbox.
- Secrets in source code, in a committed file, or in the browser.
- Direct SQL edits as a normal way to change data. Any exceptional correction
  must be authorized, documented, and auditable (PRD 9.12).
- Production data copied to a developer machine or outside service (PRD 15.5).
