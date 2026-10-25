# Functional, accessibility and end-to-end verification (Task G)

**Status: draft.** Evidence that the major QCH Connect journeys work
together, browser to backend to the current application store and back,
recorded with the loop the card asks for: test first, record evidence,
identify the failure, fix only if needed, retest. It does not prove
anything about QCH's production environment; see the last section.

## What was run

| | |
| --- | --- |
| Build | `main` at `e6106bd` (after #41, Reporting Center UI), plus this branch |
| Store | The in-memory application store with synthetic data (`npm run dev:synthetic` for browser tests) |
| Runtime | Node 22.23.4 in the verification workspace. The team's pinned version is 24.15.0; CI and reviewers run that |
| Browser | Chromium (Playwright) with axe-core, WCAG 2.2 AA tags |
| Date | October 25, 2026 |

### Before any change (test first)

| Suite | Result |
| --- | --- |
| `npm test` (Node, including `test/regression/`) | 1,283 passed, 0 failed |
| `npm run test:e2e` (Chromium) | 88 passed, 0 failed |

### After this branch (retest)

| Suite | Result |
| --- | --- |
| `npm test` | 1,283 passed, 0 failed |
| `npm run test:e2e` | 93 passed, 0 failed (5 new in `e2e/mvpJourney.spec.js`) |

## Journeys exercised

`e2e/mvpJourney.spec.js` follows one piece of work across every feature,
so a change in one feature that breaks another is caught:

1. **Program Management changes Find a Program.** The Program manager
   raises Adult Evening Classes' minimum age from 18 to 65 on the matching
   page; an 18 to 30 Education search stops listing it (the page says no
   Program fits and moves focus to that message), and a 70 to 80 search
   lists it. Facts are put back afterwards.
2. **Find a Program, then send by keyboard.** A Housing search lists
   Housing Help Desk; choosing it carries the Program into the referral
   form, which is filled and sent by keyboard. The server records it as
   `GPME_ASSISTED`, awaiting response.
3. **Receive, respond, record.** The receiving Program finds it in the
   queue, opens it by keyboard, accepts it (outcome still "not recorded"),
   then records Resulted in service.
4. **Reporting reflects it.** The Reporting Center's Housing Help Desk
   numbers for the month move by exactly that referral: total +1,
   accepted +1, resulted in service +1, awaiting response unchanged.

Every item on the card, and where it is verified:

| Card item | Evidence |
| --- | --- |
| Direct Referral | `e2e/directReferral.spec.js` (9), `test/regression/journeys.test.js` |
| Find a Program / GPME | `e2e/mvpJourney.spec.js` (above); `test/gpme*.test.js`. A dedicated GPME browser spec is open in #33 |
| Receiving queue and access | `e2e/receiving.spec.js` (19); multi-person access in #38 (open) |
| Referral response, service outcome, corrections | `e2e/receiving.spec.js`; `e2e/mvpJourney.spec.js`; `test/serviceOutcome.test.js` |
| Program Management | `e2e/programManagement*.spec.js`, `fieldValues`, `organization`, `matchingManagement` (59); `e2e/mvpJourney.spec.js` step 1 |
| Reporting | `e2e/reportingDepartments.spec.js`; `e2e/mvpJourney.spec.js` steps 4 and the Reporting Center checks below; `test/regression/reportingJourney.test.js` |
| Notification behavior | Not on `main` yet. #42 (Task E) wires it in with its own tests |
| Keyboard-only operation, logical and visible focus | Every e2e spec; Reporting Center by keyboard alone with error recovery (new) |
| Persistent labels, required fields | `test/regression/accessibility.test.js` (every page); axe in e2e |
| Validation and error recovery | Per-page specs; Reporting "choose a Program" error moves focus and leaves the report unchanged (new) |
| S/M/L/XL text sizes | Per-page specs; Reporting Center S to XL, kept after reload (new) |
| Narrow-screen behavior | Receiving and referral pages at XL, phone width; Reporting Center at XL, 390 px (new; it failed, see below) |
| Privacy protections | `test/securityPass.test.js`; Task F (#47, open) |
| Screen reader, where practical | Manual: Christina, Chrome and Edge with Windows Narrator (selected Program Management workflows); Jimmy, VoiceOver and Safari (#45, open) |
| Beyond Chromium | Manual: Lebert, Safari on macOS, October 24, 2026, Runs A to D of the keyboard checklist in [regression-coverage.md](regression-coverage.md): all passed |

## Failures found, fixed and retested

| Found | Cause | Fix | Retest |
| --- | --- | --- | --- |
| Reporting Center scrolled sideways by 60 px at XL text on a 390 px wide screen (WCAG 1.4.10 reflow, PRD 14.5) | The text-size buttons did not wrap, and the filter fields and the report grids had a 14rem minimum width, wider than the screen at XL | `public/reporting/reporting.css`: the size control wraps; fields and grid columns use `min(14rem, 100%)` | 0 px sideways scroll; axe still passes in both themes |

Two first-run failures were mistakes in the new test, not the app, and
were corrected in the test: a search with no matching Program correctly
moves focus to the "no Program fits" message rather than the results
heading; and showing a Program report before choosing a Program correctly
shows "Choose a Program, or switch the scope to All of QCH." and moves
focus to the Program box. The test now checks both behaviors.

## Waits on the QCH environment

| What | Waits on |
| --- | --- |
| The same journeys against the production store (persistence, locking, constraints) | Where data lives (pending decision 1) |
| Real sign-in in the journeys instead of the synthetic identity | Entra (pending decision 5) |
| A real new-referral email at the end of step 2 | #42, then the Graph sender and mailbox permission (pending decision 6) |
| The supported-browser list and its runs | QCH's agreement on the browser matrix |
| Running in QCH's hosting (HTTPS, headers, monitoring) | Hosting (pending decision 2) |

See [pending-qch-it-decisions.md](pending-qch-it-decisions.md) and
`docs/security-regression.md` (Task F, #47) for what must be re-run once
these are decided.
