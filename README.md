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
(PRD 8.2). It uses POST because the inputs describe a participant and must not
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

The database side (state columns, `program_service_area_zips`) is migration
003, in its own pull request.

## Scope of this scaffold

Deliberately **not** built here: database code, schema, or migrations; Azure
resource provisioning; referrals; matching; reporting; notifications; Entra
sign-in; roles and permissions. Any data used for demos must be synthetic.
