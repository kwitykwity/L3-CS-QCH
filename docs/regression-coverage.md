# Regression coverage: accessibility and end-to-end (Card 17)

What the regression pass covers, where each part is tested, and what still
waits on other work. Final Technical PRD 14 (accessibility and
interaction), 17.2 (critical end-to-end tests), 17.3 (authorization) and
17.7 (accessibility interaction tests).

**Status: first slice.** It covers everything merged on `main` as of
October 20, 2026. Each area marked *waiting* gets its journey when the
pull request named in it merges. The same rule as the security suite
applies: a merged workflow is not done until it has a journey here.

## How to run

```bash
npm test                          # everything, including the regression suite
node --test test/regression/      # just the regression suite
```

| File | What it checks |
| --- | --- |
| `test/regression/journeys.test.js` | Whole workflows through the integrated app over HTTP, switching between staff members |
| `test/regression/accessibility.test.js` | Every page in `public/`: language, title, headings, labels, ids, required fields, status announcements, text size, and color contrast in both themes |

The journeys use the in-memory store. PRD 17.2 asks for the same journeys
against Azure SQL; that waits on the Azure SQL store.

## Coverage by area

| Card 17 area | Automated | Manual (checklist below) | Status |
| --- | --- | --- | --- |
| Direct Referral E2E | Journeys 1, 4, 5, 6 | Keyboard run A | Covered |
| Receiving lifecycle: queue and response | Journeys 1, 2, 3, 6 | No screen yet | Covered at API level |
| Receiving lifecycle: outcome and corrections | Not yet | No screen yet | *Waiting:* #14 |
| GPME E2E | Not yet | Keyboard run B | *Waiting:* #16, then #27 |
| Program maintenance | Not yet | No screen yet | *Waiting:* #21, #22, #24, #25 |
| P0 reporting | Not yet | No screen yet | *Waiting:* #18, #26 |
| Keyboard workflows and focus | Structure only (tab order, button types, skip link) | Runs A and B | Manual required (PRD 17.7) |
| Labels, required fields, errors | `accessibility.test.js` | Runs A and B | Covered |
| Text sizing S/M/L/XL | `accessibility.test.js` (sizes, rem) | Run C | Covered |
| Contrast (text 4.5:1, controls and focus 3:1) | `accessibility.test.js`, both themes | Run C | Covered |

## Fixed in this pass

- **Input and control edges were too faint (WCAG 1.4.11).** Text boxes,
  dropdowns and the text-size buttons used the decorative border color:
  1.57:1 on the card in the light theme and 1.95:1 in the dark theme,
  where 3:1 is needed. They now use `--control-border`: at least 3.3:1 on
  the card, page and focus backgrounds in both themes. Panel borders are
  unchanged.

## Found, not fixed here

- **The start page (`public/index.html`)** sets its text in pixels and
  has no S/M/L/XL control. It is a temporary backend status page with one
  link; PRD 13.5 navigation will replace it. Whoever builds that
  navigation should give it the text-size control.
- **Automated accessibility scanning (axe) and browser-driven keyboard
  tests (Playwright)** are not in the repository yet. Adding them is a
  dependency decision for the team (`docs/dependencies.md`). Until then the
  keyboard runs below are done by hand.

## Manual keyboard checklist (PRD 14.2, 14.3, 17.7)

Run on `npm run dev:synthetic` (synthetic data only) in Chrome and Safari
or Edge, **without touching the mouse**. Record the date, browser, tester
and any failure in the pull request.

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
