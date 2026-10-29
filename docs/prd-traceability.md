# Handoff requirements traceability audit (Task GG)

**Status: this page holds two things, kept apart.**

1. **A historical audit of `main` at `cd22455`** against the frozen handoff
   requirements (October 28, 2026). Every table headed "as of `cd22455`" is that
   audit. Its statuses describe `cd22455` and the pull requests that were open
   then. They are not edited when later pull requests merge.
2. **[Current integrated status](#current-integrated-status)**, a separate
   section that says which audit rows have changed since, why, and what ran.

The audit does not change any requirement, approve the freeze, or complete
handoff. Findings that were reassessed after review are listed in
[Revisions made to the audit](#revisions-made-to-the-audit). Questions the
frozen documents do not answer are in
[Remaining uncertainties](#remaining-uncertainties-not-requirements-and-not-confirmed-gaps)
and are not classified as requirements or gaps.

## What governs this audit

1. **Frozen Handoff PRD** (October 28, 2026): the requirements source of truth.
   Cited here as "PRD n".
2. **Handoff MVP** (October 28, 2026): the completion contract derived from it.
   Cited as "MVP n". If the two conflict, the Handoff PRD governs. MVP 32 lists
   the 36 acceptance gates; MVP 33 defines the classifications used below.
3. **Current Handoff Wireframes** (v1.6, October 28, 2026): the screens derived
   from both, including the written notes on the board (for example wireframe 20).
   Cited as "wireframe n". The wireframes are the UX specification. They are
   mapped screen by screen in [UX mapping](#ux-mapping-from-the-wireframe-specification-v16),
   and an experience is not dismissed because the PRD does not name the screen.
   They are also not requirements by themselves: where a wireframe shows
   something the PRD and MVP do not require, the mapping says so and records
   the difference as a UX difference or an uncertainty, not as a requirement
   or a gap.

The **October 14 Final Technical PRD** and the
[requirements reconciliation register](requirements-reconciliation-register.md)
are historical references. They do not define current requirements. The earlier
audit that used them is kept, clearly labelled, in
[historical-oct14-implementation-map.md](historical-oct14-implementation-map.md).
A requirement that exists only in those older documents is not carried into the
completion contract here without support in the frozen documents (see
[Historical findings](#historical-findings-and-what-the-frozen-prd-says-about-them)).

## Tested revision and execution evidence

### Historical audit (`cd22455`)

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

### Current integrated status (`main` at `eea57fd`, merged into this branch)

These runs are separate from the audit runs above and support only the
[Current integrated status](#current-integrated-status) section.

- **Product code:** `eea57fd` (`main`) plus one added test, in commit
  `2022443`. The product code is the same as `main`.
- **`node --test`, run at `2022443`:** 1569 tests, 1569 pass, 0 fail, 0 skipped.
  (An earlier full run on the same merge failed one file, `test/referralActivity.test.js`,
  once under full-suite load. It passes alone and on `main`, and the full suite
  passed on the next run. The cause is not identified.)
- **`npx playwright test` (Chromium), four specs only:**
  `e2e/findProgramInformation.spec.js`, `e2e/currentProgramInformation.spec.js`,
  `e2e/programManagementJourneys.spec.js` and `e2e/gpme.spec.js`, run at
  `2022443`: 71 passed, 1 skipped. The skipped test is the XL-text-at-phone-width
  check (open PR #69). The rest of the Playwright suite was not rerun on the
  current tree.
- **Not run:** the other Playwright specs on the current tree, Firefox, WebKit
  and Edge, any open pull request's branch, and anything against QCH's
  environments.

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

### Evidence rules for `VERIFIED`

One rule applies to every row, with no exceptions for particular gates.

- **Behavioral evidence** is a test or spec that runs the product (a service
  call, an HTTP request, or a browser) and asserts what happened. Only
  behavioral evidence can make a row `VERIFIED`.
- **Static evidence** reads source, dependency lists, documents or the shape of
  the repository (for example a scan for a forbidden import). It is useful
  support, but it **never** makes a row `VERIFIED` on its own, including for a
  requirement that is an absence ("no external AI"). A requirement that can only
  be shown by absence still needs a behavioral check that the absence holds at
  run time, or the row stays `MERGED-NEEDS-VERIFICATION`.
- Structural guard tests (documentation, secret-pattern, environment-file and
  traceability checks) are static evidence. They are listed by name in
  `test/traceability.test.js`.
- **The evidence has to cover the gate as MVP 32 words it.** If part of the
  gate's own wording is not exercised by any test, the row is
  `MERGED-NEEDS-VERIFICATION`, and it says which part. Elements of the PRD that
  the gate does not name and that are shown only by inspection are listed under
  "Limits", not counted as verified.
- A `VERIFIED` row that rests only on a browser spec is verified for Chromium
  only, and says so.
- The "Limits" column is not optional. In-memory store, simulated outbox and
  Chromium-only are limits that apply to most rows.

### Other rules

- **An open pull request is not an approved deferral.** A requirement whose
  implementation is in an open pull request is not complete until it is merged
  and its evidence is run.
- **File existence is not evidence of compliance.** Documents and the presence
  of code do not count.
- **A label is not evidence.** A restriction, decision or limitation that is
  described in a comment or document as "pending", "team" or "not policy" has
  not thereby been shown to meet a requirement. The row judges what the code
  does.
- Any requirement is judged against the frozen documents. Where the frozen text
  is silent, the row does not invent a requirement. An open question is
  recorded under
  [Remaining uncertainties](#remaining-uncertainties-not-requirements-and-not-confirmed-gaps),
  not converted into a requirement or a `TRUE-GAP`.
- A `TRUE-GAP` needs the frozen wording, the implementation and the pull
  requests all checked (MVP 33), and the row says what was checked.

## Summary (as of `cd22455`)

These counts are the historical audit, after the corrections listed in
[Revisions made to the audit](#revisions-made-to-the-audit). The counts for the
current integrated state are in
[Current integrated status](#current-integrated-status).

| Status | Rows |
| --- | --- |
| `VERIFIED` | 26 |
| `MERGED-NEEDS-VERIFICATION` | 10 |
| `OPEN-PR-MATCHES` | 5 |
| `OPEN-PR-MISMATCH` | 1 |
| `TRUE-GAP` | 2 |
| `PRODUCTION-DEPENDENCY` | 7 |

## MVP acceptance gates as of `cd22455` (MVP 32)

Statuses here describe `cd22455`. "Open PR" means open at that time; see
[Current integrated status](#current-integrated-status) for what has merged since.

| ID | Gate | Frozen source | Where built | Executed evidence | Status | Limits and next step |
| --- | --- | --- | --- | --- | --- | --- |
| G-1 | Find a Program end to end. | PRD 3.1, 4.1, 5; MVP 4.1, 5 | `public/referral/guided.js`, `src/gpme/gpmeService.js`, `src/gpme/interpretation/ruleBasedInterpreter.js` | `e2e/gpme.spec.js`, `test/regression/workflowJourneys.test.js`, `test/gpmeReferral.test.js` | `VERIFIED` | Browser spec: Chromium only. In-memory store. Ages run as ranges only, because exact age is gate 6 (not on `main`). Interpretation is rules-only (gate 32). |
| G-2 | Direct Referral end to end. | PRD 4.2, 15; MVP 4.2, 15 | `public/referral/app.js`, `src/referrals/referralService.js` | `e2e/directReferral.spec.js`, `test/referral.test.js`, `test/regression/journeys.test.js` | `VERIFIED` | Browser spec: Chromium only. In-memory store. |
| G-3 | Both paths entering the same referral lifecycle. | PRD 3.4, 4; MVP 4.3 | `src/referrals/referralService.js` | `test/gpmeReferral.test.js`, `test/referral.test.js`, `test/regression/workflowJourneys.test.js` | `VERIFIED` | One pipeline; source kept as DIRECT or GPME_ASSISTED. In-memory store. The demo-environment journey that uses both paths is in open PR #70, not run here. |
| G-4 | Open-ended need description. | PRD 4.1, 5.1; MVP 5 | `src/gpme/interpretation/ruleBasedInterpreter.js`, `public/referral/guided.js` | `test/gpmeInterpretation.test.js`, `e2e/gpme.spec.js` | `VERIFIED` | Rules-based reading only, so how much free text it understands is limited (see [gpme-description-step-prd-8-2.md](gpme-description-step-prd-8-2.md)). Chromium only. |
| G-5 | Human review/correction before GPME. | PRD 3.1, 5.2; MVP 5 | `public/referral/guided.js` | `e2e/gpme.spec.js`, `test/gpmeUi.test.js` | `MERGED-NEEDS-VERIFICATION` | What ran: the spec proposes answers, the worker corrects the age, and matching uses the confirmed answers only (nothing is matched before the worker chooses Find Programs). What did not: MVP 5 also lists removing incorrect information and providing missing information, and no test removes a proposed need or adds one the reader missed. Per the evidence rules, a gate whose own wording is only partly exercised is not `VERIFIED`. Next step: a spec case for remove and for add-missing. Chromium only. |
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
| G-20 | Multiple-location support. | PRD 13; MVP 14; wireframe 17 | Separate listings: a Program has a site, and the same name may repeat at a different site (`src/programs/organizationService.js`, `src/programs/validateProgramChange.js`). One shared listing: a flexible text field such as "Additional locations" on one Program (`scripts/syntheticProgramInformation.js`, `src/programs/fieldService.js`) | `test/programOrganization.test.js` and `e2e/programManagementJourneys.spec.js` (the same name at the same site is refused; at another site it is allowed), `e2e/currentProgramInformation.spec.js` (a manager sees and edits an "Additional locations" field on a Program) | `MERGED-NEEDS-VERIFICATION` | Frozen wording (PRD 13, MVP 14): QCH must be able to represent separate listings **or** one shared listing containing multiple locations, and the architecture must not force one. Both representations exist: separate listings are structured and tested; a shared listing is a flexible text field a manager can fill in. Neither is forced. What is missing is evidence for the shared side: no test creates the shared listing as a user would and shows it to staff choosing a Program (staff display of Program information is open PR #64 at this date). Whether free text is enough, or QCH wants the structured Locations list that wireframe 17 draws, is not answered by the frozen documents: see U-3. Not a `TRUE-GAP`: the earlier version of this row declared one without weighing the existing field, the tests above or the frozen wording. |
| G-21 | Shared referral lifecycle. | PRD 16; MVP 16 | `src/referrals/stage.js`, `src/referrals/responseService.js`, `src/referrals/outcomeService.js` | `test/referralResponse.test.js`, `test/serviceOutcome.test.js`, `test/regression/journeys.test.js`, `e2e/receivingLifecycle.spec.js` | `VERIFIED` | No literal CLOSED state, which MVP 16 allows. In-memory store. Chromium only for the spec. |
| G-22 | Receiving Program response. | PRD 17; MVP 17 | `src/referrals/responseService.js` | `test/referralResponse.test.js`, `e2e/receiving.spec.js` | `VERIFIED` | Includes no automatic reroute. Chromium only for the spec. |
| G-23 | Separate response and service outcome. | PRD 18; MVP 18 | `src/referrals/outcomeService.js` | `test/serviceOutcome.test.js`, `test/referralActivity.test.js` | `VERIFIED` | Resulted in Service is reported from the recorded outcome. |
| G-24 | Decision/outcome correction with history. | PRD 19; MVP 19; wireframe 13 | `src/referrals/outcomeService.js`, `src/referrals/auditRules.js` | `test/serviceOutcome.test.js`, `test/auditRules.test.js`, `e2e/receivingLifecycle.spec.js` | `VERIFIED` | Audit is proven on the in-memory store. The append-only SQL trigger was never run (see [db/AUDIT_VERIFICATION.md](../db/AUDIT_VERIFICATION.md)), and production uses SharePoint Lists (P-27), so the production audit mechanism is not designed or verified. There is no screen that shows correction history (wireframe 13); the PRD requires the evidence, not that screen. |
| G-25 | Idempotent referral submission. | PRD 20; MVP 20 | `src/referrals/referralService.js` | `test/referral.test.js`, `test/regression/journeys.test.js` | `VERIFIED` | Proven on the in-memory store. The SQL uniqueness constraint was never run, and the production SharePoint mechanism does not exist (P-27). |
| G-26 | Referral survives notification failure. | PRD 21; MVP 21 | `src/notifications/notificationService.js`, `src/referrals/referralService.js` | `test/notificationWiring.test.js`, `test/notifications.test.js` | `VERIFIED` | Simulated outbox only; no Microsoft Graph sender exists (P-21). The failure is traceable and the referral stays saved. How a receiving Program's notification address is set is not stated in the frozen documents (U-1). |
| G-27 | Server-side authorization. | PRD 22, 23, 32; MVP 22 | `src/authorization/referralAccess.js`, `src/app.js` | `test/securityPass.test.js`, `test/regression/securityRegression.test.js` | `VERIFIED` | Demo identity only; Entra sign-in is a dependency (P-22). |
| G-28 | Controlled permission administration. | PRD 23, 24; MVP 23; wireframe 16 | Not on `main`. Open PR #63 adds the Permissions screen and API | None on `main`. #63 carries test/permissionAdministration.test.js on that branch | `OPEN-PR-MISMATCH` | Read from the #63 branch, not executed here. **Matches PRD 23 and 24:** the administrator check runs on the server inside the transaction; the target user and the Program scope are validated; a grant needs a Program that exists and is not retired; a self-grant is refused; every change writes audit evidence, and if the audit write fails nothing changes. **Does not match as written:** #63 also enforces four restrictions that go beyond the frozen requirements: (1) all self-changes are refused, removals included, where PRD 24 asks only that self-elevation be prevented; (2) the Administer permissions permission cannot be granted or revoked on the screen; (3) only grants made in the application can be removed; (4) new grants go only to active users. PRD 24 says restrictions beyond the requirements "must not be treated as QCH policy unless QCH approves them". The code comments call these team restrictions pending QCH confirmation. **That label is not compliance.** The restrictions are enforced regardless of the label, and no QCH approval is recorded, so the row cannot be called a match. It resolves if QCH approves the four restrictions or they are loosened or removed; it is not a finding that they are wrong. Whether restriction (2) leaves QCH able to add an administrator without IT help is U-4. Who the first administrators are is QCH's (G-36). |
| G-29 | Aggregate reporting. | PRD 25; MVP 24; wireframe 14 | `src/reporting/referralActivityService.js`, `src/reporting/periods.js` | `test/referralActivity.test.js`, `test/reportingDepartments.test.js`, `test/regression/reportingJourney.test.js`, `test/timingMetrics.test.js`, `e2e/reportingKnownAnswers.spec.js`, `e2e/reportingDepartments.spec.js` | `VERIFIED` | Covers total, accepted and rate, Resulted in Service, by Program, sent, received, by Department, and month, quarter and year views. One period at a time (the PRD asks for the periods "where supported by the reporting design"). Aggregate only. Chromium only for the specs. |
| G-30 | Privacy/data-minimization protections. | PRD 3.2, 34; MVP 25 | `src/errorHandler.js`, `src/notifications/content.js`, `src/referrals/validateReferral.js` | `test/securityPass.test.js`, `test/regression/securityRegression.test.js`, `test/errorHandler.test.js`, `test/notifications.test.js`, `e2e/directReferral.spec.js` | `VERIFIED` | Covers logs, errors, notification content, aggregate reports and the referral screens. A final leak regression across the other screens is open PR #68, not run here. |
| G-31 | Synthetic-data separation. | PRD 35; MVP 25 | `scripts/syntheticSeed.js` | `test/demoEnvironment.test.js` | `MERGED-NEEDS-VERIFICATION` | The seed is synthetic and tested as the demo's start state. There is no repo-wide test for real participant data, and the Program Directory's exclusion rests on `.gitignore` and a manual scan in [freeze-audit.md](freeze-audit.md). Open PR #70 adds specific safeguards (valid-looking SSN pattern, reserved example domains, Directory by file name) and states their limits; not run here. |
| G-32 | No external AI integration in the delivered MVP. | PRD 7; MVP 26 | `src/gpme/interpretation/ruleBasedInterpreter.js` | `test/gpmeInterpretation.test.js` ("no external AI service or network client is used by the interpretation layer", a source scan) | `MERGED-NEEDS-VERIFICATION` | At `cd22455` the only evidence was that source scan, which is static, and under the evidence rules a static check does not make a row `VERIFIED`, even for an absence. A behavioral check was added later on this branch (see [Current integrated status](#current-integrated-status)). The replaceable interface is allowed (PRD 7). External AI is excluded from the MVP, so it is **not** a pending implementation or dependency item; [ai-interpretation-options.md](ai-interpretation-options.md) is research for a possible later decision. |
| G-33 | WCAG 2.2 AA accessibility target. | PRD 33; MVP 27; wireframe 19 | `public/` | `test/regression/accessibility.test.js`, `e2e/screenReader.spec.js` | `OPEN-PR-MATCHES` | The automated and keyboard checks pass (Chromium), and a VoiceOver check is recorded in [screen-reader-check.md](screen-reader-check.md). One requirement is not met on `main`: reflow at XL on a phone-width screen (PRD 33), skipped in the run. The fix and a final accessibility pass are open PR #69, not run here. This is a target, not a conformance claim. |
| G-34 | Stable synthetic demonstration environment. | PRD 35; MVP 32 | `scripts/dev-synthetic-server.js`, `scripts/demoSignIn.js` | `test/demoEnvironment.test.js`, `test/demoSignIn.test.js` | `VERIFIED` | Covers a fresh start, a restart undoing a basic run, and demo sign-in. A fuller journey, language reset and notification checks are open PR #70; the reset steps are open PR #72; a rehearsal is open PR #76. None run here. |
| G-35 | Accurate production architecture handoff. | PRD 27, 28, 29, 30; MVP 28 | [Production architecture](#production-architecture-confirmed-provisioned-and-verified) below | None. This is a documentation gate | `TRUE-GAP` | Checked: the handoff documents (`docs/pending-qch-it-decisions.md`, `docs/qch-it-requirements.md`, `docs/deployment.md`, `docs/architecture.md`) and open pull requests. They still present the data store and server hosting as open, or describe an Azure SQL and App Service design. PRD 27 to 30 confirm SharePoint Lists, Azure Functions and Sites.Selected. A notice was added to the decisions page in this pull request; the bodies still need rewriting. No open pull request does that. |
| G-36 | Production dependencies explicitly documented. | PRD 37; MVP 31 | `docs/handoff-checklist.md`, `docs/pending-qch-it-decisions.md`, `docs/qch-it-requirements.md` | None. This is a documentation gate | `TRUE-GAP` | Checked: those three documents against the 12 items in MVP 31. Present: data store, hosting, Entra, shared mailbox, users and permissions, Department names, retention, browser support. Not found: Exchange RBAC configuration, the Graph `Sites.Selected` permission, the production Program Directory configuration, and the frontend hosting decision as its own item. |

## Frozen PRD sections without a single gate, as of `cd22455`

| ID | Requirement | Frozen source | Where built | Executed evidence | Status | Limits and next step |
| --- | --- | --- | --- | --- | --- | --- |
| P-1 | The frozen documents govern, and differences between them and the implementation are identified and resolved explicitly. | PRD 1; MVP 1, 34 | This page | None | `MERGED-NEEDS-VERIFICATION` | Several other handoff documents still cite Oct 14 section numbers as if current. This pull request corrects the documentation index and the handoff checklist; the rest are not yet updated. |
| P-2 | The MVP stays inside the pre-intake boundary: no intake, enrollment, case management, participant master record, automated eligibility or automated routing. | PRD 2; MVP 2, 3 | No such feature is built | `test/referralResponse.test.js` (no automatic reroute) | `MERGED-NEEDS-VERIFICATION` | Absence of intake, enrollment, case management and eligibility features is by inspection only. |
| P-4 | Direct Referral works when GPME is unavailable. | PRD 4.2; MVP 4.2 | `public/referral/guided.js` | `e2e/gpme.spec.js`, `test/gpmeUi.test.js` | `VERIFIED` | Chromium only for the spec. |
| P-9 | Program information combines structured and flexible fields, including "Program Description" and "Important Information About Our Program". | PRD 9; MVP 10 | `src/programs/fieldService.js` | `test/programFields.test.js`, `e2e/fieldValues.spec.js` | `MERGED-NEEDS-VERIFICATION` | "Program Description" is a standard field. "Important Information About Our Program" is not pre-created; a manager can create a text field with that label, but no test creates it and no seed does. The team decides whether to provide it by default. |
| P-12 | Discontinued Programs do not act as active referral destinations, and history is preserved. | PRD 12; MVP 13 | `src/programs/organizationService.js`, `src/referrals/referralService.js` | `test/programOrganization.test.js`, `test/referral.test.js` (a discontinued receiving Program is refused) | `VERIFIED` | In-memory store. |
| P-15 | Referral submission collects only what the pre-intake referral needs; no SSN or date of birth. | PRD 15; MVP 15 | `src/referrals/validateReferral.js` | `test/referral.test.js`, `test/securityPass.test.js` | `VERIFIED` | Enforced by an allow-list; unexpected fields are refused. |
| P-21 | Production notification email through Microsoft Graph and the QCH shared mailbox named in PRD 21, restricted by Exchange RBAC for Applications. | PRD 21, 30; MVP 21 | `src/notifications/simulatedOutbox.js` (simulated only) | `test/notifications.test.js` (the simulated outbox) | `PRODUCTION-DEPENDENCY` | The mailbox, Graph permission and Exchange RBAC are QCH IT's (MVP 31 items 4 to 6). The Graph sender code is not written; whether to write it for handoff is a scope decision. |
| P-22 | Production authentication through Microsoft Entra ID with QCH MFA. | PRD 22; MVP 22 | The `resolveIdentity` seam in `src/app.js`; no Entra code | `test/securityPass.test.js` (production answers 401 without sign-in) | `PRODUCTION-DEPENDENCY` | The Entra application configuration is QCH IT's (MVP 31 item 3). The fail-closed behavior is G-27. |
| P-26 | Application-level audit for sensitive and workflow-changing actions, without becoming a second store of participant information. | PRD 26; MVP 19 | `src/referrals/auditRules.js` | `test/serviceOutcome.test.js`, `test/auditRules.test.js` | `VERIFIED` | In-memory store. The Microsoft 365 audit part is QCH's. |
| P-27 | Production data lives in SharePoint Lists in a dedicated private QCH Connect SharePoint site; no separate production database. | PRD 27; MVP 28 | None. The application uses in-memory stores | None | `PRODUCTION-DEPENDENCY` | Provisioning the site and Lists is QCH IT's (MVP 31 item 2). No SharePoint store has been written; whether to deliver one is a scope decision for the team and QCH IT, not classified as a gap here (MVP 28). `db/migrations/` is the earlier Azure SQL design and is not the production design. |
| P-28 | Production SharePoint Lists never hold participant age, age range, or unnecessary discovery or GPME interpretation inputs. | PRD 28; MVP 29 | None. No Lists exist | None | `PRODUCTION-DEPENDENCY` | Whoever builds the Lists must follow this. The application's own referral model has no age field (G-8). |
| P-29 | Azure Functions are the production server-side authority, using managed identity, with no long-lived secrets in source. | PRD 29; MVP 28 | None. The backend is a Node and Express server (`src/server.js`) | None | `PRODUCTION-DEPENDENCY` | Azure provisioning is QCH IT's (MVP 31 item 1). Porting the backend to Functions is not done and is a scope decision. |
| P-30 | Graph access limited to `Sites.Selected` for the SharePoint site and to the approved shared mailbox through Exchange controls. | PRD 30; MVP 28, 31 | None | None | `PRODUCTION-DEPENDENCY` | QCH IT's configuration (MVP 31 items 4 and 5). |
| P-31 | Archival: at 2,500 active referrals, archive the 500 oldest eligible closed referrals; never archive an open or Awaiting Response referral to reach a batch size; archived records read-only and available to reporting. | PRD 27, 31; MVP 28, 30 | None. No archive logic exists, and nothing in the application deletes or archives a referral | None | `PRODUCTION-DEPENDENCY` | Frozen wording: PRD 31 calls it an "operational archival approach" that QCH IT established, and "the planned process" that runs when the active list reaches 2,500; MVP 30 calls it "the planned production process"; MVP 28 lists "archival process" among production requirements. It operates on SharePoint Lists (P-27), which do not exist in this repository, and none of the 36 acceptance gates in MVP 32 names it. MVP 33 classes work that QCH or QCH IT provisions separately as a production dependency, not a `TRUE-GAP`. Checked before settling this: `src/`, `public/`, `scripts/`, `db/`, `test/` and `e2e/` for archive logic (none) and every open pull request's diff for added archive code (none). The "never archive an open or Awaiting Response referral" rule is a constraint on whoever builds the process; this code archives nothing, so it cannot break it. Who builds the process, QCH IT or this team, is not stated: see U-2. |
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

## UX mapping from the wireframe specification (v1.6)

The wireframes are the UX specification, derived from the PRD and the MVP. Each
screen is mapped here, including its written notes, and no experience is
dismissed because the PRD does not name the screen. The UX status describes
what a person using the screen would find. It is **not** a requirement
classification: a difference from a wireframe is not a gap unless a frozen
requirement also says so. Where the frozen documents are silent, the row points
to an uncertainty (U-n) instead of deciding.

UX status words: `MATCHES` (the experience is there), `PARTIAL` (part of it is
there), `DIFFERENT` (the need is met, or may be met, a different way),
`NOT BUILT`, `OPEN PR` (in an open pull request, not run here). "Not found"
means a search of `public/` and the tests did not find it; it is not a
browser check. The "now" column is `main` after the pull requests merged since
the audit (see [Current integrated status](#current-integrated-status)).

| # | Screen | Experiences the wireframe shows | Backing in the frozen documents | On `main` at `cd22455` | On `main` now | UX status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Employee Dashboard | Welcome; two entry cards (Find a Program, Direct Referral); "My Recent Referrals" with View All; side navigation; text size and user menu | PRD 4 (two entry paths); the dashboard itself is wireframe only | The home page `public/index.html` is a list of links (New referral, Program Management, Referrals I sent, Received referrals, Reporting Center). The two paths are chosen on the New Referral page (`public/referral/index.html`). No recent-referrals table found | No change | `DIFFERENT`: both paths are reachable; the cards and the recent-referrals table are not built (U-6) |
| 2 | Find a Program: Describe Need | Open-ended description with a 0 to 500 counter; participant age as exact or range, optional, with a "matching only" note; Cancel and Continue; step indicator | PRD 4.1, 5.1, 5.3, 5.4; MVP 5, 6 | A description box marked optional, and an age range From and to with a hint that a range is fine. Exact age is not accepted (`src/gpme/validateMatchRequest.js`). The page says the answers are "not saved with the referral". Counter and step indicator not assessed | Exact age is open PR #75 | `PARTIAL`: exact age is G-6 |
| 3 | Review and Confirm Information | Interpreted information the worker can edit (primary need, details, age, geography, other considerations); a "matching only, not saved" note; Back and Continue | PRD 3.1, 5.2; MVP 5 | The reading proposes needs, age and ZIP into editable fields, and nothing is matched until the worker chooses Find Programs. There are no fields for "details" or "other considerations"; matching uses only need, age and ZIP (PRD 6.2). Remove and add-missing are not tested (G-5) | No change | `PARTIAL` |
| 4 | Program Matches (GPME results) | A "suggestions" note; per result: Department, ages, language, availability; "Why this program?"; Select Program; a no-match box with Direct Referral | PRD 3.3, 6.1, 6.3 to 6.5; MVP 7 to 9 | Plausible and possible lists, each with explanations and a choose button; language shown, or "not on file"; no availability in results; the no-match message offers Change answers and Direct Referral | Availability, wait list and primary contact are shown with each result (#64 merged) | `PARTIAL`: each result carries explanations, not a separate "Why this program?" link (not assessed in a browser) |
| 5 | Program Details | A page with tabs (Overview, Services, Locations, Enrollment, Contact, Important Info); Department, ages, languages, availability, schedule, locations; Select This Program; a callout to refer through QCH Connect and to call or email only if needed | PRD 8, 14; MVP 10, 11 | Not shown to staff on `main`; managers see Program information in Program Management | Shown inline under each result as "Current Program information", with the PRD 14 wording asserted by `test/findProgramInformation.test.js`. No separate tabbed page | `DIFFERENT`: the information and the guidance are there; the tabbed page is not (U-5) |
| 6 | Direct Referral | A search box; filter by Department; optional filter by Location; a Program list with Select | PRD 4.2, 15; MVP 4.2 | Search by name, which also matches site and Department text (`public/referral/app.js`). No separate Department or Location filter. It works when matching is down (`e2e/gpme.spec.js`) | No change | `PARTIAL` |
| 7 | Create Referral | Internal-use participant information: first and last name, preferred contact method, phone, email (optional), ZIP (optional), referral context (required, 0 to 500) | PRD 15; MVP 15 (only necessary information; no SSN or date of birth) | Fields: participant name, best way to reach them, what they need, ZIP (optional), notes (optional). No SSN or date of birth. The set differs from the wireframe (one name field; no separate phone and email boxes) | No change | `DIFFERENT`: PRD 15 asks for necessary information only and does not list fields; whether the wireframe's fields are expected is U-6 |
| 8 | Review and Submit Referral | The selected Program and the participant information shown for confirmation with Edit links, then Submit | PRD 15, 20; MVP 15, 20 | One referral-details step with Change Program and Send referral. No separate review step found. Duplicate protection and lost-confirmation handling are tested (G-25) | No change | `DIFFERENT` (U-6) |
| 9 | Referral Confirmation | A confirmation with referral number, Program and date; a note that a failed notification leaves the referral valid and can be retried; View Referral; Create Another Referral | PRD 20, 21; MVP 20, 21 | "Referral received !" with a Referral ID (`public/referral/submission.js`). The notification note, View Referral and Create Another Referral were not found | No change | `PARTIAL` |
| 10 | My Referrals | Status tabs (All, Awaiting Response, Accepted, Not Appropriate, Resulted in Service); a table of date, number, Program, status, View | PRD 16, 17, 18; MVP 16 | "Referrals I sent" (`public/sent/`) with a stage filter: All, Awaiting response, Accepted but outcome not recorded, Complete. The detail page shows Response, Decision and Service outcome. No Not appropriate filter. Columns not assessed | No change | `PARTIAL` |
| 11 | Receiving Program: Respond to Referral | Referral details; Accepted or Not Appropriate; a reason required for Not Appropriate; Save Response | PRD 17; MVP 17 | Received referrals list and detail with Decision, Reason and an optional Explanation (`public/receiving/`), exercised by `e2e/receiving.spec.js` | No change | `MATCHES` |
| 12 | Service Outcome | Record Resulted in Service or Did Not Result in Service; optional notes; Save Outcome | PRD 18; MVP 18 | "Did this referral result in service?" with both choices (`public/receiving/referral.html`). No outcome notes field found | No change | `PARTIAL`: the core matches; the notes field is not built (U-6) |
| 13 | Correction History | Tabs for Referral History, Response History and Outcome History; entries with what changed, who, when and why | PRD 19; MVP 19 (audit evidence must show what, who and when; neither says a screen lists it) | Correction forms for the decision and the outcome exist, and audit evidence is recorded and tested (G-24). No screen that lists the history was found | No change | `NOT BUILT` as a screen; whether QCH expects it is U-6 |
| 14 | Reports (Aggregate Only) | A banner that demo data is synthetic; a period selector; total, accepted with rate, Resulted in Service; By Program and By Department tabs | PRD 25; MVP 24, 25 | Monthly, quarterly and yearly views, with the totals and breakdowns tested (G-29). A help line reads "Aggregate reporting only. Development build: use synthetic data only." No banner like the wireframe's | No change | `PARTIAL` |
| 15 | Program Management | Status; tabs (Basic Info, Locations, Services, Eligibility, Contact, Important Info); name, Department, age eligibility, languages, Program Description, Important Information About Our Program | PRD 9, 10; MVP 12 | Program Management pages for information, matching facts, languages, flexible fields and lifecycle (`public/program-management/`). The tabs differ. "Important Information About Our Program" is not pre-created (P-9) | No change | `PARTIAL` |
| 16 | Permission Administration | A user table (role, Department and Program access, status, actions) and a note that changes need server authorization and cannot be used for self-elevation | PRD 23, 24; MVP 23 | Not on `main` | Open PR #63; see G-28 for the restrictions it adds | `OPEN PR` |
| 17 | Multi-Location Program | A Locations table (name, primary or satellite, status, Add Location) and a note that a Program can have several locations under one listing, or separate listings | PRD 13; MVP 14 | Separate listings by site, and a free-text "Additional locations" field for a shared listing (G-20). No structured Locations list | No change | `DIFFERENT`: both representations are possible; the structured list is not built (U-3) |
| 18 | No Match Result | "No matches found" with Revise Search and Go to Direct Referral | PRD 6.5; MVP 7 | Says so plainly, keeps the answers, and offers Change answers and Use Direct Referral (`e2e/gpme.spec.js`) | No change | `MATCHES` |
| 19 | Accessibility Controls | Text size S, M, L, XL (12, 14, 18, 24 px) with a sample; an Accessibility Help link | PRD 33; MVP 27 | S, M, L, XL buttons on the pages. The pixel sizes and the Accessibility Help link were not checked here. XL at phone width scrolls sideways (G-33) | Fix is open PR #69 | `PARTIAL` |
| 20 | Department Administration (note) | A written note: Department administration remains an MVP requirement; no dedicated screen is drawn; Departments are configurable, and are discontinued or retired, not deleted | PRD 11, 12; MVP 13 | Organization pages exist (`public/program-management/organization.html`) and are tested under G-19 | No change | `MATCHES` the note |
| 21 | Help and Guidance | Inline help and key reminders: refer through QCH Connect; age is used only for matching; do not include unnecessary personal information; use Direct Referral if the Program is known | PRD 3.2, 5.4, 14, 15 | No help panel found. Pieces of the guidance appear in place (the age and matching note) | The QCH Connect-first line appears after #64 | `PARTIAL`: the reminders exist in places; the panel is wireframe only (U-6) |

## Current integrated status

This section is separate from the audit above. The audit describes `cd22455`.
This describes **`main` at `eea57fd`**, which is `cd22455` plus eleven merged
pull requests, including the three that touch audit rows (#64, #67 and #72),
merged into this branch. This branch adds one test and documentation, and no
product code.

**What merged since the audit:**

| Pull request | What it is | Audit rows it affects |
| --- | --- | --- |
| #64 (Task X) | Current Program information in Find a Program | G-13, G-15, G-16, G-17 (see below) |
| #67 (Task AA) | Journey 13: Program Management changes reach Find a Program | Adds evidence to G-16 and G-18 (see below) |
| #72 (Task S) | Demo reset steps (documentation) | None |

**Rows that changed status:**

| Row | Audit status | Current status | Why it changed | Evidence run now | Limits |
| --- | --- | --- | --- | --- | --- |
| G-13 | `OPEN-PR-MATCHES` | `VERIFIED` | #64 merged. Staff now see availability and wait-list information with each result | `test/findProgramInformation.test.js` ("a wait-listed or full Program still appears, with its information and primary contact"), `e2e/findProgramInformation.spec.js` | Chromium only for the spec. In-memory store. Availability is shown from Program-maintained text fields |
| G-15 | `MERGED-NEEDS-VERIFICATION` | `VERIFIED` | #64 added a test that results carry the same Programs in the same order with or without availability data | `test/findProgramInformation.test.js` ("each result carries both, with the same Programs in the same order") | Server side. In-memory store |
| G-16 | `OPEN-PR-MATCHES` | `VERIFIED` | #64 merged: staff now see current Program information inline with each result. #67 adds Journey 13, where a Program Management change reaches Find a Program | `test/findProgramInformation.test.js`, `e2e/findProgramInformation.spec.js`, `test/regression/workflowJourneys.test.js` (Journey 13) | Chromium only for the spec. Information is shown inline, not as the tabbed page of wireframe 5 (U-5). In-memory store |
| G-17 | `OPEN-PR-MATCHES` | `VERIFIED` | #64 merged, and its tests assert the PRD 14 wording | `test/findProgramInformation.test.js` (asserts the guidance matches "contact only if you cannot find what you need here"), `e2e/findProgramInformation.spec.js` | Chromium only for the spec |
| G-32 | `MERGED-NEEDS-VERIFICATION` | `VERIFIED` | This branch adds a behavioral check: the real interpretation request runs while fetch, http, https, sockets and DNS are watched, and the test fails on any non-loopback attempt. It passes, a companion case shows the watcher sees an outbound call, and planting a `fetch` in the interpreter makes it fail | `test/gpmeInterpretation.test.js` ("no outbound call is made while a description is interpreted (MVP 26, gate 32)") | Covers the interpretation request path only. The source scan stays as supporting static evidence. In-memory store |

Rows **not** changed by the merges: G-5 and G-20 stay `MERGED-NEEDS-VERIFICATION`
(reasons in their rows), G-28 stays `OPEN-PR-MISMATCH`, and every other open pull
request below is still open.

**Counts, current:**

| Status | As of `cd22455` | Current |
| --- | --- | --- |
| `VERIFIED` | 26 | 31 |
| `MERGED-NEEDS-VERIFICATION` | 10 | 8 |
| `OPEN-PR-MATCHES` | 5 | 2 |
| `OPEN-PR-MISMATCH` | 1 | 1 |
| `TRUE-GAP` | 2 | 2 |
| `PRODUCTION-DEPENDENCY` | 7 | 7 |

**Still open and not run here:** #63 (permission administration), #68 (privacy
regression), #69 (accessibility and the XL fix), #70 (demo verification), #74
(failure recovery), #75 (age privacy and exact age), #76 (rehearsal), #77
(lifecycle regression). Their rows (G-6, G-8, G-28, G-30, G-33, G-34, G-3 and
P-36) stay as the audit recorded them until the pull requests merge and their
tests are run.

## Revisions made to the audit

These findings were reassessed after review. Each is in the table above.

- **Notification recipient row removed (was P-21b, `TRUE-GAP`).** The frozen
  documents do not require an in-application screen or setting for a
  receiving Program's notification address. PRD 16 and 21 require a
  notification after the referral is committed, a failure that does not roll
  the referral back, and a failure and retry that can be traced, and the
  gate G-26 covers those. How an address is set is an open question (U-1),
  not a requirement.
- **Archival (P-31) `TRUE-GAP` to `PRODUCTION-DEPENDENCY`.** The frozen wording
  makes archival a production process on SharePoint Lists that QCH IT planned,
  and no acceptance gate names it. See P-31 and U-2.
- **Multiple locations (G-20) `TRUE-GAP` to `MERGED-NEEDS-VERIFICATION`.** Both
  representations that PRD 13 and MVP 14 ask for exist, and separate listings
  are tested. See G-20 and U-3.
- **Permission administration (G-28) `OPEN-PR-MATCHES` to `OPEN-PR-MISMATCH`.**
  The earlier row treated the "team restriction" label as compliance with PRD 24.
  A label is not evidence. See G-28 and U-4.
- **Human review (G-5) `VERIFIED` to `MERGED-NEEDS-VERIFICATION`.** The row said
  part of the gate's wording had not been checked, which the evidence rules do
  not allow under `VERIFIED`.
- **No external AI (G-32) `VERIFIED` to `MERGED-NEEDS-VERIFICATION` at `cd22455`.**
  Its only evidence was a static source scan. The evidence rules now apply the
  same standard to every row, and a behavioral check was added (current status).
- **Wireframes.** The earlier table listed screens without mapping their
  experiences, and set three aside as "not classified". The UX mapping above
  replaces it.
- **Historical and current status** are now separate sections.

## Remaining uncertainties (not requirements, and not confirmed gaps)

These are questions the frozen documents do not settle. None is classified as a
requirement or as a `TRUE-GAP`, and none changes a row's status except where a
row says so.

| ID | Question | What the frozen documents say | Who can settle it |
| --- | --- | --- | --- |
| U-1 | How is a receiving Program's notification address configured: seed data, a setting in the application, a SharePoint List column, or the shared mailbox only? | PRD 21 and MVP 21 require notification after commit, a failure that does not remove the referral, and traceable failure and retry. They name the shared mailbox for production sending. They do not say how the receiving address is held or set, and no wireframe draws a setting. The application has no screen for it, and a Program created in the application has no recipient, so its notification fails with a traceable reason while the referral is saved | QCH and QCH IT; the team for scope |
| U-2 | Who builds and runs the archival process: QCH IT as a production process, or this team as application code? | PRD 31 and MVP 30 describe a planned production process that QCH IT established. MVP 28 lists it among production requirements. It is not an acceptance gate and is not in the MVP 31 dependency list by name | QCH IT, with the team |
| U-3 | Does a free-text "Additional locations" field satisfy "one shared listing containing multiple locations", or does QCH want the structured Locations list that wireframe 17 draws? | PRD 13 and MVP 14 require that both representations be possible and that neither be forced. They do not say how a shared listing is structured. Wireframe 17 shows a structured list and says it is not tied to current implementation code | QCH |
| U-4 | Are the four extra restrictions in #63 acceptable to QCH, and does the rule against granting Administer permissions on the screen leave QCH able to add an administrator without IT help? | PRD 24 and MVP 23 require server-side authorization, target and Program-scope validation, least privilege, no self-elevation and audit. They say extra restrictions must not be treated as QCH policy unless QCH approves them. PRD 23 requires "authorized administrative capability" for permission management without saying how the first administrator is made | QCH |
| U-5 | Is showing Program information inline under each result enough, or is the tabbed Program Details page of wireframe 5 expected? | PRD 8 and MVP 10 say employees must have access to appropriate current Program information and list what it may include. They do not require a separate page | QCH, with the wireframe owner |
| U-6 | Are the wireframe experiences that no PRD or MVP section requires expected in the MVP: the dashboard cards and recent-referrals table, a separate review step, outcome notes, the correction-history screen, the demo-data banner, the Help and Guidance panel, separate Department and Location filters, and the wireframe's participant-field set? | The wireframes are derived from the PRD and the MVP, and their header says they are not tied to the current implementation. The PRD and MVP require the behavior behind some of them (audit evidence, necessary information only, QCH Connect-first guidance) without requiring the screen | QCH and the wireframe owner |

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
| No way to set a Program's notification address | PRD 16 and 21 require notification after commit with traceable failure. They do not require a way to set the address in the application | Not a current requirement and not a confirmed gap. Recorded as U-1 |
| XL text scrolls sideways at phone width | PRD 33 requires reflow without inappropriate horizontal scrolling | Carried forward in G-33; fix is open PR #69 |
| "Important Information About Our Program" is not a standard field | PRD 9 names it as a flexible-text field | Carried forward as P-9, `MERGED-NEEDS-VERIFICATION` (a manager can create it) |
| A shared multi-location listing is only free text | PRD 13 and MVP 14 require that both representations be possible | Carried forward as G-20, `MERGED-NEEDS-VERIFICATION`; both exist, and whether free text is enough is U-3 |
| Data store "SharePoint Lists or Azure SQL" pending | PRD 27 confirms SharePoint Lists | Replaced by the production architecture table. G-35 tracks the documents |
| Approved AI service pending (decision 7, R5) | PRD 7 and MVP 26 exclude external AI from the MVP | Removed from pending items (G-32) |
| Permission administration blocks freeze (Task V) | PRD 24 and MVP 23 require it | Carried forward as G-28, `OPEN-PR-MISMATCH` (the four extra restrictions, U-4) |

## Keeping this page current

- The audit tables stay as of `cd22455`. When a pull request merges, record it in
  [Current integrated status](#current-integrated-status), with the revision and
  the test run, and leave the audit row alone.
- A row changes status only when a merged change and an executed test agree.
  Merging a pull request does not by itself move a row to `VERIFIED`: rerun the
  tests and record the revision.
- `test/traceability.test.js` checks that all 36 MVP gates appear exactly as
  written, that every Handoff PRD section 1 to 37 and every Handoff MVP section
  2 to 31 is cited by a row, that every wireframe is mapped, that every cited file
  exists, that a `VERIFIED` row cites a behavioral test and states its limits,
  that the current counts follow from the audit counts and the changed rows, and
  that an uncertainty is not also a requirement row. It does **not** prove a
  requirement is met.
- Re-check every `OPEN-PR-*` row against the open pull requests (#63, #68, #69,
  #70, #74, #75, #76, #77) before the Nov. 2 freeze.
