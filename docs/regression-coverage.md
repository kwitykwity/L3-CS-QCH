# Regression coverage: accessibility and end-to-end (Card 17)

What the regression pass covers, where each part is tested, and what still
waits on other work. Final Technical PRD 14 (accessibility and
interaction), 17.2 (critical end-to-end tests), 17.3 (authorization) and
17.7 (accessibility interaction tests).

**Status: first slice, against `main` at `bdfeab3` (October 21, 2026).**
Covered: Direct Referral, the receiving queue and response, and Program
maintenance slice 14A. The tables below separate workflows that are
**merged but not yet covered here** from **dependencies that are not
merged yet**. The same rule as the security suite applies: a merged
workflow is not done until it has a journey here.

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
| `test/regression/journeys.test.js` | Whole workflows through the integrated app over HTTP, switching between staff members |
| `test/regression/accessibility.test.js` | Every page in `public/`: language, title, headings, labels, ids, required fields, status announcements, text size, link colors, and color contrast in both themes |
| `e2e/directReferral.spec.js` | In Chromium: the New Referral entry screen (no path preselected; Direct Referral chosen by keyboard), Direct Referral completed by keyboard only, visible focus on every stop, Shift+Tab order, Enter safety, undo/redo, S/M/L/XL, phone width at XL, and an axe WCAG 2.2 AA scan of the entry screen and every Direct Referral state in light and dark themes |
| `e2e/programManagement.spec.js`, `e2e/fieldValues.spec.js`, `e2e/organization.spec.js`, `e2e/matchingManagement.spec.js` | Card 14 (#32): each Program Management screen's main path in Chromium, with stale-page and lost-connection recovery and axe in both themes |
| `e2e/programManagementJourneys.spec.js` | Card 52: the Program Management journeys the card 14 specs leave out, one block per area (fields, options, reuse, replacement, retirement, Departments, Program creation, Program moves): missing and duplicate input with focus on the problem, cancelled confirmations, stale pages, lost connections, what may be reused, replaced or retired, discontinued Departments as targets, referral history across a move, keyboard-only creation, XL at phone width on every screen, axe on error states |
| `e2e/receiving.spec.js` | Task A: the receiving screens (received list, referral detail). The list shows only Programs I receive for, with Response, Decision and Service outcome kept separate, and stage filters. Accept, record and correct an outcome by keyboard (Accepted never reads as served). Not appropriate needs a reason, has no outcome, and becomes outcome-ready only after a correction to Accepted. A recorded outcome blocks a change to Not appropriate. Stale page, someone responding first, a lost connection, and Cancel: nothing is merged or sent twice. A referral I only sent is read-only, and the server refuses a direct request. An unknown ID reveals nothing. axe in both themes; XL at phone width |
| `e2e/receivingLifecycle.spec.js` | Card 51: the receiving lifecycle across several synthetic staff, each in their own browser, on a private copy of the app. Send through the New Referral page, accept, record, correct, and the sender sees the result read-only; reject with a reason, then correct to Accepted and record. Each step audited once as the person who did it. Unauthorized: staff of another Program get "not available" and 404s; view-only and respond-only staff see only their actions and get 403s; a permission revoked while the page is open is refused; identity fields in a body or URL are refused (400), no identity is 401. Two receivers at once: responded first, two outcome corrections, two decision corrections, each refused with what is saved now, nothing merged, and a deliberate retry after review succeeds. Mutation-checked against the server permission checks |

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
| Labels, required fields, errors | `accessibility.test.js` (every page, including the guided-matching markup); axe in `e2e/` | Screen reader spot check |
| Text sizing S/M/L/XL | `accessibility.test.js`; `e2e/` (computed sizes, kept work, reload) | Run C step 2 (browser zoom) |
| Contrast (text 4.5:1, controls and focus 3:1) | `accessibility.test.js` both themes; axe in `e2e/` both themes | None |

### Merged on `main`: coverage still to add here (next slice of this card)

| Area | Merged in | What this suite still needs | Covered elsewhere today |
| --- | --- | --- | --- |
| GPME E2E: guided matching and GPME-assisted referral | #16, #27 | An HTTP journey (match, choose, GPME_ASSISTED referral, evaluation saved) and `e2e/gpme.spec.js` (Run B automated, axe on results / no match / failure) | `test/gpme*.test.js` per card; the card 11 browser check in #27 |
| Receiving lifecycle: outcome and corrections | #14 | An HTTP journey through record outcome, correct outcome, correct response, stale version, audit; multi-user browser journeys: `e2e/receivingLifecycle.spec.js` (card 51) | `test/serviceOutcome.test.js` per card; screens (Task A): `e2e/receiving.spec.js` |
| Program maintenance 14B: configurable fields and values | #22, #24 | An HTTP journey | `test/programFields*.test.js` per card; in the browser (#32, card 52): `e2e/fieldValues.spec.js`, `e2e/programManagementJourneys.spec.js` (fields, options, reuse, replacement, retirement) |
| Program maintenance 14C: create / move Programs, Department lifecycle | #25 | An HTTP journey | `test/programOrganization.test.js` per card; in the browser (#32, card 52): `e2e/organization.spec.js`, `e2e/programManagementJourneys.spec.js` (Departments, creation, moves, referral history after a move) |
| P0 reporting: Total Referrals | #18 | A journey that reports on referrals created by the other journeys | `test/totalReferrals.test.js` known answers |

### Not merged yet (dependencies)

| Area | Pull request | Then |
| --- | --- | --- |
| P0 reporting: Time to First Response, Time to Recorded Service | #26 | Add to the reporting journey |
| P0 reporting: referral activity report (breadth) | #30 (replaces #29) | Add to the reporting journey |
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
- **The browser tests run in Chromium only.** Safari and Edge, and a
  screen reader, are covered by the short manual pass below.

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
