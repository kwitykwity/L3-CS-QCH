# Freeze candidate audit (Task V)

**Status: practice run, not the freeze decision.** Run on `main` at
`36f6e82` on October 26, 2026. The Task V card says to run the audit after
the integration batch is complete, and two pieces of code are still coming:
PR #43 (Task D) and Task O (demo sign-in). This practice run finds problems
early. The real run repeats every check on the freeze candidate before
Nov. 2; see [Re-run on the freeze candidate](#re-run-on-the-freeze-candidate).

The freeze decision belongs to Christina. This page gives her the evidence.

How findings are classified (from the Task V card):

- **BLOCKS FREEZE**: must be fixed, or a decision recorded, before Nov. 2.
- **DEMO FIX**: should land before the freeze so the Nov. 9 demo is right.
- **HANDOFF / QCH IT DEPENDENCY**: waits on QCH or QCH IT, or belongs to
  handoff. Documented, not guessed.
- **POST-CAPSTONE / P1**: real, but can wait.

## Findings

| # | Finding | Class | Next step |
| --- | --- | --- | --- |
| 1 | **Permission administration is not built and has no Trello card.** PRD 3.8 (client-confirmed by Kyle, Oct 14) says designated QCH administrators grant and remove permissions in the app. Without it, nobody in production can be given receiving or Program-management rights except by changing data directly, which PRD 9.12 says is not the normal path. The demo is not affected: it uses synthetic grants | **BLOCKS FREEZE** until the team records a decision | Team decides: build it before Nov. 2, or tell QCH and Pursuit and agree a documented handoff plan (PRD 20.4, 23). Either way, add a card |
| 2 | PR #43 (Task D, describe the need) is not merged. Needs two integration fixes from `integration/task-q` and team decisions R3 and R4 | **DEMO FIX** | Richard pulls in the fixes; team records R3 and R4 in the register; merge and re-run |
| 3 | Task O (demo sign-in, separate referring and receiving people, the "Demo sign-in. Production uses QCH Microsoft sign-in." label) is not merged | **DEMO FIX** | Must merge before Nov. 2 because it is code. Re-check with `docs/demo-environment.md` (PR #55) |
| 4 | Known bug: at XL text size on a 375px-wide screen, the New Referral entry screen scrolls sideways. Logged twice, as issues #46 and #51 | **DEMO FIX** | Small CSS fix to the entry screen; remove the `test.fixme` in `e2e/gpme.spec.js`; close the duplicate issue |
| 5 | Home page link says "Make a Direct Referral", but the page also offers guided matching | **DEMO FIX** | Rename the link, for example "Make a referral" |
| 6 | No way to set a Program's notification email in the app, and no card for it. A Program created in the app gets no recipient, so its new-referral emails fail with `NO_RECIPIENT`. The referral itself is still saved (PRD 11.4) | **HANDOFF / QCH IT DEPENDENCY** | Add a card. Recipients could also come from the initial data load, which depends on the storage decision |
| 7 | Production pieces that wait on QCH IT: production data store (Azure SQL or SharePoint), Entra sign-in, Microsoft Graph sender, hosting, monitoring, repeatable deployment, and one backup and restore test (PRD 23). End-to-end tests run on the in-memory store, not "across Azure SQL" as PRD 17.2 says | **HANDOFF / QCH IT DEPENDENCY** | Already tracked in [pending-qch-it-decisions.md](pending-qch-it-decisions.md) decisions 1, 2, 5 and 6 |
| 8 | Requests QCH confirmed on Oct 26 are not built: language of service, availability and contact in Find a Program, "Important Information About Our Program", and two ways to list multiple locations | **POST-CAPSTONE / P1** (proposed) | The team decides in the Oct 30 PRD revision which, if any, fit before the freeze (PRD 20.3). Register rows R7, R8, R12 to R14 |
| 9 | A report request with a bad period answers "The referral is not valid." Staff do not see it; the Reporting Center shows its own messages | **POST-CAPSTONE / P1** | Give reporting its own error wording |
| 10 | Three handoff docs described work as not done that had already merged: the README "Not built yet" list (Reporting Center screens), [pending-qch-it-decisions.md](pending-qch-it-decisions.md) (Reporting screens, Task C) and [security-regression.md](security-regression.md) (Task E #42, Task C #44) | Fixed in this PR | None |

Only finding 1 is a blocker, and what it blocks is the missing decision,
not necessarily the missing code.

## Checks

| Card check | Result | Evidence |
| --- | --- | --- |
| Current tests pass on the freeze candidate | **Pass** | `main` `36f6e82`: Node 1427/1427; browser 158 passed, 1 skipped (finding 4) |
| Required P0 browser journeys exist | **Pass** (on the in-memory store) | Direct Referral: `e2e/directReferral.spec.js`. GPME-assisted referral to Reporting: `e2e/mvpJourney.spec.js`. Receiving response and outcome across people: `e2e/receivingLifecycle.spec.js`. Program maintenance changes future choices: `e2e/mvpJourney.spec.js`, `e2e/programManagement.spec.js`. P0 reporting known answers: `e2e/reportingKnownAnswers.spec.js`. Not yet across Azure SQL (finding 7) |
| Submission and recovery (PRD 17.5) | **Pass** | One referral for concurrent requests with the same Submission ID (`test/referral.test.js`); lost confirmation (`test/regression/journeys.test.js`, `e2e/gpme.spec.js`, `e2e/receiving.spec.js`); notification failure keeps the referral (`test/notificationWiring.test.js`) |
| Reporting known answers (PRD 17.6) | **Pass** | Counts, rates, breakdowns, average and median times, and Zero vs No data vs Pending vs N/A: `test/timingMetrics.test.js`, `test/referralActivity.test.js`, `e2e/reportingKnownAnswers.spec.js` |
| No known P0 defect left undocumented | **Pass, with a gap** | Only open issues are #46 and #51 (the same bug). Permission administration and notification-email management were known gaps in the docs but had no card (findings 1 and 6) |
| No secrets or real participant data committed | **Pass** | All 221 commits on `main` scanned: no `.env`, no spreadsheet, CSV, PDF or Word file, no QCH email address, no Azure host, no key. Current files: no real QCH names, emails or New York phone numbers in code or seeds |
| No production code falls back to demo sign-in | **Pass** | `src/server.js` passes no identity and `allowDemoGrants: false`. Production answers 401 to every API, including with faked user headers. `test/securityPass.test.js`, `test/regression/securityRegression.test.js` |
| Demo reset fails closed in production | **Pass** | The demo server refuses every environment except `development`; production has no reset path. `docs/demo-environment.md` (PR #55), `test/securityPass.test.js` |
| Notification failures cannot invalidate referrals | **Pass** | Temporary, permanent, missing-recipient and thrown failures all keep the referral: `test/notificationWiring.test.js` |
| Reporting stays aggregate | **Pass** | Report routes are totals, timing, activity and the Department list only; no drill-down route exists. "Reporting is aggregate only" in `test/securityPass.test.js`; "nothing names a person" in `e2e/reportingKnownAnswers.spec.js` |
| GPME stays advisory | **Pass** | Matching stores nothing and returns no scores; a referral is created only when the worker sends it, and a Program GPME did not list is refused with nothing saved. `test/gpme.test.js`, `test/gpmeReferral.test.js` |
| Staff remain the referral decision-makers | **Pass** | Time passing never changes a referral; Not Appropriate is never rerouted. `test/referralResponse.test.js`, `test/regression/journeys.test.js`, `e2e/sentReferrals.spec.js` |
| Unresolved production architecture is documented, not guessed | **Pass** | [pending-qch-it-decisions.md](pending-qch-it-decisions.md) decisions 1 to 8; [requirements-reconciliation-register.md](requirements-reconciliation-register.md) R19 to R25 |
| Handoff and deployment docs match the code | **Pass after fixes** | [architecture.md](architecture.md) lists every route group and screen correctly. Three stale docs fixed here (finding 10) |

## Re-run on the freeze candidate

Once PR #43 and Task O are merged:

1. Record the `main` commit being frozen.
2. `npm test` and `npm run test:e2e`. Every skipped test must have an open
   issue.
3. Re-check the production guards, now including Task O's demo sign-in:
   `test/securityPass.test.js` and `test/demoEnvironment.test.js` (PR #55)
   must pass unchanged.
4. Re-run the secrets and real-data scan over the new commits.
5. Confirm the Task F route inventory includes every new route (PR #43
   adds `POST /api/gpme/interpret`).
6. Update this table: close findings 2 to 5 if fixed, and record the
   decision on finding 1 with its date.
7. Re-read the README "What is built" list and
   [pending-qch-it-decisions.md](pending-qch-it-decisions.md) against what
   merged.
