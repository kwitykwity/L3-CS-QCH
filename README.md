# L3-Capstone-QCH

QCH Internal Referral System - L3 Capstone Project

**QCH Connect** is a browser-based internal pre-intake referral application for Queens Community House, built by Team MISFITS. This repository currently contains the **application foundation only**: a Node.js/Express server, a plain HTML/CSS/JavaScript frontend, environment configuration validation, and a health endpoint. Referrals, matching (GPME), reporting, notifications, authentication, and the database are separate work and are not part of this foundation.

## Prerequisites

- **Node.js and npm.** The team's agreed Node.js version has **not** been confirmed, so no version is pinned in this repo (no `.nvmrc`). `package.json` sets `engines.node` to `>=20.6.0` only because the scaffold uses `node --env-file` (Node 20.6+). That is a technical minimum, not a team standard.
- **QCH production runtime is unconfirmed.** Do not assume the QCH Azure App Service runs any particular Node version until QCH IT confirms it.
- Git.

## Quick start

```bash
git clone https://github.com/kwitykwity/L3-CS-QCH.git
cd L3-CS-QCH
npm install
cp .env.example .env
npm run dev
```

Then open <http://localhost:3000>. The page should say "Server is available." and <http://localhost:3000/health> should return `{"status":"ok"}`.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start with auto-reload, loading `.env` (run `cp .env.example .env` first) |
| `npm start` | Start once, reading configuration from the real environment (how a hosted environment runs it; no `.env` is loaded) |
| `npm test` | Run the test suite (Node's built-in test runner) |

## Environment configuration

Configuration is read from environment variables and validated at startup in `src/config/`. If anything is invalid the app prints which variable is wrong (never its value) and exits. It never falls back to a guess.

| Variable | Required | Notes |
|---|---|---|
| `APP_ENV` | Always | `development`, `demo`, `test`, or `production`. Anything else fails startup. |
| `PORT` | No | Integer 1-65535. Defaults to 3000. |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `KEY_VAULT_URI`, `AZURE_SQL_SERVER`, `AZURE_SQL_DATABASE`, `GRAPH_SHARED_MAILBOX` | Only when `APP_ENV=production` | Values come from QCH IT. **Names are provisional.** A value that still contains the `<provided-by-qch-it>` placeholder is rejected. |

Production secrets (client secrets, connection strings) are not environment variables here. They belong in Azure Key Vault.

## Project structure

```
src/
  server.js          Entry point: validates config, then starts the server
  app.js             Builds the Express app (importable by tests)
  config/            Environment schema and validation
  routes/health.js   GET /health (availability only)
public/              Plain HTML/CSS/JS frontend, served statically
test/                Tests (node:test)
.env.example         Documented configuration template (placeholders only)
```

## Rules for this repository

- **No secrets.** Never commit `.env`, credentials, tokens, connection strings, or real QCH configuration values. `.env` is gitignored; `.env.example` holds placeholders only.
- **Synthetic data only.** Do not commit participant or referral data, real or de-identified.
- **QCH internal data stays out.** The QCH Program Directory and other internal QCH material must never be committed. `.gitignore` already excludes `data/private/`, `*.xlsx`, `*.pdf`, and `Program_Directory*.pdf`. Keep any local copies under `data/private/`.

## Not included yet (open dependencies)

These are intentionally not built or decided here:

- **Authorization.** No roles, groups, or permission mappings are assumed. The QCH authorization matrix is an open QCH dependency. `src/app.js` marks where authorization middleware will be registered once it is confirmed.
- **Microsoft Entra ID sign-in, Azure SQL, Key Vault, and Microsoft Graph notifications.** Not implemented. Azure resource names, Entra group names, shared mailbox, and connection details come from QCH IT.
- **Database schema and migrations.** Handled and reviewed separately.
- **CI/CD tooling.** Open with QCH IT.
- **Supported browser baseline.** Open; none is claimed.
- **Request/field size limits, retention policy, and business timezone.** Not set here; they depend on the Data Dictionary and QCH direction.

## Source of truth

Product and technical scope is defined by the team's current Mini PRD (v4, October 10, 2026). Where this README and the PRD disagree, the PRD governs and the conflict should be flagged.
