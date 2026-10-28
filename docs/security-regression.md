# Security and authorization regression (Task F)

**Status: draft.** What the security tests cover for the application as it
exists on `main` (after #41), what they found, and what must be re-run once
QCH IT confirms the production architecture
([pending-qch-it-decisions.md](pending-qch-it-decisions.md)). All tests run
on the in-memory store through the application/store contract, with
synthetic data. They do not depend on Azure SQL or SharePoint.

## The two suites

| Suite | What it proves |
| --- | --- |
| `test/securityPass.test.js` (card 16) | For **every** route: no sign-in gets 401; an unknown or inactive user gets 403; responses are never cached; unknown query parameters and server-controlled body fields (`userId`, `role`, ...) are refused without echoing them; malformed referral IDs never reach the store; identity never comes from headers, query or body; errors and logs never carry participant data; unknown routes get a fixed 404; demo controls fail closed in production. A test fails if a route is added without a row. |
| `test/regression/securityRegression.test.js` (Task F) | For every route that **changes** data, an active, signed-in person **without** the right capability, resource or scope is refused (403 or 404) and **nothing in the store changes**, while the allowed person succeeds with the exact same request (so the refusal is about permission, not a bad request). The same for resource reads. DEMO grants count only when demo grants are on. Malformed Program Management IDs are refused (400/404, never 500). No response ever carries a Program's notification email; lists and reports never carry contact details, notes or Not Appropriate explanations; no log line carries participant data. A test fails if a route that changes data is added without a row. |

Both run with `npm test`.

## Result

**No defects found.** Every unauthorized request in the matrix was refused
with 403 or 404 and left the store unchanged; nothing sensitive appeared in
a response or a log line. To check that the new suite really catches
problems, three faults were introduced on purpose and then removed:

| Fault introduced | Tests that failed |
| --- | --- |
| DEMO grants honored even with demo grants off | 37 |
| Program edit skipping its permission check | 7 |
| Program view returning every stored column | 1 |

## Privacy and data-leakage regression (Task DD)

Checks that participant and referral information stays inside the
referral record (PRD 5.3, 5.4, 5.5, 11.2, 12, 15.3). Two new files sit on
top of the suites above and do not repeat them:

- `test/regression/privacyRegression.test.js` (`npm test`): the whole app
  as the synthetic dev server builds it, driven with marked synthetic data
  through describe the need, matching, GPME-assisted and Direct
  Referral, Not Appropriate with an explanation, corrections, a failed
  audit, every report, and notification sending (including a NO_RECIPIENT
  failure); plus an interpreter that fails while holding the worker's
  text, and 22 refused or invalid requests that carry the markers.
- `e2e/privacy.spec.js` (`npm run test:e2e`): one referral carried through
  every screen in Chromium, recording every request, page address and
  console message, then checking storage and every cookie (HttpOnly too).

| Acceptance item | Where it is checked |
| --- | --- |
| No participant data in URLs or query strings | `e2e/privacy.spec.js`: every request and page address; page addresses carry numeric IDs only. Server routes refuse unknown query parameters without echoing them (`securityPass`) |
| No sensitive data in browser storage | `e2e/privacy.spec.js`: localStorage holds only the text size; sessionStorage, IndexedDB, Cache Storage and service workers are empty after the whole journey. Also `e2e/gpme.spec.js` for the describe step |
| No participant data in cookies | `e2e/privacy.spec.js` reads the browser's own cookie jar (`page.context().cookies()`), so HttpOnly cookies, which `document.cookie` cannot see, are checked too: no cookie name or value carries a marker. **Scope:** the e2e fixture is the fixed-identity dev server, which sets no cookies, so that test also expects an empty jar. That expectation does not apply to the Task O demo (`npm run dev:demo`), which legitimately uses an HttpOnly session cookie. `privacyRegression` covers the demo: every `Set-Cookie` through sign-in, a referral, a Not Appropriate response, switching person and sign-out is only `qch_demo_session` with a random 32-character token (or the sign-out clear), and carries no marker. Production cookies wait on Entra sign-in (decision 5) |
| Logs and console carry no participant data or free text | `privacyRegression` (every console channel, whole workflow, failures included); `e2e/privacy.spec.js` (browser console and page errors); `securityPass`, `errorHandler`, `notificationWiring` |
| Notifications stay generic | `privacyRegression` (every email sent in the run); `notifications`, `notificationWiring` |
| Reporting is aggregate only | `privacyRegression`: every report, two periods, no markers and no referral fields; `securityRegression` |
| Unauthorized and error responses leak nothing | `privacyRegression` (22 invalid requests, an unknown user, no sign-in); `securityPass`, `securityRegression` |
| Describe-the-need text stays transient | `privacyRegression` (not echoed, not logged even when the interpreter fails holding it); `gpmeInterpretation`, `e2e/gpme.spec.js` |

**Result: no leaks found, no code changed.** By design, the receiving
queue shows the need (referral context) to the authorized receivers so they
can triage; the PRD keeps it out of logs, reports, search and emails, not
out of the receivers' own queue. The describe step proposes the ZIP it
read back to the worker; it never echoes the text. Report data comes from
a store query that returns counts only, so a report cannot carry a name
unless that query changes.

To check that the new tests catch real leaks, faults were planted and then
removed. Each one made a test fail:

| Fault planted | Caught by |
| --- | --- |
| Interpreter failures logged with the error message | `privacyRegression` |
| The response route logs its request body | `privacyRegression` |
| Referral errors echo the request body | `privacyRegression` |
| The receiving page logs its text to the console | `e2e/privacy.spec.js` |
| The sent page copies itself into sessionStorage | `e2e/privacy.spec.js` |
| The sent list puts a name in the page address | `e2e/privacy.spec.js` |
| The sent list sends a name in a query string | `e2e/privacy.spec.js` |
| Creating a referral sets an HttpOnly cookie holding the participant's name (invisible to `document.cookie`) | `e2e/privacy.spec.js` and `privacyRegression` (demo cookie test) |

When the SharePoint store and Azure Functions hosting are built (R19, R20
in [requirements-reconciliation-register.md](requirements-reconciliation-register.md)),
re-run both files against them. The Functions host's own logging
(Application Insights) must be checked then too.

## Route inventory

49 API routes (30 use POST, PUT or PATCH: 27 change shared data, 3 are self-service or read-only), plus `GET /health` (public, availability only). People used
in the tests: a referrer with no grants, receivers with all, view-only or
another Program's receiving capabilities, Program managers for this or
another Program or only at Department/Organization scope, organization
administrators, a permission administrator, DEMO-granted copies of these,
and an active user with no grants.

### Routes that change data

| Route | Who may | Refused in the tests (403/404, no change) |
| --- | --- | --- |
| `POST /api/referrals` | Any active user, from their own affiliation | Self-service: sign-in, inactive user and identity fields (card 16) |
| `PUT /api/me/affiliation` | The signed-in user, for themselves only | Self-service (card 16) |
| `POST /api/gpme/match` | Any active user; stores nothing | Read-only (card 16) |
| `POST /api/referrals/:id/response` | `RESPOND_TO_REFERRAL` for the receiving Program | Referrer, view-only, another Program's receiver, DEMO receiver, Program manager, org admin, permission admin, no grants |
| `POST /api/referrals/:id/outcome` | `RECORD_OUTCOME` for the receiving Program | Same |
| `POST /api/referrals/:id/outcome/correction` | `CORRECT_OUTCOME` for the receiving Program | Same |
| `POST /api/referrals/:id/response/correction` | `UPDATE_RECEIVED_REFERRAL` for the receiving Program | Same |
| `PATCH /api/program-management/programs/:id` | `MANAGE_PROGRAM` for that Program | Another Program's manager, Department/Org-scope manager, DEMO manager, org admin, receiver, permission admin, no grants |
| `POST .../programs/:id/discontinue`, `.../reactivate` | Same | Same |
| `PUT .../programs/:id/matching-facts` | Same | Same |
| `POST .../programs/:id/fields` | Same | Same |
| `POST`, `PATCH .../programs/:id/field-applicability/:fieldId` | Same | Same |
| `PUT .../programs/:id/field-values/:fieldId` | Same | Same |
| `PATCH .../fields/:fieldId`; `POST .../fields/:fieldId/replace`, `/discontinue`, `/reactivate` | `MANAGE_PROGRAM` for **every** Program using the field | Same |
| `POST .../fields/:fieldId/options`; `PATCH .../options/:optionId`; `POST .../options/:optionId/discontinue`, `/reactivate` | Same | Same |
| `POST .../fields/:fieldId/retire` | `MANAGE_ORGANIZATION` (ORG), 90 days after discontinuing | Program manager, Department/Org-scope manager, DEMO org admin, permission admin, receiver, no grants |
| `POST .../departments`; `PATCH .../departments/:id`; `POST .../departments/:id/discontinue`, `/reactivate` | `MANAGE_ORGANIZATION` (ORG) | Same |
| `POST .../programs`; `POST .../programs/:id/move` | `MANAGE_ORGANIZATION` (ORG) | Same |

### Routes that read data

| Route | Who may read | Tested |
| --- | --- | --- |
| `GET /api/referrals/:id` | The creator, and receivers with `VIEW_RECEIVED_REFERRAL` for the receiving Program | Everyone else gets 404, the same answer as a missing referral |
| `GET /api/referrals/received` | Receivers, only for their Programs | `?programId=` of another Program: 403/404; without it, others see an empty list |
| `GET /api/referrals/sent` | The creator's own referrals | Others see an empty list |
| `GET /api/referrals/submissions/:submissionId` | The creator's own submission | Another user's ID reads as not received (card 16) |
| `GET /api/referrals/not-appropriate-reasons`, `/api/programs`, `/api/me/affiliation`, `/api/gpme/need-categories` | Any active user | Reference data or the caller's own record; no notification email |
| `GET .../programs`, `.../programs/:id`, `/matching-facts`, `/available-fields`, `/fields` | `MANAGE_PROGRAM` for that Program | Others: 403/404, or the Program is left out of the list |
| `GET .../organization-programs`, `.../departments` | `MANAGE_ORGANIZATION` (ORG) | Others: 403/404 |
| `GET /api/reports/total-referrals`, `/timing-metrics`, `/referral-activity`, `/departments` | Any active user; aggregate only | No referral content, contact details, notes or explanations (both suites) |

## Not covered here, and why

- **Notifications.** Referral creation starts the notification module after
  each referral commits (Task E, merged in #42). Its security tests live in
  `test/notificationWiring.test.js`: the recipient is server-derived and
  never returned, a request cannot supply one, and no participant data
  reaches the email, the delivery row or the logs. It adds no routes, so
  this inventory stays complete.
- **Open pull requests that add routes** (for example Task D #43, which
  adds `POST /api/gpme/interpret`). The inventory test fails until each new route that changes data
  gets a row here, so none can merge unaccounted for.
- **Security headers.** The application sets `Cache-Control: no-store` on
  every API response and hides `X-Powered-By`, but no other security
  headers (for example `Content-Security-Policy`,
  `X-Content-Type-Options`, `Strict-Transport-Security`). Whether these
  are set by the app or by QCH's hosting in front of it is part of the
  hosting decision; see below.

## Dependency update and stale pull requests (Task P)

The `body-parser` security update (#35) and the security claims of the
closed pull requests #17 and #29 are checked against `main` in
[stale-pr-verification.md](stale-pr-verification.md). #17's
transaction-authorization protection is covered on `main`, and #29 is
superseded.

## Re-run once QCH IT confirms the production architecture

These depend on choices that are still open. Each must be verified against
the real production setup; passing on the in-memory store does not prove
them.

| Area | What to verify | Waits on |
| --- | --- | --- |
| Production store | Both suites above, unchanged, against the production store implementation. The store contract's locking reads, single conditional updates (two concurrent responses cannot both succeed), the Submission ID unique constraint, row versions for stale changes, and audit events in the same transaction (a failed audit rolls the change back) | Decision 1 (where data lives) |
| Production store | Queries are parameterized (no string-built SQL or list filters); Program reads never select the notification email; the runtime identity cannot change the schema | Decision 1 |
| Sign-in | The real `resolveIdentity`: token signature, issuer, audience and expiry checked; an Entra account with no active QCH Connect user gets 403; no fallback identity in production; session cookie `Secure`, `HttpOnly`, `SameSite` | Decision 5 (Entra) |
| Sign-in | If sign-in uses a cookie, every route that changes data is protected against cross-site requests (CSRF), for example `SameSite` plus an origin check or token | Decision 5 |
| Hosting | HTTPS only (TLS 1.2+), HSTS, security headers (CSP, `X-Content-Type-Options`, frame protection), request size limits at the edge, no directory listing | Decision 2 |
| Logs and monitoring | Logs sent to the monitoring service carry no participant data, recipient addresses or secrets; final notification failures alert | Decision 2 |
| Notifications | The Graph sender sends only as the shared mailbox and is limited to it (least-privilege permission or access policy); provider errors are stored and logged as categories only | Decisions 6 and 2 |
| Secrets | Secrets come from Key Vault (or QCH's choice); none in the repository, configuration files or logs | Decision 2 |
| Demo sign-in | When demo sign-in (PRD 16.1) is built: it cannot be turned on in production, and demo identities cannot reach production data | Engineering (not built) |
| Permission administration | When the screens to grant and remove capabilities are built: only `ADMINISTER_PERMISSIONS` holders may use them, every change is audited, and a person cannot grant themselves anything | Engineering (not built) |
