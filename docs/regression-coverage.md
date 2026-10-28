# Regression coverage: accessibility and end-to-end (Card 17)

What the regression pass covers, where each part is tested, and what still
waits on other work. Final Technical PRD 14 (accessibility and
interaction), 17.2 (critical end-to-end tests), 17.3 (authorization) and
17.7 (accessibility interaction tests).

**Status: second slice, against `main` at `00d0759` (October 25, 2026).**
First slice (`bdfeab3`, October 21): Direct Referral, the receiving queue
and response, and Program maintenance slice 14A. This slice adds HTTP
journeys for GPME-assisted referral, outcome and corrections, Program
fields and values (14B) and organization changes (14C), so every area the
first slice listed as "still to add" now has one. The tables below
separate covered workflows from **dependencies that are not merged yet**.
The same rule as the security suite applies: a merged workflow is not
done until it has a journey here.

## How to run

```bash
npm test                          # everything, including the regression suite
node --test test/regression/      # just the regression suite

npx playwright install chromium   # once per machine, for the browser tests
npm run test:e2e                  # browser tests: keyboard, focus, text size, axe
```

`npm run test:e2e` starts its own synthetic dev server on port 3217 and
stops it afterwards. To use a Chromium that is already installed, set
`CHROMIUM_PATH` to it.

| File | What it checks |
| --- | --- |
| `test/regression/journeys.test.js` | Whole workflows through the integrated app over HTTP, switching between staff members (Journeys 1 to 7) |
| `test/regression/workflowJourneys.test.js` | Journeys 8 to 12, same style: GPME-assisted referral, outcome and corrections, Program fields and values (14B), organization changes (14C), and both referral paths side by side (Task Z) |
| `test/regression/privacyRegression.test.js` | Task DD: the whole app driven with marked synthetic participant data (describe, match, GPME-assisted and Direct Referral, Not Appropriate, corrections, a failed audit, every report, notifications with a NO_RECIPIENT failure, a failing interpreter, 22 invalid requests): nothing reaches a console channel, an error response, a report or an email. Also: the Task O demo session cookie is only a random token through a whole referral. See [security-regression.md](security-regression.md#privacy-and-data-leakage-regression-task-dd) |
| `test/regression/accessibility.test.js` | Every page in `public/`: language, title, headings, labels, ids, required fields, status announcements, text size, link colors, and color contrast in both themes |
| `e2e/directReferral.spec.js` | In Chromium: the New Referral entry screen (no path preselected; Direct Referral chosen by keyboard), Direct Referral completed by keyboard only, visible focus on every stop, Shift+Tab order, Enter safety, undo/redo, S/M/L/XL, phone width at XL, and an axe WCAG 2.2 AA scan of the entry screen and every Direct Referral state in light and dark themes |
| `e2e/gpme.spec.js` | In Chromium, against the synthetic backend: matching with explained plausible / possible results, choosing a Program, submission as a GPME-assisted referral (body carries only the approved matching inputs), no plausible match vs technical failure, answers preserved, Try again, Direct Referral fallback (after a failure and with matching fully down), recovery after `GPME_UNAVAILABLE`, `GPME_RESULT_CHANGED` and a lost confirmation, keyboard-only journey, nothing sensitive in URL / storage / console, axe on every guided state in light and dark, XL at phone width. The "not checked" wording (PRD 8.10) is tested by patching `notCheckedForNeedCount` into the real match response (with results, and with no plausible match), because the synthetic seed has no Program without need categories; plus a negative case with the seed as it is. **Coverage limitation:** one known, pre-existing product defect is recorded as `test.fixme`, so it is not covered: the entry screen scrolls sideways at XL on a 375px phone (also fails with PR #32's CSS). Follow-up issue: https://github.com/kwitykwity/L3-CS-QCH/issues/46 |
| `e2e/languageOfService.spec.js` | Task W: a manager changes a Program's languages by keyboard; Find a Program shows them, or "not on file"; the Program is never hidden; axe in both themes; XL at phone width |
| `e2e/programManagement.spec.js`, `e2e/fieldValues.spec.js`, `e2e/organization.spec.js`, `e2e/matchingManagement.spec.js` | Card 14 (#32): each Program Management screen's main path in Chromium, with stale-page and lost-connection recovery and axe in both themes |
| `e2e/programManagementJourneys.spec.js` | Card 52: the Program Management journeys the card 14 specs leave out, one block per area (fields, options, reuse, replacement, retirement, Departments, Program creation, Program moves): missing and duplicate input with focus on the problem, cancelled confirmations, stale pages, lost connections, what may be reused, replaced or retired, discontinued Departments as targets, referral history across a move, keyboard-only creation, XL at phone width on every screen, axe on error states |
| `e2e/receiving.spec.js` | Task A: the receiving screens (received list, referral detail). The list shows only Programs I receive for, with Response, Decision and Service outcome kept separate, and stage filters. Accept, record and correct an outcome by keyboard (Accepted never reads as served). Not appropriate needs a reason, has no outcome, and becomes outcome-ready only after a correction to Accepted. A recorded outcome blocks a change to Not appropriate. Stale page, someone responding first, a lost connection, a save that commits but whose answer is lost, and Cancel: nothing is merged or sent twice, and an unknown outcome is described as "may have been saved", never "not saved". For each of the four changes, if the reload after a confirmed save fails, every action stays locked and the success message stays until an explicit reload succeeds. A referral I only sent is read-only, and the server refuses a direct request. An unknown ID reveals nothing. axe in both themes; XL at phone width |
| `e2e/receivingLifecycle.spec.js` | Card 51: the receiving lifecycle across several synthetic staff, each in their own browser, on a private copy of the app. Send through the New Referral page, accept, record, correct, and the sender sees the result read-only; reject with a reason, then correct to Accepted and record. Each step audited once as the person who did it. Unauthorized: staff of another Program get "not available" and 404s; view-only and respond-only staff see only their actions and get 403s; a permission revoked while the page is open is refused; identity fields in a body or URL are refused (400), no identity is 401. Two receivers at once: responded first, two outcome corrections, two decision corrections, each refused with what is saved now, nothing merged, and a deliberate retry after review succeeds. Mutation-checked against the server permission checks |
| `e2e/privacy.spec.js` | Task DD: one referral carried through every screen with marked synthetic data (Find a Program with the describe step, details, receiving, corrections, outcome, Referrals I sent, Reporting Center, Program Management). Authorized screens show the participant on purpose; the test checks the data is kept out of everything else. No marker in any request or page address (page addresses carry numeric IDs only). At seven points during the journey (not only at the end): localStorage holds only the text size, sessionStorage, IndexedDB, Cache Storage and service workers stay empty, no cookie (HttpOnly included, read from the browser's cookie jar) carries a marker, and this fixed-identity fixture sets no cookies at all (the Task O demo's HttpOnly session cookie is checked in `privacyRegression`), and nothing reaches the console. Mutation-checked |
| `e2e/sentReferrals.spec.js` | Task L: Referrals I sent. A referral sent from the New Referral page is found from the home page, marked awaiting response in words, with no contact details in the list; its status page is read-only (no forms or receiving actions) and has nothing about the participant in the URL. After the receiving Program accepts and records the outcome, each step shows on reload and the stage filter moves it to Complete. Not appropriate shows the reason and explanation, no outcome, and no automatic rerouting; the list never shows the explanation. Losing access after a good load (a 401 or 403 on refresh) clears the status page (participant name, steps, what was sent, the receiving link) and every list row, says why, and comes back when access does. Unknown or malformed IDs reveal nothing. axe in both themes; XL at phone width |
| `e2e/screenReader.spec.js` | What a screen reader is given on New Referral (Direct and guided matching) and Program Management: landmarks and headings, control names and groups, required and invalid state, hints and errors as descriptions, toggle state, dialog names and descriptions, focus moves, and every live-region announcement in order |
| `e2e/mvpJourney.spec.js` | Task G: one referral across every feature. A Program Management matching change alters Find a Program's results; Find a Program, then send by keyboard (saved as GPME-assisted); the receiving Program accepts and records the outcome; the Reporting Center's numbers for that Program move by exactly that referral. Reporting Center by keyboard alone with error recovery, visible focus, S to XL kept after reload, no sideways scroll at XL on a phone, axe in both themes. Evidence: [verification-evidence.md](verification-evidence.md) |

The journeys use the in-memory store. PRD 17.2 asks for the same journeys
against Azure SQL; that waits on the Azure SQL store.

## Coverage by area

### Merged on `main`: covered

| Area | Automated | Manual (checklist below) |
| --- | --- | --- |
| Direct Referral E2E (#8, #19; entry screen from #27) | Journeys 1, 4, 5, 6; `e2e/directReferral.spec.js` | Run A in a second browser |
| Receiving lifecycle: queue and response (#10, #11) | Journeys 1, 2, 3, 6 (API); screens (Task A): `e2e/receiving.spec.js` | Run D in a second browser |
| Program maintenance 14A: Program information and lifecycle (#21) | Journey 7: authorized edit, refusals for other roles, stale-version refusal, discontinue / reactivate, effect on new referral choices, preserved referral history, audit evidence (API). Screens (#32): `e2e/programManagement.spec.js` | Keyboard and Narrator checks recorded on #32 |
| Keyboard workflows and focus | `e2e/` (Chromium, scripted keyboard) | Runs A and B in a second browser |
| Labels, required fields, errors | `accessibility.test.js` (every page, including the guided-matching markup); axe in `e2e/`; `e2e/screenReader.spec.js` | VoiceOver + Safari run on New Referral and Program Management: [screen-reader-check.md](screen-reader-check.md); Narrator checks recorded on #32 |
| Text sizing S/M/L/XL | `accessibility.test.js`; `e2e/` (computed sizes, kept work, reload) | Run C step 2 (browser zoom) |
| Contrast (text 4.5:1, controls and focus 3:1) | `accessibility.test.js` both themes; axe in `e2e/` both themes | None |
| GPME E2E: guided matching and GPME-assisted referral (#16, #27) | Journey 8 (API): need categories, match with explained plausible / possible results, send as GPME_ASSISTED with its saved evaluation (what was shown, what was chosen), answers stored nowhere, resend gives one referral, received and accepted like any referral; a Program whose matching facts changed after the search (changed through Program Management) is refused and the worker re-searches; matching down is never "no match", and the same Program goes as a Direct Referral. Browser: `e2e/gpme.spec.js`; one referral across every feature: `e2e/mvpJourney.spec.js` | None |
| Receiving lifecycle: outcome and corrections (#14) | Journey 9 (API): Not Appropriate with an explanation, outcome refused, decision corrected to Accepted, outcome recorded, outcome corrected, across four staff with separate capabilities; refusals by role (403 / 404 / 401) change nothing; stale screens refused with the current state; Not Appropriate blocked while an outcome is recorded; first service time never rewritten; the sender sees the result read-only; full audit history with the prior explanation kept; no participant data in confirmations or errors. Browser: `e2e/receiving.spec.js`, `e2e/receivingLifecycle.spec.js` | Run D in a second browser |
| Program maintenance 14B: configurable fields and values (#22, #24) | Journey 10 (API): create a required choice field and set it, reuse it in a second Program as optional, a Director of one Program sets only its value and cannot change the shared definition, rename keeps identity and values, stale rename refused, a discontinued option stays selected where it was but cannot be newly picked, a meaning change replaces the field for both Programs (old value kept as history, no new values, no reactivation), current Program information shows only the replacement; audit by actor. Browser: `e2e/fieldValues.spec.js`, `e2e/programManagementJourneys.spec.js` | None |
| Program maintenance 14C: create / move Programs, Department lifecycle (#25) | Journey 11 (API): only ORG-scope MANAGE_ORGANIZATION may change the organization; new Department (unique name) and Program, offered for new referrals, no implied management; referrals to it; Department discontinue refused while it has an active Program; move (stale move refused); earlier referrals keep the Department they were made under; discontinue, no create or move into it, stale rename refused, reactivate; audit with before and after; no routing details returned. Browser: `e2e/organization.spec.js`, `e2e/programManagementJourneys.spec.js` | None |
| Two-path referral journey (Task Z): Find a Program and Direct Referral | Journey 12 (API): the same referral sent both ways to the same Program runs the same lifecycle (Not Appropriate, outcome refused, corrected to Accepted, outcome recorded, outcome corrected), the same authorization refusals (another Program 404, view-only / sender / outcome-only / deactivated 403, signed out 401, nothing changed), the same audit trail by the same people and the same read-only sender view; only the source and the saved evaluation differ, and Direct Referral makes no GPME call. Describing and matching create no referral, evaluation or audit record; the employee may choose any shown Program and that choice is saved; a guided send to a Program not shown is refused with nothing saved, and the same Program goes as a Direct Referral; with matching down, guided sends fail as `GPME_UNAVAILABLE` and Direct Referral still works. Mutation-checked against the result check and the source. Browser: `e2e/gpme.spec.js`, `e2e/directReferral.spec.js`, `e2e/mvpJourney.spec.js`, `e2e/receivingLifecycle.spec.js` | None |
| P0 reporting: Total Referrals (#18), Timing Metrics (#26), Referral Activity (#30) | `test/regression/reportingJourney.test.js` over the known-answer world in `reportingFixture.js` (nine referrals built through the real API): every period type, organization / Program / Department scope with Department history, Zero vs No Data vs Pending vs Unknown vs error, partial periods, future and pre-2000 dates (API). On screen (Task M): `e2e/reportingKnownAnswers.spec.js` opens the Reporting Center over the SAME world and checks every period type, Program scope, Department scope with history, the Program and Department tables, Zero / No data / Pending / N/A, the partial-period note, future-date refusal, and no numbers for an inactive or signed-out person. `KNOWN_SCOPES` and `KNOWN_BREAKDOWNS` are shared by both | None |

### Merged on `main`: coverage still to add here

None for the areas this card tracks. New merged workflows get a row here
until they have a journey.

### Not merged yet (dependencies)

| Area | Pull request | Then |
| --- | --- | --- |
| Any journey against Azure SQL (PRD 17.2) | No Azure SQL store yet | Run these journeys against it |

## Fixed in this pass

- **Input and control edges were too faint (WCAG 1.4.11).** Text boxes,
  dropdowns and the text-size buttons used the decorative border color:
  1.57:1 on the card in the light theme and 1.95:1 in the dark theme,
  where 3:1 is needed. They now use `--control-border`: at least 3.3:1 on
  the card, page and focus backgrounds in both themes. Panel borders are
  unchanged.
- **Links used the browser's default blue (WCAG 1.4.3).** On the start
  page in the dark theme, "Make a Direct Referral" was too dark to read on
  the dark card (found by axe). The referral page's skip link had the same
  problem when it appears. Both stylesheets now color links from the theme
  (7:1 or more), and the start-page link has a visible focus outline.
- **Focus did not move to the first missing field on five Program
  Management forms (PRD 14.3; card 52).** Field creation, field reuse,
  field replacement, Program creation and matching facts all looked for
  the first `:invalid` element. The browser also marks the surrounding
  `<fieldset>` as `:invalid`, and a fieldset cannot take focus, so focus
  stayed on the status message. They now look for the first invalid
  `input`, `select` or `textarea`. Four tests in
  `e2e/programManagementJourneys.spec.js` fail without this fix. The
  matching screen got the same one-line change; its existing test passes
  either way.

## Found, not fixed here

- **Two option refusals give a vague reason (card 52).** Adding an option
  that already exists, or discontinuing a field's last active option, is
  correctly refused by the server (`DUPLICATE_OPTION`,
  `LAST_ACTIVE_OPTION`). The screen shows the general "The option changed
  or this action is unavailable ... Reload saved fields" message and
  locks that field until a reload. Departments already name the real
  reason ("That Department name is already in use"). The tests check that
  nothing changes, not the wording, so a clearer message will not break
  them.

- **The start page (`public/index.html`)** sets its text in pixels and
  has no S/M/L/XL control. It is a temporary backend status page with one
  link; PRD 13.5 navigation will replace it. Whoever builds that
  navigation should give it the text-size control.
- **`npm run test:e2e` runs Chromium only.** Edge, Firefox and WebKit run
  with `npm run test:e2e:browsers` (results and limits in
  [browser-verification.md](browser-verification.md)). Real Safari and a
  screen reader are covered by the short manual pass below and by
  [screen-reader-check.md](screen-reader-check.md).

## Manual keyboard checklist (PRD 14.2, 14.3, 17.7)

`e2e/` runs these steps automatically in Chromium. Before a release, do
them once by hand on `npm run dev:synthetic` (synthetic data only) in
**Safari or Edge**, **without touching the mouse**, and listen to steps
A3, A4 and A7 once with a screen reader (VoiceOver: Cmd+F5). Record the
date, browser, tester and any failure in the pull request.

### Run A: Direct Referral

1. Load `/referral/`. Press Tab once: "Skip to main content" appears; Enter
   moves focus into the page.
2. Tab through the text-size buttons. Each focused control shows a light
   gray background and a dark outline.
3. Choose an affiliation with the arrow keys in the dropdown; Tab to "Save
   affiliation"; Enter. The status message is read out.
4. Press "Save affiliation" with nothing chosen: the error appears in text
   with a ⚠ icon, and focus moves to the dropdown.
5. In the Program list, move with the arrow keys; Tab to "Continue".
   Enter in the search box does not continue.
6. On the referral form, press Enter in the name field: nothing is sent.
   In "What do they need?" Enter makes a new line.
7. Press "Send referral" with fields empty: "Some information needs
   attention. Nothing was sent.", and focus goes to the first invalid field
   in screen order.
8. Fill everything and send. "Sending referral ..." shows on a disabled
   button, then "Referral received !" with the Referral ID.
9. Shift+Tab walks back through the page in reverse order with no traps.
10. Type in a field, press Cmd+Z (Mac) or Ctrl+Z (Windows): the typing is
    undone. After sending, undo never brings back or resends anything.

### Run B: guided matching (merged in #27; automation pending, see above)

1. Choose "Help me find a Program" with Enter; focus moves to "Guided
   matching".
2. Tick needs with Space; type an age range; Enter in an age field does
   not search.
3. "Find Programs" with no need: error in text, focus on the first need.
4. Results: focus moves to "Programs that may fit"; each "Choose ..."
   button is reachable by Tab.
5. "Use Direct Referral" and "Try again" are reachable and work by
   keyboard.

### Run C: text size and themes

1. At S, M, L and XL: labels, typed text, dropdown choices, errors, status
   messages and buttons all change size. Text already typed stays.
2. Reload: the chosen size is kept. Browser zoom to 200% still works with
   no sideways scrolling at a phone-sized window.
3. Repeat steps 1 and 2 with the computer in dark mode.

### Run D: receiving a referral (Task A)

On `npm run dev:synthetic`, make a Direct Referral to Housing Help Desk
(sample), then open Received referrals.

1. Open the referral from the list with Enter. Response, Decision and
   Service outcome show as three separate steps.
2. Choose Accept with Space; Tab to "Send response"; Enter; confirm. The
   outcome still reads "Not recorded", with the note that accepted is not
   served.
3. Record an outcome, then correct it. Each result is read out from the
   status box.
4. On another referral, choose Not appropriate and send with no reason:
   the error is text with an icon, and focus moves to Reason.
5. Open the same referral in two tabs. Change the outcome in one, then
   save in the other: "Review before you continue" appears with what is
   saved now, the save buttons are locked, and "Load the latest
   information" unlocks them.
