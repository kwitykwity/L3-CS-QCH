# Freeze candidate audit (Task V)

> **Dated practice audit. Not the current freeze status.** The
> [Findings](#findings) and [Checks](#checks) below record a practice run on
> `main` at `36f6e82` on October 26, 2026, and are kept unchanged as that
> record. Their test counts, "next steps" and references to open pull
> requests describe that day only.
>
> **Current status:** each practice finding is re-checked against `main` at
> `2746c83` (October 31, 2026) in
> [Status of the practice findings on current `main`](#status-of-the-practice-findings-on-current-main).
> **The final Task V audit of the freeze candidate has not been run.** The
> freeze candidate commit, its test results and the freeze decision are
> **PENDING TASK V**; see [Re-run on the freeze candidate](#re-run-on-the-freeze-candidate).
>
> Requirements: the Frozen Handoff PRD and the Handoff MVP (October 28, 2026)
> govern. Section numbers such as "PRD 3.8" or "PRD 17.2" in the practice
> tables refer to the earlier October 14 Final Technical PRD, which is a
> historical reference only.

The freeze decision belongs to Christina. This page gives her the evidence.
It does not approve the freeze for `36f6e82`, `2746c83` or any later
revision.

## Status of the practice findings on current `main`

Checked on `main` at `2746c83` (October 31, 2026). Documentation only: no
requirement is reopened or added, and nothing is marked resolved without the
evidence named in its row. "Resolved" means resolved on `main`; it is not a
Task V freeze result.

| # | Practice finding (October 26) | Status on `2746c83` | Evidence on `main` | Governing text |
| --- | --- | --- | --- | --- |
| 1 | Permission administration not built | **Resolved.** The Permissions screen and API merged in #63 (Task Y), with security regression coverage in #79 (Task CC). The remaining policy choices are QCH's to make, not a freeze blocker | `src/permissions/`; `test/permissionAdministration.test.js`; `test/regression/permissionSecurity.test.js`; `e2e/permissions.spec.js`; question Q1 in [handoff-questions.md](handoff-questions.md) | Handoff PRD §23, §24; MVP §23; gate 28 |
| 2 | PR #43 (describe the need) not merged | **Resolved.** Merged as `f3905cb` | `src/gpme/interpretation/`; `test/gpmeInterpretation.test.js`; `e2e/interpretationReview.spec.js` | Handoff PRD §5.1 to §5.3, §7; MVP §5, §26 |
| 3 | Task O (demo sign-in) not merged | **Resolved.** Merged in #60 (`667266d`). Production still refuses demo sign-in | `scripts/demoSignIn.js`; `test/demoSignIn.test.js`; [demo-environment.md](demo-environment.md) | Handoff PRD §22, §35; MVP §22 |
| 4 | XL text scrolls sideways on the New Referral entry screen at 375px (issues #46, #51) | **Resolved.** Fixed in #69 (`c88858b`); no `test.fixme` remains in `e2e/`; issues #46 and #51 were closed on October 30, 2026 | `e2e/accessibilityFinal.spec.js`; `e2e/gpme.spec.js`; item B1 in [known-limitations.md](known-limitations.md) | Handoff PRD §33; MVP §27 |
| 5 | Home page link said "Make a Direct Referral" | **Resolved.** The start page link reads "New referral" | `public/index.html`; `e2e/accessibilityFinal.spec.js`; `e2e/referralNavigation.spec.js` | Handoff PRD §4 |
| 6 | No way to set a Program's notification email | **Still open, documented.** A Program created in the app has no recipient, so its notification fails as `NO_RECIPIENT`; the referral is still saved. Where the address should live is a QCH/QCH IT question | `test/regression/notificationFailure.test.js`; item B5 in [known-limitations.md](known-limitations.md); question Q8 in [handoff-questions.md](handoff-questions.md) | Handoff PRD §21; MVP §21 |
| 7 | Production pieces wait on QCH IT | **Still outstanding; practice wording superseded.** The practice text's choice of "Azure SQL or SharePoint", and "across Azure SQL", are superseded: the Frozen Handoff PRD confirms SharePoint Lists in a private site with no separate database, and Azure Functions with a managed identity. Provisioning them is a production dependency, not a Capstone failure and not completed Capstone infrastructure | [production-architecture.md](production-architecture.md) sections 1 and 3; items A1 to A8 and C3 in [known-limitations.md](known-limitations.md) | Handoff PRD §27, §29, §37; MVP §28, §31 |
| 8 | Requests QCH confirmed on October 26 not built | **Built, except one default-configuration question.** Language of service: #62. Availability, wait-list and other current Program information in Find a Program: #64 (a separate primary-contact item is question Q4). Separate and shared multi-location listings: #78 (dedicated location screens are question Q2). "Important Information About Our Program": the Frozen Handoff PRD names it as an appropriate flexible-text field, and Program Management already lets a manager add a flexible text field that Find a Program then shows. It is not pre-created, and no code is added for the freeze to pre-create it; whether QCH's default configuration should include it is a handoff question. The practice text's "Oct 30 PRD revision" is superseded by the Frozen Handoff PRD (October 28) | `test/languageOfService.test.js`, `e2e/languageOfService.spec.js`; `test/findProgramInformation.test.js`, `e2e/findProgramInformation.spec.js`; `test/regression/multiLocation.test.js`; `test/programFields.test.js` (flexible text fields) | Handoff PRD §6.3, §8, §9, §13, §14; MVP §8 to §11, §14 |
| 9 | A report request with a bad period answers "The referral is not valid." | **Still open, not a freeze blocker.** Re-checked: a bad `period` or `date` still answers 400 with that wording, because reporting reuses the referral error. Staff do not see it; the Reporting Center shows its own messages | `src/reporting/reportingService.js` (`referralErrors.invalidRequest`); `src/referrals/errors.js` | Handoff PRD §34 (secure error handling) |
| 10 | Three handoff docs described merged work as not done | **Resolved** in the practice run's own pull request | This page's history | None |

One related item from the Task 206 card, not a practice finding:

| Item | Status on `2746c83` | Evidence | Governing text |
| --- | --- | --- | --- |
| A new-referral email whose delivery record cannot be saved is not retried later | **Known production limitation, documented.** No new retry design is added for the November 2 freeze. The referral stays saved and the failure is logged with its referral ID, so it is traceable. Production Graph email cannot be verified end to end yet | Item B4 (and A5, C4) in [known-limitations.md](known-limitations.md); `test/regression/notificationFailure.test.js` | Handoff PRD §20, §21; MVP §21 |

The [Checks](#checks) table below is also a practice-run record: its test
counts (Node 1427/1427; browser 158 passed, 1 skipped) are for `36f6e82`
and are not current. Results for the freeze candidate are **PENDING TASK V**.

How findings are classified (from the Task V card):

- **BLOCKS FREEZE**: must be fixed, or a decision recorded, before Nov. 2.
- **DEMO FIX**: should land before the freeze so the Nov. 9 demo is right.
- **HANDOFF / QCH IT DEPENDENCY**: waits on QCH or QCH IT, or belongs to
  handoff. Documented, not guessed.
- **POST-CAPSTONE / P1**: real, but can wait.

One more label is used for client-confirmed requirements:

- **PENDING SCOPE / RECONCILIATION DECISION**: QCH confirmed it, and it is
  not built. It cannot be treated as deferred until a decision records the
  agreed scope, the approver and the date. This audit can recommend
  deferral; it cannot decide it.

## Findings

| # | Finding | Class | Next step |
| --- | --- | --- | --- |
| 1 | **Permission administration is not built and has no Trello card.** PRD 3.8 (client-confirmed by Kyle, Oct 14) says designated QCH administrators grant and remove permissions in the app. Without it, nobody in production can be given receiving or Program-management rights except by changing data directly, which PRD 9.12 says is not the normal path. The demo is not affected: it uses synthetic grants | **BLOCKS FREEZE** until the team records a decision | Team decides: build it before Nov. 2, or tell QCH and Pursuit and agree a documented handoff plan (PRD 20.4, 23). Either way, add a card |
| 2 | At the audited revision, PR #43 (describe the need) was not merged and required integration fixes | **DEMO FIX** | Historical finding. Governing requirements: Frozen Handoff PRD §§5.1–5.3 and §7 |
| 3 | Task O (demo sign-in, separate referring and receiving people, the "Demo sign-in. Production uses QCH Microsoft sign-in." label) is not merged | **DEMO FIX** | Must merge before Nov. 2 because it is code. Re-check with `docs/demo-environment.md` (PR #55) |
| 4 | Known bug: at XL text size on a 375px-wide screen, the New Referral entry screen scrolls sideways. Logged twice, as issues #46 and #51 | **DEMO FIX** | Small CSS fix to the entry screen; remove the `test.fixme` in `e2e/gpme.spec.js`; close the duplicate issue |
| 5 | Home page link says "Make a Direct Referral", but the page also offers guided matching | **DEMO FIX** | Rename the link, for example "Make a referral" |
| 6 | No way to set a Program's notification email in the app, and no card for it. A Program created in the app gets no recipient, so its new-referral emails fail with `NO_RECIPIENT`. The referral itself is still saved (PRD 11.4) | **HANDOFF / QCH IT DEPENDENCY** | Add a card. Recipients could also come from the initial data load, which depends on the storage decision |
| 7 | Production pieces that wait on QCH IT: production data store (Azure SQL or SharePoint), Entra sign-in, Microsoft Graph sender, hosting, monitoring, repeatable deployment, and one backup and restore test (PRD 23). End-to-end tests run on the in-memory store, not "across Azure SQL" as PRD 17.2 says | **HANDOFF / QCH IT DEPENDENCY** | Already tracked in [pending-qch-it-decisions.md](pending-qch-it-decisions.md) decisions 1, 2, 5 and 6 |
| 8 | Requests QCH confirmed on Oct 26 are not built: language of service, availability and contact in Find a Program, "Important Information About Our Program", and two ways to list multiple locations | **PENDING SCOPE / RECONCILIATION DECISION** | Kyle confirmed these on Oct 26, so they are not deferred until a decision records the agreed scope, approver and date. Recommendation only: decide in the Oct 30 PRD revision which, if any, fit before the freeze (PRD 20.3, 20.4). Governing requirements: Frozen Handoff PRD §§6.3–6.4 and §§9–14. |
| 9 | A report request with a bad period answers "The referral is not valid." Staff do not see it; the Reporting Center shows its own messages | **POST-CAPSTONE / P1** | Give reporting its own error wording |
| 10 | Three handoff docs described work as not done that had already merged: the README "Not built yet" list (Reporting Center screens), [pending-qch-it-decisions.md](pending-qch-it-decisions.md) (Reporting screens, Task C) and [security-regression.md](security-regression.md) (Task E #42, Task C #44) | Fixed in this PR | None |

In this practice run, finding 1 is the only item classed BLOCKS FREEZE,
and what it blocks is the missing decision, not necessarily the missing
code. That does not mean the other open items are settled: finding 8 still
needs a recorded scope decision, findings 2 and 3 must merge before the
freeze, and every finding is re-checked on the freeze candidate.

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
| Production architecture requirements | Historical audit; not production verification | Governing requirements: Frozen Handoff PRD §§27–31; production dependencies: §37 |
| Handoff and deployment docs match the code | **Pass after fixes** | [architecture.md](architecture.md) lists every route group and screen correctly. Three stale docs fixed here (finding 10) |

## Re-run on the freeze candidate

PR #43 and Task O are both merged (`f3905cb`, `667266d`). **These steps
have not yet been run on a freeze candidate; that run is Task V.**

1. Record the `main` commit being frozen.
2. `npm test` and `npm run test:e2e`. Every skipped test must have an open
   issue.
3. Re-check the production guards, now including Task O's demo sign-in:
   `test/securityPass.test.js` and `test/demoEnvironment.test.js` (PR #55)
   must pass unchanged.
4. Re-run the secrets and real-data scan over the new commits.
5. Confirm the Task F route inventory includes every new route (PR #43
   adds `POST /api/gpme/interpret`).
6. Update [Status of the practice findings on current `main`](#status-of-the-practice-findings-on-current-main)
   for the freeze candidate, and record the freeze decision with its date.
7. Re-read the README "What is built" list,
   [known-limitations.md](known-limitations.md),
   [handoff-questions.md](handoff-questions.md) and
   [production-architecture.md](production-architecture.md) against what
   merged. ([pending-qch-it-decisions.md](pending-qch-it-decisions.md)
   predates the Frozen Handoff PRD.)
