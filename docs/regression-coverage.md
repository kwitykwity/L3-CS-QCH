# Regression coverage: accessibility and end-to-end (Card 17)

What the regression pass covers, where each part is tested, and what still
waits on other work. Final Technical PRD 14 (accessibility and
interaction), 17.2 (critical end-to-end tests), 17.3 (authorization) and
17.7 (accessibility interaction tests).

**Status: first slice.** It covers Direct Referral, the receiving queue
and response, and Program maintenance slice 14A, on `main` as of
October 20, 2026. Each area marked *waiting* gets its journey when the
pull request named in it merges. The same rule as the security suite
applies: a merged workflow is not done until it has a journey here.

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
| `e2e/directReferral.spec.js` | In Chromium: Direct Referral completed by keyboard only, visible focus on every stop, Shift+Tab order, Enter safety, undo/redo, S/M/L/XL, phone width at XL, and an axe WCAG 2.2 AA scan of every page state in light and dark themes |

The journeys use the in-memory store. PRD 17.2 asks for the same journeys
against Azure SQL; that waits on the Azure SQL store.

## Coverage by area

| Card 17 area | Automated | Manual (checklist below) | Status |
| --- | --- | --- | --- |
| Direct Referral E2E | Journeys 1, 4, 5, 6; `e2e/directReferral.spec.js` | Run A in a second browser | Covered |
| Receiving lifecycle: queue and response | Journeys 1, 2, 3, 6 | No screen yet | Covered at API level |
| Receiving lifecycle: outcome and corrections | Not yet | No screen yet | *Waiting:* #14 |
| GPME E2E | Not yet | Run B | *Waiting:* #16, then #27 (add `e2e/gpme.spec.js` then) |
| Program maintenance 14A: Program information and lifecycle (#21, merged) | Journey 7: authorized edit, refusals for other roles, stale-version refusal, discontinue / reactivate, effect on new referral choices, preserved referral history, audit evidence | No screen yet | Covered at API level |
| Program maintenance 14B: configurable fields and values (#22, #24, merged) | Not yet | No screen yet | *Pending:* next slice of this card |
| Program maintenance 14C: create / move Programs, Department lifecycle (#25, merged) | Not yet | No screen yet | *Pending:* next slice of this card |
| P0 reporting | Not yet | No screen yet | *Waiting:* #18, #26 |
| Keyboard workflows and focus | `e2e/` (Chromium, scripted keyboard) | Runs A and B in a second browser | Covered in Chromium |
| Labels, required fields, errors | `accessibility.test.js`; axe in `e2e/` | Screen reader spot check | Covered |
| Text sizing S/M/L/XL | `accessibility.test.js`; `e2e/` (computed sizes, kept work, reload) | Run C step 2 (browser zoom) | Covered |
| Contrast (text 4.5:1, controls and focus 3:1) | `accessibility.test.js` both themes; axe in `e2e/` both themes | None | Covered |

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

## Found, not fixed here

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

### Run B: guided matching (after #27 merges)

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
