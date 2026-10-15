# L3-Capstone-QCH

QCH Internal Referral System - L3 Capstone Project

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

## Scope of this scaffold

Deliberately **not** built here: database code, schema, or migrations; Azure
resource provisioning; referrals; matching; reporting; notifications; Entra
sign-in; roles and permissions. Any data used for demos must be synthetic.
