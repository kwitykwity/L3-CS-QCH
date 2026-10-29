# Handoff requirements traceability audit (Task GG)

**Status: implementation audit of `main` at `cd22455` against the frozen
handoff requirements (October 28, 2026).** It does not change any requirement,
approve the freeze, or complete handoff.

## What governs this audit

1. **Frozen Handoff PRD** (October 28, 2026): the requirements source of truth.
   Cited here as "PRD n".
2. **Handoff MVP** (October 28, 2026): the completion contract derived from it.
   Cited as "MVP n". If the two conflict, the Handoff PRD governs. MVP 32 lists
   the 36 acceptance gates; MVP 33 defines the classifications used below.
3. **Current Handoff Wireframes** (v1.6, October 28, 2026): the screens derived
   from both. Cited as "wireframe n".

The **October 14 Final Technical PRD** and the
[requirements reconciliation register](requirements-reconciliation-register.md)
are historical references. They do not define current requirements. The earlier
audit that used them is kept, clearly labelled, in
[historical-oct14-implementation-map.md](historical-oct14-implementation-map.md).
A requirement that exists only in those older documents is not carried into the
completion contract here without support in the frozen documents (see
[Historical findings](#historical-findings-and-what-the-frozen-prd-says-about-them)).

## Tested revision and execution evidence

- **Product code audited:** `cd22455` (`main`). This branch changes
  documentation and tests only.
- **`node --test`, run at `3827e50`** (this branch before this revision; the
  product code is identical): 1544 tests, 1544 pass, 0 fail, 0 skipped.
- **`npx playwright test` (Chromium), run at `3827e50`:** 173 tests, 172 passed,
  1 skipped. The skipped test is the XL-text-at-phone-width check, marked
  `test.fixme` for a known defect (fix in open PR #69).
- **Not run for this audit:** Firefox, WebKit and Edge (see
  [browser-verification.md](browser-verification.md) for the earlier record),
  any open pull request's branch, and anything against QCH's Azure, Entra,
  SharePoint or Exchange. There is no QCH environment to run against.
- The tested SHA of the commit that contains this page is reported in the pull
  request, because a commit cannot name its own hash.

## How to read this page

Classifications come from MVP 33, plus the production-dependency class that
MVP 33 and MVP 28 describe.

| Status | Meaning |
| --- | --- |
| `VERIFIED` | The requirement, the integrated implementation on `main`, and executed passing evidence agree. The row names the behavioral test or spec that ran in the runs above, and lists the **limits** that remain. |
| `MERGED-NEEDS-VERIFICATION` | Implemented on `main`, but no executed test shows the requirement as written (the row says what is missing). |
| `OPEN-PR-MATCHES` | Not on `main`. An open pull request implements it and, from reading that branch, matches the requirement. Not executed in this audit. Until it is merged and rerun, the gate is **not met**. |
| `OPEN-PR-MISMATCH` | An open pull request exists but does not match the requirement. The row says how. |
| `TRUE-GAP` | Not implemented on `main` or in any open pull request. The row records **what was checked** before declaring it. |
| `PRODUCTION-DEPENDENCY` | Infrastructure, configuration or policy that QCH or QCH IT must provide (PRD 37, MVP 31). Not a Capstone implementation failure, and not completed Capstone infrastructure. |

Rules:

- **An open pull request is not an approved deferral.** A requirement whose
  implementation is in an open pull request is not complete until it is merged
  and its evidence is run.
- **File existence is not evidence of compliance.** A row is `VERIFIED` only if
  it cites a behavioral test or spec that ran and passed. Documents, and
  structural guard tests (documentation, secret-pattern and traceability
  checks), do not count.
- A `VERIFIED` row that rests only on a browser spec is verified for Chromium
  only, and says so.
- The "Limits" column is not optional. In-memory store, simulated outbox and
  Chromium-only are limits that apply to most rows.
- Any requirement is judged against the frozen documents. Where the frozen text
  is silent, the row does not invent a requirement.

## Summary

| Status | Rows |
| --- | --- |
| `VERIFIED` | 28 |
| `MERGED-NEEDS-VERIFICATION` | 7 |
| `OPEN-PR-MATCHES` | 6 |
| `OPEN-PR-MISMATCH` | 0 |
| `TRUE-GAP` | 5 |
| `PRODUCTION-DEPENDENCY` | 6 |

## MVP acceptance gates (MVP 32)

| ID | Gate | Frozen source | Where built | Executed evidence | Status | Limits and next step |
| --- | --- | --- | --- | --- | --- | --- |
| G-1 | Find a Program end to end. | PRD 3.1, 4.1, 5; MVP 4.1, 5 | `public/referral/guided.js`, `src/gpme/gpmeService.js`, `src/gpme/interpretation/ruleBasedInterpreter.js` | `e2e/gpme.spec.js`, `test/regression/workflowJourneys.test.js`, `test/gpmeReferral.test.js` | `VERIFIED` | Browser spec: Chromium only. In-memory store. Ages run as ranges only, because exact age is gate 6 (not on `main`). Interpretation is rules-only (gate 32). |
| G-2 | Direct Referral end to end. | PRD 4.2, 15; MVP 4.2, 15 | `public/referral/app.js`, `src/referrals/referralService.js` | `e2e/directReferral.spec.js`, `test/referral.test.js`, `test/regression/journeys.test.js` | `VERIFIED` | Browser spec: Chromium only. In-memory store. |
| G-3 | Both paths entering the same referral lifecycle. | PRD 3.4, 4; MVP 4.3 | `src/referrals/referralService.js` | `test/gpmeReferral.test.js`, `test/referral.test.js`, `test/regression/workflowJourneys.test.js` | `VERIFIED` | One pipeline; source kept as DIRECT or GPME_ASSISTED. In-memory store. The demo-environment journey that uses both paths is in open PR #70, not run here. |
| G-4 | Open-ended need description. | PRD 4.1, 5.1; MVP 5 | `src/gpme/interpretation/ruleBasedInterpreter.js`, `public/referral/guided.js` | `test/gpmeInterpretation.test.js`, `e2e/gpme.spec.js` | `VERIFIED` | Rules-based reading only, so how much free text it understands is limited (see [gpme-description-step-prd-8-2.md](gpme-description-step-prd-8-2.md)). Chromium only. |
| G-5 | Human review/correction before GPME. | PRD 3.1, 5.2; MVP 5 | `public/referral/guided.js` | `e2e/gpme.spec.js`, `test/gpmeUi.test.js` | `VERIFIED` | The spec proposes, lets the worker correct, then matches on the confirmed answers only. The audit did not check that accept, remove and add-missing-information each have their own case. Chromium only. |
| G-6 | Exact age input. | PRD 5.3; MVP 6; wireframe 2 | `main` takes a range only: `src/gpme/validateMatchRequest.js` ("a typed range, never a single exact age"), `public/referral/index.html` (From and to boxes) | None on `main`. Open PR #75 adds an Exact age / Age range choice, and its test (test/regression/agePrivacy.test.js on that branch) asserts an exact age is matched as that one age, not widened into an invented range | `OPEN-PR-MATCHES` | Not executed here. Until #75 merges and is rerun, `main` does not meet this gate. Not a deferral. |
| G-7 | Age-range input. | PRD 5.3; MVP 6 | `src/gpme/validateMatchRequest.js`, `public/referral/index.html` | `test/gpme.test.js`, `test/gpmeUi.test.js`, `e2e/gpme.spec.js` | `VERIFIED` | Chromium only for the browser spec. |
| G-8 | No participant age/range persisted after referral creation. | PRD 5.4, 28; MVP 6, 29 | `src/referrals/validateReferral.js` (allowed fields only), `src/gpme/gpmeService.js` | `test/securityPass.test.js` (GPME never echoes, stores or logs the answers), `test/referral.test.js` (unexpected fields refused) | `MERGED-NEEDS-VERIFICATION` | The PRD's acceptance sequence (enter age, match, select Program, submit, age absent from the persisted referral) is not run end to end on `main`. Open PR #75 adds it; open PR #70 adds a narrower check through the referral detail API. Neither is run here. The production SharePoint schema does not exist (P-28). |
| G-9 | Deterministic advisory GPME. | PRD 3.3, 6.1, 6.2, 6.6, 6.7; MVP 7 | `src/gpme/matchPrograms.js` | `test/gpme.test.js`, `test/programMatching.test.js`, `e2e/gpme.spec.js` | `VERIFIED` | Uses need, age and ZIP only; rule version `gpme-v1`. "Does not learn from outcomes" is shown by there being no such code, not by a test. |
| G-10 | Legitimate no-match behavior. | PRD 6.5; MVP 7 | `public/referral/guided.js`, `src/gpme/matchPrograms.js` | `test/gpme.test.js`, `test/gpmeUi.test.js`, `e2e/gpme.spec.js` | `VERIFIED` | Chromium only for the browser spec. |
| G-11 | Human Program selection. | PRD 3.1, 4.1; MVP 4.1 | `public/referral/guided.js`, `src/referrals/referralService.js` | `e2e/gpme.spec.js`, `test/gpmeReferral.test.js` | `VERIFIED` | The server re-runs the match and refuses a Program that was not among the results. In-memory store. |
| G-12 | Language displayed and non-exclusionary. | PRD 6.3; MVP 8 | `src/gpme/gpmeService.js`, `public/referral/guided.js` | `test/languageOfService.test.js`, `e2e/languageOfService.spec.js` | `VERIFIED` | Unknown shows as "not on file", never English. The language list is a sample; QCH's list is a production dependency (G-36). Chromium only for the browser spec. |
| G-13 | Availability/waitlist displayed and non-exclusionary. | PRD 6.4; MVP 9 | Not in Find a Program results on `main`. Open PR #64 shows current Program information, including availability and wait-list information, without removing or reordering results | None on `main` | `OPEN-PR-MATCHES` | #64's test file (test/findProgramInformation.test.js on that branch) includes "a wait-listed or full Program still appears". Not executed here. |
| G-14 | Language not used as an unapproved GPME criterion. | PRD 6.3; MVP 8 | `src/gpme/matchPrograms.js` | `test/languageOfService.test.js` ("a language is not a matching input"; "languages never add, remove, regroup or re-explain a Program") | `VERIFIED` | Server-side matching only; in-memory store. |
| G-15 | Availability not used as an unapproved GPME criterion. | PRD 6.4; MVP 9 | `src/gpme/matchPrograms.js` | None on `main` | `MERGED-NEEDS-VERIFICATION` | By inspection, `matchPrograms.js` reads no availability or wait-list field. No test on `main` asserts it. Open PR #64 has a test that results keep the same Programs in the same order. |
| G-16 | Current employee-facing Program information. | PRD 8, 9; MVP 10 | Program Management shows it to managers (`public/program-management/`). Open PR #64 shows it to staff choosing a Program | `test/programManagement.test.js`, `test/programFieldValues.test.js` (the manager side only) | `OPEN-PR-MATCHES` | `main` shows Program information to managers, not to staff in Find a Program (wireframe 5). Open PR #64 adds it; not executed here. |
| G-17 | Correct Program contact fallback instruction. | PRD 14; MVP 11; wireframe 5 | Not on `main`. Open PR #64 adds: "Send referrals through QCH Connect. Call or email the Program contact only if you cannot find what you need here." | None on `main` | `OPEN-PR-MATCHES` | The wording matches PRD 14. This audit did not confirm a test asserts that exact text. Not executed here. |
| G-18 | Configurable Program information. | PRD 10; MVP 12 | `src/programs/programService.js`, `src/programs/fieldService.js`, `public/program-management/` | `test/programManagement.test.js`, `test/programFields.test.js`, `test/programFieldValues.test.js`, `e2e/programManagement.spec.js`, `e2e/fieldValues.spec.js` | `VERIFIED` | Includes history and audit. The two flexible-text fields PRD 9 names are row P-9. Chromium only for the browser specs. |
| G-19 | Configurable Department/Program structure. | PRD 11, 12; MVP 13 | `src/programs/organizationService.js` | `test/programOrganization.test.js`, `e2e/organization.spec.js` | `VERIFIED` | The Departments in the demo are seed values (PRD 11); QCH's production taxonomy is a dependency (G-36). Wireframe 20 shows no dedicated configuration screen. Chromium only for the spec. |
| G-20 | Multiple-location support. | PRD 13; MVP 14; wireframe 17 | A Program has one site, so separate listings work (`src/programs/programService.js`) | `test/programManagement.test.js` (single-site Programs only) | `TRUE-GAP` | Checked: `src/` and `public/` for a structured shared multi-location listing; none exists. No open pull request adds one. Wireframe 17 shows a Locations list with Add Location (primary and satellite). A shared listing can only be written into a free-text field today. The team decides whether to build it or QCH confirms free text is enough; MVP 14 says the architecture must not force one representation. |
| G-21 | Shared referral lifecycle. | PRD 16; MVP 16 | `src/referrals/stage.js`, `src/referrals/responseService.js`, `src/referrals/outcomeService.js` | `test/referralResponse.test.js`, `test/serviceOutcome.test.js`, `test/regression/journeys.test.js`, `e2e/receivingLifecycle.spec.js` | `VERIFIED` | No literal CLOSED state, which MVP 16 allows. In-memory store. Chromium only for the spec. |
| G-22 | Receiving Program response. | PRD 17; MVP 17 | `src/referrals/responseService.js` | `test/referralResponse.test.js`, `e2e/receiving.spec.js` | `VERIFIED` | Includes no automatic reroute. Chromium only for the spec. |
| G-23 | Separate response and service outcome. | PRD 18; MVP 18 | `src/referrals/outcomeService.js` | `test/serviceOutcome.test.js`, `test/referralActivity.test.js` | `VERIFIED` | Resulted in Service is reported from the recorded outcome. |
| G-24 | Decision/outcome correction with history. | PRD 19; MVP 19; wireframe 13 | `src/referrals/outcomeService.js`, `src/referrals/auditRules.js` | `test/serviceOutcome.test.js`, `test/auditRules.test.js`, `e2e/receivingLifecycle.spec.js` | `VERIFIED` | Audit is proven on the in-memory store. The append-only SQL trigger was never run (see [db/AUDIT_VERIFICATION.md](../db/AUDIT_VERIFICATION.md)), and production uses SharePoint Lists (P-27), so the production audit mechanism is not designed or verified. There is no screen that shows correction history (wireframe 13); the PRD requires the evidence, not that screen. |
| G-25 | Idempotent referral submission. | PRD 20; MVP 20 | `src/referrals/referralService.js` | `test/referral.test.js`, `test/regression/journeys.test.js` | `VERIFIED` | Proven on the in-memory store. The SQL uniqueness constraint was never run, and the production SharePoint mechanism does not exist (P-27). |
| G-26 | Referral survives notification failure. | PRD 21; MVP 21 | `src/notifications/notificationService.js`, `src/referrals/referralService.js` | `test/notificationWiring.test.js`, `test/notifications.test.js` | `VERIFIED` | Simulated outbox only; no Microsoft Graph sender exists (P-21). |
| G-27 | Server-side authorization. | PRD 22, 23, 32; MVP 22 | `src/authorization/referralAccess.js`, `src/app.js` | `test/securityPass.test.js`, `test/regression/securityRegression.test.js` | `VERIFIED` | Demo identity only; Entra sign-in is a dependency (P-22). |
| G-28 | Controlled permission administration. | PRD 23, 24; MVP 23; wireframe 16 | Not on `main`. Open PR #63 adds the Permissions screen and API | None on `main`. #63 carries test/permissionAdministration.test.js on that branch | `OPEN-PR-MATCHES` | #63 enforces the server-side check, target and Program-scope validation, audit evidence and no self-elevation. Its extra restrictions are labelled team restrictions, not QCH policy, as PRD 24 requires. Not executed here. Who the first administrators are is QCH's (G-36). |
| G-29 | Aggregate reporting. | PRD 25; MVP 24; wireframe 14 | `src/reporting/referralActivityService.js`, `src/reporting/periods.js` | `test/referralActivity.test.js`, `test/reportingDepartments.test.js`, `test/regression/reportingJourney.test.js`, `test/timingMetrics.test.js`, `e2e/reportingKnownAnswers.spec.js`, `e2e/reportingDepartments.spec.js` | `VERIFIED` | Covers total, accepted and rate, Resulted in Service, by Program, sent, received, by Department, and month, quarter and year views. One period at a time (the PRD asks for the periods "where supported by the reporting design"). Aggregate only. Chromium only for the specs. |
| G-30 | Privacy/data-minimization protections. | PRD 3.2, 34; MVP 25 | `src/errorHandler.js`, `src/notifications/content.js`, `src/referrals/validateReferral.js` | `test/securityPass.test.js`, `test/regression/securityRegression.test.js`, `test/errorHandler.test.js`, `test/notifications.test.js`, `e2e/directReferral.spec.js` | `VERIFIED` | Covers logs, errors, notification content, aggregate reports and the referral screens. A final leak regression across the other screens is open PR #68, not run here. |
| G-31 | Synthetic-data separation. | PRD 35; MVP 25 | `scripts/syntheticSeed.js` | `test/demoEnvironment.test.js` | `MERGED-NEEDS-VERIFICATION` | The seed is synthetic and tested as the demo's start state. There is no repo-wide test for real participant data, and the Program Directory's exclusion rests on `.gitignore` and a manual scan in [freeze-audit.md](freeze-audit.md). Open PR #70 adds specific safeguards (valid-looking SSN pattern, reserved example domains, Directory by file name) and states their limits; not run here. |
| G-32 | No external AI integration in the delivered MVP. | PRD 7; MVP 26 | `src/gpme/interpretation/ruleBasedInterpreter.js` | `test/gpmeInterpretation.test.js` ("no external AI service or network client is used by the interpretation layer") | `VERIFIED` | A static check of the interpretation layer. The replaceable interface is allowed (PRD 7). External AI is excluded from the MVP, so it is **not** a pending implementation or dependency item; [ai-interpretation-options.md](ai-interpretation-options.md) is research for a possible later decision. |
| G-33 | WCAG 2.2 AA accessibility target. | PRD 33; MVP 27; wireframe 19 | `public/` | `test/regression/accessibility.test.js`, `e2e/screenReader.spec.js` | `OPEN-PR-MATCHES` | The automated and keyboard checks pass (Chromium), and a VoiceOver check is recorded in [screen-reader-check.md](screen-reader-check.md). One requirement is not met on `main`: reflow at XL on a phone-width screen (PRD 33), skipped in the run. The fix and a final accessibility pass are open PR #69, not run here. This is a target, not a conformance claim. |
| G-34 | Stable synthetic demonstration environment. | PRD 35; MVP 32 | `scripts/dev-synthetic-server.js`, `scripts/demoSignIn.js` | `test/demoEnvironment.test.js`, `test/demoSignIn.test.js` | `VERIFIED` | Covers a fresh start, a restart undoing a basic run, and demo sign-in. A fuller journey, language reset and notification checks are open PR #70; the reset steps are open PR #72; a rehearsal is open PR #76. None run here. |
| G-35 | Accurate production architecture handoff. | PRD 27, 28, 29, 30; MVP 28 | [Production architecture](#production-architecture-confirmed-provisioned-and-verified) below | None. This is a documentation gate | `TRUE-GAP` | Checked: the handoff documents (`docs/pending-qch-it-decisions.md`, `docs/qch-it-requirements.md`, `docs/deployment.md`, `docs/architecture.md`) and open pull requests. They still present the data store and server hosting as open, or describe an Azure SQL and App Service design. PRD 27 to 30 confirm SharePoint Lists, Azure Functions and Sites.Selected. A notice was added to the decisions page in this pull request; the bodies still need rewriting. No open pull request does that. |
| G-36 | Production dependencies explicitly documented. | PRD 37; MVP 31 | `docs/handoff-checklist.md`, `docs/pending-qch-it-decisions.md`, `docs/qch-it-requirements.md` | None. This is a documentation gate | `TRUE-GAP` | Checked: those three documents against the 12 items in MVP 31. Present: data store, hosting, Entra, shared mailbox, users and permissions, Department names, retention, browser support. Not found: Exchange RBAC configuration, the Graph `Sites.Selected` permission, the production Program Directory configuration, and the frontend hosting decision as its own item. |

## Frozen PRD sections without a single gate

| ID | Requirement | Frozen source | Where built | Executed evidence | Status | Limits and next step |
| --- | --- | --- | --- | --- | --- | --- |
| P-1 | The frozen documents govern, and differences between them and the implementation are identified and resolved explicitly. | PRD 1; MVP 1, 34 | This page | None | `MERGED-NEEDS-VERIFICATION` | Several other handoff documents still cite Oct 14 section numbers as if current. This pull request corrects the documentation index and the handoff checklist; the rest are not yet updated. |
| P-2 | The MVP stays inside the pre-intake boundary: no intake, enrollment, case management, participant master record, automated eligibility or automated routing. | PRD 2; MVP 2, 3 | No such feature is built | `test/referralResponse.test.js` (no automatic reroute) | `MERGED-NEEDS-VERIFICATION` | Absence of intake, enrollment, case management and eligibility features is by inspection only. |
| P-4 | Direct Referral works when GPME is unavailable. | PRD 4.2; MVP 4.2 | `public/referral/guided.js` | `e2e/gpme.spec.js`, `test/gpmeUi.test.js` | `VERIFIED` | Chromium only for the spec. |
| P-9 | Program information combines structured and flexible fields, including "Program Description" and "Important Information About Our Program". | PRD 9; MVP 10 | `src/programs/fieldService.js` | `test/programFields.test.js`, `e2e/fieldValues.spec.js` | `MERGED-NEEDS-VERIFICATION` | "Program Description" is a standard field. "Important Information About Our Program" is not pre-created; a manager can create a text field with that label, but no test creates it and no seed does. The team decides whether to provide it by default. |
| P-12 | Discontinued Programs do not act as active referral destinations, and history is preserved. | PRD 12; MVP 13 | `src/programs/organizationService.js`, `src/referrals/referralService.js` | `test/programOrganization.test.js`, `test/referral.test.js` (a discontinued receiving Program is refused) | `VERIFIED` | In-memory store. |
| P-15 | Referral submission collects only what the pre-intake referral needs; no SSN or date of birth. | PRD 15; MVP 15 | `src/referrals/validateReferral.js` | `test/referral.test.js`, `test/securityPass.test.js` | `VERIFIED` | Enforced by an allow-list; unexpected fields are refused. |
| P-21 | Production notification email through Microsoft Graph and the QCH shared mailbox named in PRD 21, restricted by Exchange RBAC for Applications. | PRD 21, 30; MVP 21 | `src/notifications/simulatedOutbox.js` (simulated only) | `test/notifications.test.js` (the simulated outbox) | `PRODUCTION-DEPENDENCY` | The mailbox, Graph permission and Exchange RBAC are QCH IT's (MVP 31 items 4 to 6). The Graph sender code is not written; whether to write it for handoff is a scope decision. |
| P-21b | A receiving Program has a notification recipient that can be set in the application. | PRD 16, 21; MVP 16, 21 | Seed data only | None | `TRUE-GAP` | Checked: `src/programs/routes.js` exposes no notification address; no open pull request adds one (see [freeze-audit.md](freeze-audit.md) finding 6). A Program created in the app gets no recipient, so its notification fails with NO_RECIPIENT while the referral still saves. The PRD says a committed referral "may trigger" notification, so the team should confirm whether recipient configuration is MVP. |
| P-22 | Production authentication through Microsoft Entra ID with QCH MFA. | PRD 22; MVP 22 | The `resolveIdentity` seam in `src/app.js`; no Entra code | `test/securityPass.test.js` (production answers 401 without sign-in) | `PRODUCTION-DEPENDENCY` | The Entra application configuration is QCH IT's (MVP 31 item 3). The fail-closed behavior is G-27. |
| P-26 | Application-level audit for sensitive and workflow-changing actions, without becoming a second store of participant information. | PRD 26; MVP 19 | `src/referrals/auditRules.js` | `test/serviceOutcome.test.js`, `test/auditRules.test.js` | `VERIFIED` | In-memory store. The Microsoft 365 audit part is QCH's. |
| P-27 | Production data lives in SharePoint Lists in a dedicated private QCH Connect SharePoint site; no separate production database. | PRD 27; MVP 28 | None. The application uses in-memory stores | None | `PRODUCTION-DEPENDENCY` | Provisioning the site and Lists is QCH IT's (MVP 31 item 2). No SharePoint store has been written; whether to deliver one is a scope decision for the team and QCH IT, not classified as a gap here (MVP 28). `db/migrations/` is the earlier Azure SQL design and is not the production design. |
| P-28 | Production SharePoint Lists never hold participant age, age range, or unnecessary discovery or GPME interpretation inputs. | PRD 28; MVP 29 | None. No Lists exist | None | `PRODUCTION-DEPENDENCY` | Whoever builds the Lists must follow this. The application's own referral model has no age field (G-8). |
| P-29 | Azure Functions are the production server-side authority, using managed identity, with no long-lived secrets in source. | PRD 29; MVP 28 | None. The backend is a Node and Express server (`src/server.js`) | None | `PRODUCTION-DEPENDENCY` | Azure provisioning is QCH IT's (MVP 31 item 1). Porting the backend to Functions is not done and is a scope decision. |
| P-30 | Graph access limited to `Sites.Selected` for the SharePoint site and to the approved shared mailbox through Exchange controls. | PRD 30; MVP 28, 31 | None | None | `PRODUCTION-DEPENDENCY` | QCH IT's configuration (MVP 31 items 4 and 5). |
| P-31 | Archival: at 2,500 active referrals, archive the 500 oldest eligible closed referrals; never archive an open or Awaiting Response referral to reach a batch size; archived records read-only and available to reporting. | PRD 31; MVP 30 | None | None | `TRUE-GAP` | Checked: `src/`, `public/`, `scripts/` and `db/` for any archive logic; none. No open pull request adds it. The PRD calls it QCH IT's planned production process, so the owner must confirm whether the eligibility rule belongs in Capstone code or in the production process; the rule itself can be tested without Azure. |
| P-36 | Critical requirements have evidence across unit, integration, regression, end-to-end, authorization, privacy, accessibility and manual checks for each high-risk workflow. | PRD 36; MVP 33 | `test/`, `e2e/` | The two runs above | `MERGED-NEEDS-VERIFICATION` | Most high-risk workflows have executed tests (see the gates). The remainder is in open pull requests, not run here: age privacy (#75), privacy boundaries on the other screens (#68), final accessibility (#69), permission administration (#63), Program Management to Find a Program (#67), failure recovery (#74) and lifecycle regression (#77). |

## Production architecture: confirmed, provisioned and verified

PRD 27 to 30 confirm the planned production architecture. This table keeps
what is **confirmed** apart from what is **not yet provisioned** and what is
**not yet verified in production**.

| Item | Confirmed by the frozen PRD | Provisioning | Production verification | State in this repository |
| --- | --- | --- | --- | --- |
| Data store | SharePoint Lists in a dedicated private site; no separate production database (PRD 27) | QCH IT, not done | None | In-memory stores only; no SharePoint code |
| Server-side authority | Azure Functions with managed identity (PRD 29) | QCH IT, not done | None | Node and Express server, not Functions |
| SharePoint access | Graph `Sites.Selected`, not tenant-wide `Sites.ReadWrite.All` (PRD 30) | QCH IT, not done | None | None |
| Email | The QCH shared mailbox named in PRD 21, through Graph, limited by Exchange RBAC for Applications (PRD 21, 30) | QCH IT, not done | None | Simulated outbox only |
| Sign-in | Microsoft Entra ID with QCH-controlled MFA (PRD 22) | QCH IT, not done | None | Demo sign-in and a sign-in seam only |
| Privacy of the Lists | No age, age range or unnecessary discovery inputs (PRD 28) | With the Lists | None | The application's referral model has no age field |
| Archival | 2,500 and 500 rule; protect open referrals (PRD 31) | QCH IT's process | None | Not built (P-31) |

## Wireframes (v1.6)

The wireframes are the third source. Where one shows something the PRD and MVP
do not require, it is noted and not classified as a gap.

| # | Screen | Rows | On `main` |
| --- | --- | --- | --- |
| 1 | Employee Dashboard | G-1, G-2 | Entry page present; the "My Recent Referrals" table was not assessed |
| 2 | Find a Program: Describe Need | G-4, G-6, G-7 | Present, with an age range only (exact age: G-6) |
| 3 | Review and Confirm Information | G-5 | Present |
| 4 | Program Matches (GPME results) | G-9, G-11, G-12, G-13 | Present, without availability (G-13) |
| 5 | Program Details | G-16, G-17 | Not on `main` (open PR #64) |
| 6 | Direct Referral | G-2, P-4 | Present |
| 7 | Create Referral | G-2, P-15 | Present |
| 8 | Review and Submit Referral | G-2 | Present |
| 9 | Referral Confirmation | G-25, G-26 | Present |
| 10 | My Referrals | G-21 | Present |
| 11 | Receiving Program: Respond to Referral | G-22 | Present |
| 12 | Service Outcome | G-23 | Present |
| 13 | Correction History | G-24 | Not on `main`; the PRD requires audit evidence, not this screen |
| 14 | Reports (aggregate only) | G-29 | Present |
| 15 | Program Management | G-18 | Present |
| 16 | Permission Administration | G-28 | Not on `main` (open PR #63) |
| 17 | Multi-Location Program | G-20 | Not on `main`; no open pull request |
| 18 | No Match Result | G-10 | Present |
| 19 | Accessibility Controls | G-33 | Present; XL reflow defect (open PR #69) |
| 20 | Department Administration (note) | G-19 | Present as configuration, with no dedicated screen, as the wireframe notes |
| 21 | Help and Guidance | None | Wireframe only. No PRD or MVP requirement, so not classified |

## Historical findings and what the frozen PRD says about them

The earlier audit measured `main` against the October 14 PRD and found eight
`DEFECT` rows. They are preserved in
[historical-oct14-implementation-map.md](historical-oct14-implementation-map.md).
None carries forward as a defect unless the frozen documents support it.

| Earlier finding | What the frozen documents say | Disposition |
| --- | --- | --- |
| Reporting Center takes one period at a time (Oct 14 PRD 12.1) | PRD 25 asks for month, quarter and year "where supported by the reporting design". It does not require several periods or comparisons in one report | Not a current requirement. Not carried forward |
| No print layout and no aggregate export (Oct 14 PRD 12.9) | Not in the frozen PRD or MVP | Not a current requirement |
| Notes do not support bold or italic (Oct 14 PRD 5.4, 14.6) | Not in the frozen PRD or MVP | Not a current requirement |
| Lists show the browser time zone, reports show New York (Oct 14 PRD 9.7) | Not in the frozen PRD or MVP | Not a current requirement |
| No way to set a Program's notification address | PRD 16 and 21 require receiving-Program notification | Carried forward as P-21b, `TRUE-GAP` |
| XL text scrolls sideways at phone width | PRD 33 requires reflow without inappropriate horizontal scrolling | Carried forward in G-33; fix is open PR #69 |
| "Important Information About Our Program" is not a standard field | PRD 9 names it as a flexible-text field | Carried forward as P-9, `MERGED-NEEDS-VERIFICATION` (a manager can create it) |
| A shared multi-location listing is only free text | PRD 13 and MVP 14 require both representations | Carried forward as G-20, `TRUE-GAP` |
| Data store "SharePoint Lists or Azure SQL" pending | PRD 27 confirms SharePoint Lists | Replaced by the production architecture table. G-35 tracks the documents |
| Approved AI service pending (decision 7, R5) | PRD 7 and MVP 26 exclude external AI from the MVP | Removed from pending items (G-32) |
| Permission administration blocks freeze (Task V) | PRD 24 and MVP 23 require it | Carried forward as G-28, `OPEN-PR-MATCHES` |

## Keeping this page current

- A row changes status only when a merged change and an executed test agree.
  Merging a pull request does not by itself move a row to `VERIFIED`: rerun the
  tests and record the revision.
- `test/traceability.test.js` checks that all 36 MVP gates appear exactly as
  written, that every Handoff PRD section 1 to 37 and every Handoff MVP section
  2 to 31 is cited by a row, that every wireframe is listed, that every cited file
  exists, and that a `VERIFIED` row cites a behavioral test and states its
  limits. It does **not** prove a requirement is met.
- Re-check every `OPEN-PR-*` row against the open pull requests (#63, #64, #67,
  #68, #69, #70, #72, #74, #75, #76, #77) before the Nov. 2 freeze.
