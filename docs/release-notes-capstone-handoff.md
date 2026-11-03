# QCH Connect: Capstone handoff release notes

**Status: finalized after Task V.** Prepared in Trello Task 219 (card
"Task 213: Prepare capstone handoff release notes") on `main` at `2746c83`
(October 31, 2026); the Task V fields were filled in by Task 230. The frozen
commit, final verification results and freeze decision below come from
Task V ([freeze-audit.md](freeze-audit.md)). Nothing else on this page was
re-verified by Task 230.

**Nothing on this page is a new requirement.** It summarizes what the
repository delivers and points to the evidence. The requirements are the
Frozen Handoff PRD and the Handoff MVP (October 28, 2026); the screens are
the Current Handoff Wireframes (v1.6). Where this page and those documents
differ, the Frozen Handoff PRD governs.

All data in this repository, its tests and its demo is synthetic.

## 1. Release

| | |
| --- | --- |
| Release name | QCH Connect, Capstone Handoff MVP |
| Code freeze | November 2, 2026. Task V decision: **FREEZE APPROVED WITH DOCUMENTED LIMITATIONS** (Christina Ruiz, November 2, 2026, America/New_York; [freeze-audit.md](freeze-audit.md)) |
| Synthetic demo | November 9, 2026 ([demo-runbook.md](demo-runbook.md)) |
| Handoff date | Not recorded in this repository. To be set by the project lead |
| Frozen commit (SHA) | `a5ccc5e68da3b32ae99883022b6334f8967d10f7` |
| Final verification | Node and Chromium suites passed on the frozen commit (section 6) |
| Suggested tag | Section 7. No tag has been created |

## 2. What is delivered

"Delivered" here means built in this repository and covered by automated
tests, running on in-memory stores with synthetic data. It does **not** mean
running in QCH's production environment (section 4). Requirement-by-requirement
status, with the evidence rules used, is in
[prd-traceability.md](prd-traceability.md); that page records its own tested
revisions and has not yet been reassessed for every pull request merged since.

| Workflow (plain language) | Handoff MVP | Evidence in the repository |
| --- | --- | --- |
| **Find a Program.** Staff describe the participant's need in their own words, review and correct what the app understood, optionally give an exact age or an age range, and see advisory Program suggestions with reasons. Staff, not the app, choose the Program | §4, §5, §6, §7 | `e2e/gpme.spec.js`, `e2e/interpretationReview.spec.js`, `test/gpme.test.js`, `test/gpmeInterpretation.test.js` |
| **No match vs. something broke.** A real "no plausible match" and a technical failure are shown differently; both offer Direct Referral | §7 | `test/regression/noMatchVsFailure.test.js`, `e2e/noMatchVsFailure.spec.js` |
| **Direct Referral.** Staff who already know the Program pick it directly. It works even when Find a Program is unavailable | §4 | `e2e/directReferral.spec.js`, `test/regression/directReferralIndependence.test.js` |
| **One referral lifecycle for both paths** | §4, §16 | `test/regression/workflowJourneys.test.js` (Journey 12), `e2e/mvpJourney.spec.js` |
| **Age stays private.** The participant's age is used only for matching and is never saved on the referral or shown later | §6 | `test/regression/agePrivacy.test.js`, `e2e/agePrivacy.spec.js` |
| **Program information with each result:** language of service, availability and wait-list information, current Program information fields, and the "send referrals through QCH Connect" guidance. None of it changes which Programs are suggested | §8, §9, §10, §11 | `e2e/findProgramInformation.spec.js`, `e2e/languageOfService.spec.js`, `test/findProgramInformation.test.js` |
| **Program Management:** Program details, matching facts, configurable fields and values, Departments, creating and moving Programs, discontinuing rather than deleting | §12, §13 | `e2e/programManagement.spec.js`, `e2e/programManagementJourneys.spec.js`, `e2e/organization.spec.js`, `e2e/fieldValues.spec.js`, `e2e/matchingManagement.spec.js`, `test/regression/lifecycleRegression.test.js` |
| **Programs at more than one location,** as separate listings or one shared listing | §14 | `test/regression/multiLocation.test.js` |
| **Sending a referral safely.** Only necessary participant information; a double click, retry or lost connection never makes a duplicate; recoverable failures keep the employee's work | §15, §20 | `test/regression/idempotency.test.js`, `e2e/doubleSubmit.spec.js`, `e2e/directReferralRecovery.spec.js`, `test/regression/failureRecovery.test.js` |
| **Receiving Program response, service outcome and corrections,** each correction keeping its history; the sender follows status in "Referrals I sent" | §16, §17, §18, §19 | `e2e/receiving.spec.js`, `e2e/receivingLifecycle.spec.js`, `test/regression/correctionHistory.test.js`, `e2e/sentReferrals.spec.js`, `e2e/referralNavigation.spec.js` |
| **Notifications after the referral is saved;** a failed notification never undoes the referral and is traceable. Runs on a simulated outbox only (section 4) | §21 | `test/notificationWiring.test.js`, `test/regression/notificationFailure.test.js` |
| **Server-side authorization and permission administration,** with no self-elevation | §22, §23 | `test/securityPass.test.js`, `test/regression/securityRegression.test.js`, `test/permissionAdministration.test.js`, `test/regression/permissionSecurity.test.js`, `e2e/permissions.spec.js` |
| **Aggregate reporting** by Program and Department for month, quarter and year | §24 | `e2e/reportingKnownAnswers.spec.js`, `e2e/reportingDepartments.spec.js`, `test/regression/reportingJourney.test.js` |
| **Privacy:** no participant information in logs, reports, notifications, addresses or browser storage | §25 | `test/regression/privacyRegression.test.js`, `e2e/privacy.spec.js`, [security-regression.md](security-regression.md) |
| **No external AI.** The describe-the-need step is rule-based; a test fails if it tries to reach the network | §26 | `test/gpmeInterpretation.test.js` |
| **Accessibility** toward WCAG 2.2 AA: keyboard use, labels, text size S/M/L/XL, reflow, contrast in light and dark | §27 | `e2e/accessibilityFinal.spec.js`, `e2e/screenReader.spec.js`, `test/regression/accessibility.test.js`, [regression-coverage.md](regression-coverage.md) |
| **A stable synthetic demo** that cannot run in production | gates 31, 34 | [demo-environment.md](demo-environment.md), `test/demoEnvironment.test.js`, `test/demoVerification.test.js` |

How administrators use the delivered screens: [admin-guide.md](admin-guide.md).
How the application is built: [architecture.md](architecture.md).

## 3. Not delivered, still limited, or awaiting decisions

These lists are kept in two places and are **not redefined here**. Read them
there:

- [known-limitations.md](known-limitations.md): what is known not to work
  yet, not built in this repository, or not yet verified, with the evidence
  for each.
- [handoff-questions.md](handoff-questions.md): the questions QCH or QCH IT
  still has to decide. Until a question is answered, the application keeps
  its documented behavior, and that behavior is not QCH policy.

## 4. Production status

**Production provisioning and deployment have not been confirmed or
verified by the team.** Everything in section 2 runs on
in-memory stores with synthetic data. In production mode the server fails
closed: without real sign-in, every `/api` route answers 401.

Kept apart:

| | Where it is described |
| --- | --- |
| **Delivered application behavior** (this repository) | Section 2; [architecture.md](architecture.md) |
| **Confirmed production architecture** (Frozen Handoff PRD: SharePoint Lists in a private site, Azure Functions with a managed identity, Microsoft Graph with `Sites.Selected`, the shared mailbox through Exchange RBAC, Entra ID single sign-on with MFA) | [production-architecture.md](production-architecture.md), sections 1 and 2 |
| **What QCH and QCH IT must still provision or decide** (PRD §37; MVP §31) | [production-architecture.md](production-architecture.md), section 3; [qch-it-requirements.md](qch-it-requirements.md) |
| **Handoff deliverables and what each waits on** | [handoff-checklist.md](handoff-checklist.md) |
| **Deployment procedure** (draft; parts describe an earlier plan) | [deployment.md](deployment.md) |

Those dependencies are QCH/QCH IT production work. They are not Capstone
failures and are not completed Capstone infrastructure (PRD §37; MVP §28,
§31).

## 5. How to run and verify the delivered candidate

Use exactly the pinned runtime: **Node.js 24.15.0** (`.nvmrc`,
`package.json` `engines`, `package-lock.json`). QCH's production runtime is
not confirmed (section 4).

```bash
nvm use                 # Node 24.15.0, from .nvmrc
npm ci                  # exact dependencies from package-lock.json
npm run check-runtime   # confirms the running Node version
cp .env.example .env    # sets NODE_ENV=development; never commit .env
```

**Automated checks** (synthetic data, in-memory stores):

```bash
npm test                                         # Node test suite
npx playwright install chromium                  # once per machine
npm run test:e2e                                 # browser tests in Chromium
npm run test:e2e:browsers                        # Edge, Chromium, Firefox, WebKit
```

The browser tests start their own synthetic server. Running every browser
takes about 25 minutes; see [browser-verification.md](browser-verification.md).

**Try it by hand** (one laptop, synthetic data, opens on `127.0.0.1` only):

```bash
npm run dev:demo        # demo people with separate roles; open http://127.0.0.1:3000/demo/ and choose a person
npm run dev:synthetic   # one synthetic person who plays every role; open http://127.0.0.1:3000/
```

Both refuse to start unless `NODE_ENV=development`. To reset, press `Ctrl+C`
and run the same command again; all data is rebuilt from the synthetic seed. Details and
safety checks: [demo-environment.md](demo-environment.md) and
[demo-runbook.md](demo-runbook.md).

`npm start` runs the production entry point. Without QCH's sign-in it
refuses every API request by design; it is not a demo mode.
`npm run licenses` lists every dependency's license
([dependencies.md](dependencies.md)).

## 6. Final verification

| Item | Result |
| --- | --- |
| Frozen commit (SHA) | `a5ccc5e68da3b32ae99883022b6334f8967d10f7` |
| Test environment | Task V decision run: Christina Ruiz, Windows, clean working tree, commit confirmed separately (exact Windows build and browser version not reconfirmed). Supporting run: fresh clone, Ubuntu 24.04.5 LTS, Node 24.15.0, npm 10.9.9, Playwright 1.63.0, Chromium 153.0.8010.12 |
| `npm test` on the frozen commit | Windows (Task V decision run): **1,752 passed**, 248 suites, 0 failed, 0 skipped. Ubuntu (supporting): 1,752 passed, 248 suites, 0 failed |
| `npm run test:e2e` (Chromium) on the frozen commit | Windows (Task V decision run): **237 passed** (3.5 min). Ubuntu (supporting): run 2, 237 passed; run 1, 236 passed and 1 intermittent failure (`e2e/screenReader.spec.js:323`, skip link on `organization-programs.html`) that passed on rerun (12/12) and 20/20 alone, recorded on Task V as a test-timing race, not a reproduced product defect |
| Other browsers on the frozen commit | **Not run on the frozen commit.** The last recorded multi-browser run (Edge, Chromium, Firefox, WebKit: 160 passed, 1 skipped each) was on `9fd179b` plus PR #61, October 27, 2026, and predates later changes ([browser-verification.md](browser-verification.md)). QCH's supported production browser baseline is a QCH IT dependency (PRD §37 item 10) |
| Task V freeze findings and decision | **FREEZE APPROVED WITH DOCUMENTED LIMITATIONS** (Christina Ruiz, November 2, 2026, America/New_York; [Task V](https://trello.com/c/6KBxus4K)). Findings and proposed dispositions: [freeze-audit.md](freeze-audit.md), "Task V closeout review" |

Christina's decision accepts these named limitations for this freeze:
incomplete actual screen-reader and accessible-name verification; older
Narrator, Safari and age/shared-location display verification gaps;
notification-recipient configuration and delivery-record retry limitations;
human-paced rehearsal and recording still outstanding; and the documented
QCH/QCH IT production dependencies, including unimplemented production
archival with ownership unresolved. Existing release screen deferrals remain
in effect. In her words, this is "approval of the named candidate with
limitations, not full MVP completion, WCAG conformance or production
readiness." No git tag or production deployment was created or authorized
([Task V](https://trello.com/c/6KBxus4K)). The limitations themselves are kept
in [known-limitations.md](known-limitations.md),
[handoff-questions.md](handoff-questions.md) and
[production-architecture.md](production-architecture.md), not redefined here.

Between the earlier application candidate `f35c754` and the frozen commit,
only documentation changed (PRs #113 to #116); application and test files
are the same. Earlier full-suite evidence for `f35c754` and PR #112 head
`073cc50` is recorded in [freeze-audit.md](freeze-audit.md).

**Manual verification recorded so far.** These records were made on earlier
commits. They are not Task V results and do not verify the frozen commit.

| Manual check | Recorded result | Record |
| --- | --- | --- |
| VoiceOver with Safari 27.0 (macOS), 33 steps across New Referral, Find a Program, Program Management and text size | **Pass**, after four fixes found in that run. October 24 to 25, 2026, Jimmy Ong, on branch `jimmy/screen-reader-check` | [screen-reader-check.md](screen-reader-check.md) |
| Demo rehearsal Run 2, by hand in Safari 27.0 | **Not finished.** See item C1 for the latest recorded progress; the rehearsal page still shows earlier progress until the run ends | [known-limitations.md](known-limitations.md) C1; [demo-rehearsal.md](demo-rehearsal.md) Run 2 |
| Windows/Edge desktop verification (Task 203) | Recorded October 30–31, 2026, on application baseline `2746c83d40d1b8c0ef5a21cd0adf618b0a2e4a0d`; report merged in PR #101. Selected synthetic workflows, text-size and actual browser-zoom checks completed, with documented coverage limits. Demo-banner overlap F1 was later repaired in PR #110 and retested in Edge at XL and actual 100%, 200% and 400% zoom on repair commit `49677be` | [desktop-browser-check.md](desktop-browser-check.md); [known-limitations.md](known-limitations.md) C7; [issue #102](https://github.com/kwitykwity/L3-CS-QCH/issues/102) |
| Help & Guidance and Referral Confirmation (Task 229) | Keyboard, focus, S/M/L/XL and actual 200%/400% zoom checks **passed**, Christina Ruiz, Edge 156.0.4314.58 on Windows, `main` at `bf56801`. Actual screen-reader announcements and separate accessible-name inspection were **not tested** | [known-limitations.md](known-limitations.md) C6 |
| Other manual browser coverage | No additional manual browser coverage is established by the records cited here. Mobile-device use is outside the project lead's intended production scope; desktop narrow-width checks do not establish mobile support | [browser-verification.md](browser-verification.md); [desktop-browser-check.md](desktop-browser-check.md) |

No result on this page covers QCH's production environment
([known-limitations.md](known-limitations.md) C3).

## 7. Suggested release tag

Suggested name: **`v1.0.0-capstone-handoff`**, on the frozen commit
`a5ccc5e`.

**No tag has been created.** Whether to tag, which commit, and the final name
are the project lead's decision.
