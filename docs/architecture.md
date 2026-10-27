# How QCH Connect is built today

**Status: draft.** Part of the handoff documentation. It does not complete production deployment, restore verification, or QCH handoff acceptance.

For a technical person picking up the code. It describes the application
as it exists on `main`, not the planned production setup. Decisions that
are still open with QCH IT are in
[pending-qch-it-decisions.md](pending-qch-it-decisions.md).

## In one paragraph

QCH Connect is an internal referral system for QCH staff. A worker finds a
Program (Direct Referral, or rules-based Guided Program Matching) and sends
a referral; the receiving Program responds (Accepted or Not Appropriate),
and later records whether the referral resulted in service. Program staff
maintain their Programs' information, and reports give aggregate numbers.
It is one Node.js server (Express 5) that serves plain HTML, CSS and
JavaScript pages and a JSON API. There is no front-end framework and no
build step.

## Where it runs today

| How it starts | What you get |
| --- | --- |
| `npm start` (`src/server.js`), the production entry point | The pages and `GET /health`. Every `/api` route answers **401**, because no sign-in is wired in, and would answer **503** after that, because no data store is wired in. This is deliberate: it fails closed. |
| `npm run dev:synthetic` (`scripts/dev-synthetic-server.js`) | The whole app on an in-memory store with synthetic data and one fixed developer identity (who also receives referrals for one sample Program), on 127.0.0.1 only. Refuses to start unless `NODE_ENV=development`. This is how the team and the browser tests use the app. |
| Tests (`npm test`, `npm run test:e2e`) | Each test builds the app with its own in-memory store and its own `resolveIdentity`. |

Requirements: Node.js 24.15.0 for development (pinned in `.nvmrc` and
`package.json`), and `NODE_ENV` set to `development`, `test` or
`production`. See the README for setup.

## Folder map

| Folder | What is in it |
| --- | --- |
| `src/app.js`, `src/server.js`, `src/config.js`, `src/errorHandler.js` | Builds the Express app, reads configuration (fails closed), and the error handler that never returns stack traces or internal details |
| `src/referrals/` | Referral creation, the received and sent lists, response, service outcome and corrections, the derived stage, audit rules, and the in-memory referral store |
| `src/affiliation/` | The Program list for referrals, the staff member's own Program affiliation, and the base in-memory store |
| `src/gpme/` | Guided Program Matching: input validation, the matching rules (`matchPrograms.js`, rule version `gpme-v1`), and Program facts |
| `src/programs/` | Program Management: Program information and lifecycle, matching facts, configurable fields and options, Departments, creating and moving Programs |
| `src/reporting/` | Aggregate reports: Total Referrals, Timing Metrics, Referral activity |
| `src/notifications/` | New-referral email delivery with retries, started after each referral commits (Task E) and a retry timer. Only a simulated outbox exists; production has no notifier yet |
| `src/authorization/` | Capability, resource and scope checks shared by every service |
| `public/` | The pages: start page, `referral/` (New Referral), `receiving/` (received referrals), `program-management/`, and their scripts and one shared stylesheet |
| `db/` | The current SQL schema design (migrations 001 to 003), a synthetic dev seed, and audit checks. Not used by the running app yet |
| `scripts/` | The synthetic dev server and its seed, the runtime check, and the license lister |
| `test/`, `e2e/` | Node tests (`node:test`, supertest) and Chromium browser tests (Playwright, axe) |
| `docs/` | These documents |

## What happens on a request

1. **Page.** The browser loads a page from `public/` and calls the API with
   `fetch`. Participant data only ever travels in a request body, never in
   a URL or browser storage (PRD 5.5). Only the text-size preference is
   stored in the browser.
2. **Router** (`src/*/routes.js`). Marks the response `Cache-Control:
   no-store`, asks `resolveIdentity(req)` who is calling (no identity:
   401), checks a store exists (none: 503), gives the request a random
   correlation ID, allowlists query parameters, and limits the body size.
   The browser can never say who it is: a `userId` in a body or query is
   refused.
3. **Service** (`src/*/*Service.js`). Inside one store transaction: loads
   the user and their active permission grants, loads the record being
   changed and holds it, checks the capability for that record's Program
   (or organization), validates the request, checks the `version` the
   worker last saw, writes the change, and writes its audit event. If
   anything fails, nothing is written. A stale version gets a 409 with the
   current state instead of a merge.
4. **Store** (the contract). Today only the in-memory stores implement it.
   Their header comments list every operation and, where written, the SQL
   it would run.
5. **Response.** Only the fields the screen needs (PRD 10.5). Errors carry
   a stable `code` and never echo values back.

## Who may do what

Entra ID (once built) decides who can open the app. What a person may do
inside it is decided by **grants** stored in QCH Connect (`user_grants`),
each a capability at a scope (PRD 3.4, 3.6). Every check happens on the
server; the pages only hide buttons the server says are not available.

| Capability | Scope used today | Lets a person |
| --- | --- | --- |
| (every signed-in active user) | | Send referrals from their own Program affiliation; see referrals they created; see aggregate reports |
| `VIEW_RECEIVED_REFERRAL` | Program | See referrals sent to that Program |
| `RESPOND_TO_REFERRAL` | Program | Accept a referral, or mark it Not Appropriate with a reason |
| `RECORD_OUTCOME` | Program | Record whether an accepted referral resulted in service |
| `CORRECT_OUTCOME` | Program | Correct a recorded service outcome |
| `UPDATE_RECEIVED_REFERRAL` | Program | Correct a decision (Accepted / Not Appropriate, reason, explanation) |
| `MANAGE_PROGRAM` | Program | Maintain that Program's information, lifecycle, matching facts, fields and values |
| `MANAGE_ORGANIZATION` | Organization | Create and move Programs, manage Departments, retire fields |
| `ADMINISTER_PERMISSIONS` | | Defined in the schema; no feature uses it yet (permission administration is not built) |
| `VIEW_UNDERLYING_REFERRAL` | | Defined in the schema; no feature uses it yet |

A person who cannot view a referral gets the same 404 as for a referral
that does not exist, so an ID reveals nothing. A person who can view it
but lacks the capability gets 403. `DEMO` grants are honored only in
development and test; asking for them in production stops the app at
start-up.

## The API

All routes except `/health` need a signed-in user. Request and response
details are in the README sections and the header comment of each
`routes.js`.

| Area | Routes |
| --- | --- |
| Health | `GET /health` |
| Programs and affiliation | `GET /api/programs`, `GET` / `PUT /api/me/affiliation` |
| Guided matching | `GET /api/gpme/need-categories`, `POST /api/gpme/match` |
| Referrals | `POST /api/referrals`, `GET /api/referrals/submissions/:submissionId`, `GET /api/referrals/received`, `GET /api/referrals/sent`, `GET /api/referrals/:referralId`, `GET /api/referrals/not-appropriate-reasons` |
| Response, outcome, corrections | `POST /api/referrals/:id/response`, `POST .../outcome`, `POST .../outcome/correction`, `POST .../response/correction` |
| Reports | `GET /api/reports/total-referrals`, `GET /api/reports/timing-metrics`, `GET /api/reports/referral-activity`, `GET /api/reports/departments` |
| Program Management | Under `/api/program-management`: Programs (list, read, update, discontinue, reactivate, matching facts), fields (list, available, create, apply, settings, values, rename, replace, discontinue, reactivate, retire), options, Departments, creating and moving Programs |

## Screens

| Page | What it does | State |
| --- | --- | --- |
| `/` | Start page with links and a backend status | Temporary; to be replaced by navigation (PRD 13.5) |
| `/referral/` | Choose a Program (guided matching or Direct Referral) and send a referral | Built |
| `/program-management/` | Program information and lifecycle, matching facts, fields and options, field reuse and replacement, Departments, creating and moving Programs | Built |
| `/sent/` | Referrals I sent: the creator's own referrals and each one's Response, Decision and Service outcome, read-only | Built (Trello Task L) |
| `/receiving/` | Received referrals, respond, record and correct outcomes | Built (Trello Task A, merged in #37 as e3fd11e) |
| `/reporting/` | Reporting Center: aggregate counts, rates and timing by period and scope | Built (Trello Task B, merged in #41) |
| Permission administration | | Not built |

Every page supports keyboard-only use, S/M/L/XL text sizes and light and
dark themes; see [regression-coverage.md](regression-coverage.md).

## Tests

- `npm test` runs every Node test, including the security inventory of
  protected routes (`test/securityPass.test.js`), the audit rules and
  coverage, the docs checks, and the accessibility structure checks for
  every page.
- `npm run test:e2e` runs the Chromium browser tests against the synthetic
  dev server or a private copy of the app. Install Chromium once with
  `npx playwright install chromium`.

What the tests cannot show yet: anything about the production store, Entra
sign-in, Microsoft Graph, or QCH's hosting.
