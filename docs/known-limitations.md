# Known limitations and outstanding verification

**Status: as of `main` at `a322407` (October 30, 2026).** Trello Task TT.
Documentation only.

This page lists **what is known not to work yet, not to be built here, or
not yet verified**, with the repository evidence for each. Questions that
QCH or QCH IT still has to decide are a separate list:
[handoff-questions.md](handoff-questions.md).

**Nothing on this page is a new requirement.** Each item points to the
Frozen Handoff PRD (October 28, 2026) or Handoff MVP section it relates to.
A production dependency (section A) is QCH/QCH IT work, not a Capstone
failure and not completed Capstone infrastructure (PRD §37; MVP §28, §31).

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
| A6 | **Archival is not built and has never run.** No code archives or deletes a referral. The rules (2,500 active, 500 oldest eligible closed/completed, never open or Awaiting Response, read-only afterwards) are confirmed but unimplemented. Who builds it is question Q9 | PRD §31; MVP §28, §30 | No archive logic in `src/` | Production process outstanding |
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
| B7 | **Find a Program shows a Program's site (in the result heading) and its flexible Program information fields, but not its common Description, Eligibility notes, Schedule notes or Cost notes.** Those four are read but not passed to the results. PRD §9 names "Program Description" as a flexible-text field QCH identified. A primary contact appears only if a manager adds it as a flexible field (question Q4) | PRD §8, §9, §14; MVP §10, §11 | `src/gpme/programInformationForResults.js` (`toResultInformation` maps only the flexible fields); `src/programs/currentProgramInformation.js`; `e2e/findProgramInformation.spec.js` | Known limitation |
| B8 | **Describe-the-need interpretation is rule-based** (keywords), by design: no external AI is in the MVP. It proposes answers for the employee to review | PRD §4.1, §5, §7; MVP §5 | `src/gpme/interpretation/ruleBasedInterpreter.js` | By design; listed so it is not mistaken for a gap |

## C. Verification still outstanding

| # | Outstanding verification | PRD / MVP | Evidence | Status |
| --- | --- | --- | --- | --- |
| C1 | **Manual Safari run of the demo rehearsal (Run 2) is not finished.** Done by hand in Safari 27.0 (Jimmy Ong): steps 1 to 16 passed (steps 1–6 on `eea57fd`, 7–16 on `e7a0b48`; the application code is the same on both), step 17 in part (New Referral passed; finding B2), steps 18 (privacy in the address bar and storage) and 19 (production mode) not yet run. `docs/demo-rehearsal.md` still shows the earlier progress and is updated when the run ends | PRD §33, §36; MVP §27 | `docs/demo-rehearsal.md` (Run 2) | Outstanding |
| C2 | **Other browsers are verified through Playwright engines, not the real browsers QCH staff may use**, apart from the manual Safari and VoiceOver passes. No iOS or other mobile browser has been tested | PRD §33, §36, §37 item 10; MVP §31 item 11 | `docs/browser-verification.md` ("Not tested: …") | Outstanding until QCH IT names the baseline (Q13) |
| C3 | **Every verification ran on in-memory stores with synthetic data.** None of the test evidence shows behavior on SharePoint Lists, Azure Functions, Entra ID or Graph; the security and store-contract checks must be rerun on the production setup | PRD §36; MVP §28, §33 | `docs/security-regression.md` ("Re-run once QCH IT confirms the production architecture") | Outstanding (needs section A first) |
| C4 | **The production Graph email check in the deployment runbook has never been run**: one test referral to a QCH-approved Program arriving in that Program's inbox, generic, with the delivery ending `SENT` | PRD §21, §34; MVP §21 | `docs/deployment.md` step 5 ("Not built yet") | Outstanding (needs A4, A5) |
| C5 | Shared-listing locations are tested through /api/gpme/match, including updated information after a location is removed. Task II does not verify the location-management wireframe screens or provide a dedicated browser journey for shared-location display | PRD §13; MVP §14 | Merged PR #78; `test/regression/multiLocation.test.js`; see question Q2 | API coverage delivered; browser and wireframe verification remain outstanding |

## How to keep this page honest

- Remove an item only when the evidence that closes it is on `main` (merged
  code and a passing test, or a recorded result), or when QCH or QCH IT
  confirms it. An open pull request does not close an item.
- Add an item only with repository evidence (a file, a test, an issue, a
  recorded run). Do not add expectations that the frozen PRD/MVP does not
  contain.
- Point to the frozen PRD/MVP section, not to the historical
  requirements-reconciliation register (R1 to R25).
