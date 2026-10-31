# QCH Connect: Capstone handoff release notes

**Status: prepared before the freeze. Not final.** Trello Task 219 (card
"Task 213: Prepare capstone handoff release notes"). Prepared on `main` at
`2746c83` (October 31, 2026). The frozen commit and the final verification
results are **PENDING TASK V** and are filled in only after Task V
establishes them ([freeze-audit.md](freeze-audit.md)).

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
| Planned code freeze | November 2, 2026 ([freeze-audit.md](freeze-audit.md)). Confirmed by Task V |
| Synthetic demo | November 9, 2026 ([demo-runbook.md](demo-runbook.md)) |
| Handoff date | Not recorded in this repository. To be set by the project lead |
| Frozen commit (SHA) | **PENDING TASK V** |
| Final verification | **PENDING TASK V** (section 6) |
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

**The application is not running in production, and no production
infrastructure has been provisioned.** Everything in section 2 runs on
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
| Frozen commit (SHA) | **PENDING TASK V** |
| `npm test` on the frozen commit | **PENDING TASK V** |
| `npm run test:e2e` on the frozen commit | **PENDING TASK V** |
| Other browsers on the frozen commit | **PENDING TASK V** |
| Task V freeze findings and decision | **PENDING TASK V** ([freeze-audit.md](freeze-audit.md)) |

**Manual verification recorded so far.** These records were made on earlier
commits. They are not Task V results and do not verify the frozen commit.

| Manual check | Recorded result | Record |
| --- | --- | --- |
| VoiceOver with Safari 27.0 (macOS), 33 steps across New Referral, Find a Program, Program Management and text size | **Pass**, after four fixes found in that run. October 24 to 25, 2026, Jimmy Ong, on branch `jimmy/screen-reader-check` | [screen-reader-check.md](screen-reader-check.md) |
| Demo rehearsal Run 2, by hand in Safari 27.0 | **Not finished.** See item C1 for the latest recorded progress; the rehearsal page still shows earlier progress until the run ends | [known-limitations.md](known-limitations.md) C1; [demo-rehearsal.md](demo-rehearsal.md) Run 2 |
| Real browsers other than Safari, and any mobile browser | **Not run by hand.** Other browsers were run only as automated Playwright engines | [browser-verification.md](browser-verification.md); [known-limitations.md](known-limitations.md) C2 |

No result on this page covers QCH's production environment
([known-limitations.md](known-limitations.md) C3).

## 7. Suggested release tag

Suggested name: **`v1.0.0-capstone-handoff`**, on the commit Task V
establishes.

**No tag has been created.** Whether to tag, which commit, and the final name
are the project lead's decision.
