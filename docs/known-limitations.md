# Known limitations and outstanding verification

**Status: as of `main` at `24966d5a0d53f7d247428e0dfd9f78f03cc9b288` (November 2, 2026).** Trello Task 231 (refresh of Task TT).
Documentation only.

This page lists **what is known not to work yet, not to be built here, or
not yet verified**, with the repository evidence for each. Questions that
QCH or QCH IT still has to decide are a separate list:
[handoff-questions.md](handoff-questions.md).

**Nothing on this page is a new requirement.** Each item points to the
Frozen Handoff PRD (October 28, 2026) or Handoff MVP section it relates to.
A production dependency (section A) is QCH/QCH IT work, not a Capstone
failure and not completed Capstone infrastructure (PRD §37; MVP §28, §31).

## Release scope decision — November 2, 2026

Christina Ruiz recorded on [Task 231](https://trello.com/c/qtvz1HNQ)
that Page 10 (Review & Submit) and Page 18 (dedicated Multi-Location
Program Management) are deferred for this release. This is a release scope
decision, not a new QCH policy or evidence of final release readiness.
The approved Handoff PRD governs, followed by the Handoff MVP and the
Approved Current Handoff Written Wireframes. The historical R1–R25
register and October 14 Technical PRD are not current authority.
Final candidate verification and Task V remain outstanding.

## A. Production provisioning and production verification (outstanding)

The architecture is confirmed by the frozen PRD; none of it is provisioned,
and nothing has run in QCH's environment. The application runs on in-memory
stores with synthetic data, and the production server fails closed: every
`/api` route answers 401 (`docs/architecture.md`, `docs/demo-environment.md`).

| # | Outstanding | PRD / MVP | Evidence | Status |
| --- | --- | --- | --- | --- |
| A1 | Azure Functions and their managed identity: not provisioned; the repository has one Node.js server, no Functions | PRD §29, §37 item 1; MVP §28, §31 item 1 | `src/server.js`, `src/app.js` | Production dependency |
| A2 | SharePoint site and Lists: not provisioned; no SharePoint store exists in the code. The Azure SQL design in `db/` is an earlier-plan record, not the production store | PRD §27, §28, §37 item 2; MVP §28, §29, §31 item 2 | `src/referrals/memoryReferralStore.js`; `db/README.md` | Production dependency |
| A3 | Microsoft Entra ID single sign-on with MFA: not configured, not connected. Production refuses every request without sign-in | PRD §22, §37 item 3; MVP §22, §31 item 3 | `test/securityPass.test.js`, `test/demoSignIn.test.js` (production rejects demo sign-in) | Production dependency |
| A4 | Microsoft Graph permissions (`Sites.Selected`; mail sending) and Exchange RBAC for the shared mailbox: not granted | PRD §21, §30, §37 items 4 and 5; MVP §28, §31 items 4 to 6 | — | Production dependency |
| A5 | **Production email through Graph has never been sent or verified.** Notifications use a simulated outbox that refuses to run outside development and test; no Graph sender exists. The behavior around sending (after the save, failure keeps the referral, retries traceable) is tested only against that outbox | PRD §21, §30; MVP §21 | `src/notifications/`; `test/notificationWiring.test.js`; `test/regression/notificationFailure.test.js` | Production verification outstanding |
| A6 | **Archival is not built and has never run.** No code archives or deletes a referral. The rules (approximately 2,500 active, 500 oldest eligible closed/completed, never open or Awaiting Response, read-only afterwards) are confirmed but unimplemented. Who builds it is question Q9 | PRD §31; MVP §28, §30 | No archive logic in `src/` | Production process outstanding |
| A7 | Production users, groups, permissions, Program Directory, Department taxonomy, retention policy, browser baseline and frontend hosting are not configured. The decisions are questions Q10 to Q15 | PRD §37 items 6 to 11; MVP §31 items 7 to 12 | Synthetic seed only (`scripts/syntheticSeed.js`) | Production dependency |
| A8 | Production deployment, restore and QCH handoff acceptance have not happened. `docs/deployment.md` is a draft; parts of it describe the earlier App Service / Azure SQL plan | PRD §37; MVP §28 | `docs/deployment.md` | Outstanding |

## B. Known product limitations on `main`

| # | Limitation | PRD / MVP | Evidence | Status |
| --- | --- | --- | --- | --- |
| B1 | The previously reported New Referral XL-text overflow was fixed in merged PR #69 | PRD §33; MVP §27 | `e2e/accessibilityFinal.spec.js`, `e2e/gpme.spec.js`; integrated Chromium suite passed | Resolved |
| B2 | Program Management number inputs inherit the selected text size (merged PR #69). Checkboxes and radio buttons, which had stayed about 13×13px at every size, now follow the text size too, on every screen that has them (merged PR #89) | PRD §33; MVP §27 | `public/referral/referral.css`; `e2e/accessibilityFinal.spec.js`: "every screen, populated: the text size reaches every form control, including ones built from data" (number inputs) and "every screen, populated: checkboxes and radio buttons grow with the text size (Task 201)" (checkboxes and radio buttons, each at least the text size and growing from S to XL); "S/M/L/XL are exact, and XL does not scroll sideways at 375px or 320px" (reflow) | Resolved |
| B3 | New Referral now includes the shared main navigation, including Referrals I sent and Received referrals | PRD §33 | Merged PR #86; `e2e/referralNavigation.spec.js` verifies links, current-page indication, mouse navigation and keyboard navigation | Resolved |
| B4 | **If the notification delivery record itself cannot be saved, nothing retries that email later.** The failure is logged with the referral ID and the referral stands; a resend of the same submission would create the record | PRD §20 (recoverable state wherever practical), §21 (failure and retry traceable); MVP §21 | `test/regression/notificationFailure.test.js` ("the delivery record itself failing to save…") | Known limitation; disclosed on PR #82 |
| B5 | **A Program created in the application has no notification address**, and no screen sets one, so its new-referral notifications fail as `NO_RECIPIENT` (the referral is saved). Where the address should live is question Q8 | PRD §21; MVP §21 | `test/regression/notificationFailure.test.js` (no Program address) | Known limitation |
| B6 | Application permission administration and independent security regression coverage are integrated. Open QCH policy questions remain separate from the delivered functionality; see Q1 | PRD §23, §24; MVP §23 | Merged PRs #63 and #79; `test/permissionAdministration.test.js`, `test/regression/permissionSecurity.test.js`, `e2e/permissions.spec.js` | Implementation delivered; policy questions remain open |
| B7 | **Find a Program displays populated Program Description, Schedule and Eligibility notes before flexible Program information fields; blank fixed values are omitted. Eligibility notes do not substitute for Program age eligibility.** Fixed `costNotes` remains excluded under the approved Task 204 scope; flexible fields, including one labeled "Cost notes", remain unchanged. A primary contact appears only if maintained as a flexible field (question Q4). Program age eligibility coverage remains to be verified separately | PRD §8, §9, §14; MVP §10, §11 | `src/gpme/programInformationForResults.js`; `test/findProgramInformationFixedFields.test.js`; `e2e/findProgramFixedFields.spec.js` | Partial improvement; Program age eligibility verification remains outstanding |
| B8 | **Describe-the-need interpretation is rule-based** (keywords), by design: no external AI is in the MVP. It proposes answers for the employee to review | PRD §4.1, §5, §7; MVP §5 | `src/gpme/interpretation/ruleBasedInterpreter.js` | By design; listed so it is not mistaken for a gap |
| B9 | **Page 10, the approved Review & Submit screen, was not delivered and is deferred for this release (Task 227).** The underlying referral submission lifecycle still exists. Referral Confirmation after a successful send is delivered separately in #107; it is not a pre-submission review screen | Approved Current Handoff Written Wireframes Page 10; existing referral lifecycle | `public/referral/app.js`; `public/referral/submission.js`; `e2e/directReferral.spec.js`; `e2e/referralConfirmation.spec.js`; release scope decision above | Dedicated review screen deferred; existing submission lifecycle retained |
| B10 | The dashboard was not delivered and is deferred for this release. Existing navigation and referral entry paths remain available. | Approved Current Handoff Written Wireframes; recorded release scope decision | public/index.html; public/referral/index.html; Task 231 scope decision | Dashboard deferred; existing entry paths retained |
| B11 | The dedicated correction-history screen was not delivered and is deferred for this release. The application preserves correction history; this does not provide a dedicated staff-facing history view. | Handoff PRD §19; Handoff MVP §19; recorded release scope decision | test/regression/correctionHistory.test.js; docs/prd-traceability.md G-24; Task 231 scope decision | Dedicated screen deferred; history recording retained |

## C. Verification still outstanding

| # | Outstanding verification | PRD / MVP | Evidence | Status |
| --- | --- | --- | --- | --- |
| C1 | **Manual Safari Run 2 remains partial.** Steps 17 overflow/typed-work preservation and step 18 every-page address checks remain incomplete. Step 19 passed within the recorded local production-mode boundary, not all-route authorization or Entra ID. The separate Task 242 retests of #97 Permissions sizing/selected treatment and #98 absence of development-build wording on Home, New Referral and Reporting both passed in production mode, signed out, on main `2cab0f0`: Jimmy Ong, macOS 26.7.1 build 25G241, Safari 27.0 (21625.1.29.18.28). Those specific passes do not complete Run 2 or verify later changes | PRD §33, §36; MVP §27 | Merged PR #94; `docs/demo-rehearsal.md` Run 2; [Task 242 evidence](https://trello.com/c/yGzKRBYQ) | Specific #97/#98 Safari retests passed; remaining Run 2 checks outstanding |
| C2 | **Browser evidence is revision- and environment-specific.** The additional-browser suite includes installed Edge plus Playwright Chromium, Firefox and WebKit. Separate manual Safari/VoiceOver and Edge desktop checks are recorded. These do not establish the final QCH browser baseline or verification of every later change. Mobile-device support is not established; narrow-width desktop reflow checks do not establish it | PRD §33, §36, §37 item 10; MVP §31 item 11 | `docs/browser-verification.md`; `docs/demo-rehearsal.md`; `docs/screen-reader-check.md`; `docs/desktop-browser-check.md` | QCH IT baseline and final-candidate verification outstanding (Q13) |
| C3 | **Every verification ran on in-memory stores with synthetic data.** None of the test evidence shows behavior on SharePoint Lists, Azure Functions, Entra ID or Graph; the security and store-contract checks must be rerun on the production setup | PRD §36; MVP §28, §33 | `docs/security-regression.md` ("Re-run once QCH IT confirms the production architecture") | Outstanding (needs section A first) |
| C4 | **The production Graph email check in the deployment runbook has never been run**: one test referral to a QCH-approved Program arriving in that Program's inbox, generic, with the delivery ending `SENT` | PRD §21, §34; MVP §21 | `docs/deployment.md` step 5 ("Not built yet") | Outstanding (needs A4, A5) |
| C5 | **Page 18, the dedicated Multi-Location Program Management screen, was not delivered and is deferred for this release.** Handoff PRD §13 multi-location capability remains delivered through current Program information: separate listings or a shared listing with configurable Locations information. Regression coverage exists for both models and updated locations through /api/gpme/match. It does not verify the dedicated management screen or a dedicated browser journey for shared-location display | PRD §13; MVP §14 | Merged PR #78; `test/regression/multiLocation.test.js`; release scope decision above; Q2 | Existing capability and API regression delivered; dedicated screen deferred; browser verification remains outstanding |
| C6 | Help & Guidance and Referral Confirmation are implemented. Task 229 found that the Help skip-link destination heading was obscured by the demo banner in Chrome at S text / 100% zoom. PR #110 repaired it; Christina confirmed the heading remained visible after keyboard activation on repair SHA `49677be76172bc24920debeee86c6c899f3d825b` in Chrome 156.0.8078.74. The new demo-mode regression also passes. This closes that specific finding only: the remaining Task 229 keyboard/focus, S/M/L/XL, zoom/reflow, accessible-name and actual screen-reader checks, including Referral Confirmation, are still outstanding | Approved Current Handoff Written Wireframes Pages 22 and 11; PRD §33, §36; MVP §27 | Merged PRs #106, #107 and [#110](https://github.com/kwitykwity/L3-CS-QCH/pull/110); `e2e/helpGuidance.spec.js`; `e2e/referralConfirmation.spec.js`; `e2e/demoBanner.spec.js`; [Task 229](https://trello.com/c/v8ih5huf) | Help skip-link finding repaired and specifically retested; full Task 229 manual verification outstanding |
| C7 | **Task 203 finding F1 is repaired in merged PR #110.** The demo banner now stays in normal document flow instead of covering content. Christina reported Referrals I sent and Reporting Center readable and unobscured in demo mode at XL text and actual 100%, 200% and 400% zoom in Edge 156.0.4314.58 on repair SHA `49677be76172bc24920debeee86c6c899f3d825b`; identity and Switch person checks passed. Both pages measured 219 × 192 CSS pixels with DevTools docked at 400%; these are not measurements of the earlier DevTools-closed checks. All four new demo regressions fail with the old layout and pass with the repair. Switch person is available at the top of the page and scrolls away with the banner | PRD §33; MVP §27 | [Merged PR #110 and repair evidence](https://github.com/kwitykwity/L3-CS-QCH/pull/110); `e2e/demoBanner.spec.js`; original `docs/desktop-browser-check.md` and [issue #102](https://github.com/kwitykwity/L3-CS-QCH/issues/102) remain dated finding evidence | Repaired; recorded manual and automated repair verification passed; final candidate audit remains outstanding |

## Integrated baseline and repair validation

[Task 240](https://trello.com/c/MZxRWGWg) ran a fresh clone of main at
`2cab0f0852a686901c3b5a0322a26612c175275b` on November 2, 2026:
Debian 13 x86_64, Node 24.15.0, Playwright 1.63.0 and installed Chromium
154.0.8037.57 through the supported `CHROMIUM_PATH` option.
`npm ci` and `npm run check-runtime` passed. Node: 1,752 passed across
248 suites, zero failures or skips. Chromium: 233 passed, zero failures
or skips. The specifically requested `mvpJourney.spec.js` (5 tests) and
`programManagement.spec.js` (8 tests) both passed. No reproduction rerun
was needed and no code or tests were changed.

PR #110 repair validation on `49677be76172bc24920debeee86c6c899f3d825b`
used the same Node/Playwright/Chromium environment: 1,752 Node tests and
237 Chromium tests passed, with zero failures or skips, including four
new demo-mode regressions. Manual repair checks are recorded in C6/C7.
These counts belong to their named revisions. They do not constitute a
new Chromium run on the post-merge main SHA or the final Task V candidate.
Production verification and the remaining manual checks remain open.

## How to keep this page honest

- Remove an item only when the evidence that closes it is on `main` (merged
  code and a passing test, or a recorded result), or when QCH or QCH IT
  confirms it. An open pull request does not close an item.
- Add an item only with repository evidence (a file, a test, an issue, a
  recorded run). Do not add expectations that the frozen PRD/MVP does not
  contain.
- Point to the frozen PRD/MVP section, not to the historical
  requirements-reconciliation register (R1 to R25).
