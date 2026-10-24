# Troubleshooting

Common problems when running or testing QCH Connect today, and what they
mean. Production-specific problems (hosting, the production store, Entra,
Microsoft Graph) cannot be listed yet; see
[pending-qch-it-decisions.md](pending-qch-it-decisions.md).

## Starting the app

| You see | Cause | Fix |
| --- | --- | --- |
| `npm error Missing script: "dev:synthetic"` (or another script) | The checkout is an old branch from before that script existed | `git status`, then switch to an up-to-date branch (`git checkout main && git pull`) |
| `... failed to start: NODE_ENV must be set to one of: development, test, production` | No `.env` file, or `NODE_ENV` missing or misspelled | `cp .env.example .env` (it sets `NODE_ENV=development`). In production, the deployment sets it to exactly `production` |
| `dev:synthetic runs only when NODE_ENV=development. Refusing to start.` | `dev:synthetic` is development-only on purpose | Use `NODE_ENV=development` |
| `PORT must be an integer between 1 and 65535` | `PORT` is not a number | Fix `PORT` in `.env` (default 3000) |
| `EADDRINUSE` | Something else is using the port | Stop the other process, or set another `PORT` |
| `npm run check-runtime` fails | Not Node 24.15.0 | `nvm use` (reads `.nvmrc`) |

## Using the app

| You see | Cause | What it means |
| --- | --- | --- |
| Every `/api` call answers **401** on `npm start` | No sign-in is wired in yet | Expected until Entra sign-in exists. Use `npm run dev:synthetic` |
| **503** `NOT_CONFIGURED` | Signed in, but no data store is wired in | Expected on `npm start` until a production store exists |
| `/health` answers `{"status":"ok"}` but pages show load errors | `/health` only says the server is up; it never checks the store | See the two rows above |
| **409** `AFFILIATION_REQUIRED` when sending a referral | The staff member has not chosen their Program | Choose it on the New Referral page |
| Program Management says no Programs are assigned | The person has no `MANAGE_PROGRAM` grant | No screen grants permissions yet; the synthetic dev server grants sample ones |
| Data disappeared | The in-memory store is reset every time the server stops | Expected with `dev:synthetic` and tests |

## API error codes

Every error has a stable `code` and never repeats your values back.

| Status | Codes | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` (with `fields`), `UNEXPECTED_FIELD` | Something is missing or invalid, or the request has a field or query parameter that is not allowed (including any attempt to send a `userId`) |
| 401 | `NOT_AUTHENTICATED` | No signed-in user |
| 403 | `NOT_AUTHORIZED`, `USER_NOT_ACTIVE` | The person can see the record but may not do this, or their account is inactive |
| 404 | `REFERRAL_NOT_FOUND`, `PROGRAM_NOT_FOUND`, ... | Does not exist, **or** the person may not see it (same answer on purpose) |
| 409 | `REFERRAL_CHANGED`, `PROGRAM_CHANGED`, `FIELD_CHANGED`, `DEPARTMENT_CHANGED` | Someone else changed it first. The body includes the current state for people allowed to see it |
| 409 | `ALREADY_RESPONDED`, `OUTCOME_ALREADY_RECORDED`, `OUTCOME_NOT_ALLOWED`, `OUTCOME_RECORDED`, `NO_CHANGE`, ... | The record is not in a state that allows this change |
| 422 | `VALUE_REQUIRED`, `REASON_NOT_SELECTABLE`, `PROGRAM_NOT_SELECTABLE`, ... | The value is well-formed but not allowed right now |
| 503 | `NOT_CONFIGURED` | No data store is configured |

## Tests

| You see | Fix |
| --- | --- |
| Playwright: `Executable doesn't exist` | `npx playwright install chromium` once per machine, or set `CHROMIUM_PATH` |
| Browser tests fail to start the server | Port 3217 is in use; stop the other process |
| `test/docs.test.js` fails after editing docs | A link points to a missing file, `.env.example` and `qch-it-requirements.md` disagree, the dependency table is out of date, or a doc contains something shaped like a secret or a QCH email address |
| A test about audit rules fails | A change wrote an audit event the schema rules would refuse; see [`db/AUDIT_VERIFICATION.md`](../db/AUDIT_VERIFICATION.md) |

## Logs

What the server writes today (to standard output and error):

- **Unexpected errors:** one `[error]` line with the method, a safe form of
  the path, the status, an allowlisted error kind and the error code. Never
  the error message or stack trace.
- **Notifications** (when the module runs): `[notification]` lines with
  IDs, outcome, attempt, failure category and correlation ID. Final
  failures are logged at `warn`.
- **Start-up:** the listening line, or the reason start-up failed.

Ordinary requests and expected refusals (400, 401, 403, 404, 409) are not
logged; there is no request log yet. Nothing logged ever contains
participant names, contact details, referral context, notes, Not
Appropriate explanations, or text from outside services (PRD 15.3). Each
change's correlation ID is stored on its audit event.
