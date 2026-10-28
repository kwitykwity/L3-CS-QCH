# Additional-browser verification

**Status: draft.** Critical journeys run beyond Chromium, with results
recorded. The browser list below is the **team's test baseline, not a QCH
policy**: the Final Technical PRD (section 22) leaves the supported
browser/version matrix as an open implementation dependency for Bassit
Saidi / QCH IT, and says the team must not invent a client policy. Nothing
here claims QCH has agreed it.

## Browser matrix (team baseline, pending QCH IT)

| Browser | How it is run | Version tested | Why it is in the baseline |
| --- | --- | --- | --- |
| Microsoft Edge | The Edge installed on the machine (Playwright `msedge` channel) | 143.0.3650.96 | QCH runs on Microsoft 365 and Entra ID, so Edge is the most likely staff browser (assumption, not confirmed) |
| Chromium | Playwright's Chromium (stands in for Chrome) | 153.0.8010.12 | The browser the suite was first written against |
| Firefox | Playwright's Firefox | 155.0 | Second engine family |
| Safari | Playwright's WebKit build (stands in for Safari) | 26.6 | Third engine family; Safari is the strictest on focus and tabbing |

Not tested: real Safari on macOS or iOS, Chrome itself, mobile browsers,
older versions. Playwright's WebKit follows Safari's defaults (for example,
Tab skips plain links) but it is not Safari. **Ask QCH IT** which browsers
and versions staff use; if they differ, change this list.

## How to run

```bash
npx playwright install chromium firefox webkit   # once per machine (Edge is used from the machine)
npm run test:e2e:browsers                        # all four, one after another (about 25 minutes)
npm run test:e2e:browsers -- firefox webkit      # just those two
npm run test:e2e                                 # Chromium only, as before
```

Each browser runs against its own fresh synthetic server, because the
specs assume the starting data (the runner is `e2e/runBrowsers.js`, the
choice is `E2E_BROWSER` in `playwright.config.js`). Synthetic data only.

## Results

Build: `main` at `9fd179b` plus this branch. Node 24.15.0. Date: October
27, 2026. The suite is every spec in `e2e/` (the critical journeys: Direct
Referral, Find a Program, receiving lifecycle and outcome, Program
Management, Reporting, keyboard, focus, text size, screen-reader
structure, axe WCAG 2.2 AA scans in light and dark).

| Browser | First run (before fixes) | Final run (with fixes) |
| --- | --- | --- |
| Edge | 160 passed, 1 skipped | 160 passed, 1 skipped |
| Chromium | 160 passed, 1 skipped | 160 passed, 1 skipped |
| Firefox | **10 failed**, 150 passed, 1 skipped | 160 passed, 1 skipped |
| WebKit (Safari) | **14 failed**, 146 passed, 1 skipped | 160 passed, 1 skipped |

The one skip is the known `test.fixme` in `e2e/gpme.spec.js` (XL entry
screen at phone width), unchanged. `npm test` (Node): 1,443 passed, 0
failed.

## What the other browsers found, and what changed

Each failure was identified before anything was changed.

| Finding | Seen in | Cause | Change |
| --- | --- | --- | --- |
| Axe "target-size" on the text-size buttons (9 tests) | Firefox | Six Program Management pages (`fields`, `matching`, `organization`, `organization-programs`, `replace-field`, `reuse-field`) were missing `class="text-size__btn"`, so the buttons used each browser's default button style. Chromium's default happens to pass; Firefox's is too small | Added the class, so they match every other page |
| Axe "color-contrast" on the XL button, dark theme (9 tests) | WebKit | Same cause: default button colors in dark mode | Same change |
| Skip link not reachable by Tab (4 tests) | WebKit | Safari's default setting skips plain links when Tabbing. The skip link exists only for keyboard users | Added `tabindex="0"` to the skip link on all 13 pages. A link with `tabindex` is still a Tab stop. Harmless in other browsers |
| Focus not returned to the opening button after Escape on the two confirm dialogs (2 tests) | WebKit | Safari does not focus a button when it is clicked, so the browser has nothing to restore focus to | The dialogs now return focus themselves on Escape (New Referral discard dialog and Program Management confirm dialog). The "Keep editing" buttons already did |
| Shift+Tab order test failed (1 test) | Firefox | A test problem, not an app problem: it assumed where focus lands after a Tab off the end of the page, which differs by browser | The test now starts the walk back on the last control |

The change to the tab-order test only removes the browser-specific
assumption; it still checks that Shift+Tab visits every stop in exact
reverse order.

## Still to do

- **QCH IT confirms the browser list and versions** (PRD 22). Until then
  this matrix is the team's baseline only.
- **A manual pass in real Safari with VoiceOver** (and Edge) before
  release, using the checklist in
  [regression-coverage.md](regression-coverage.md) and
  [screen-reader-check.md](screen-reader-check.md). The automated WebKit
  run is a stand-in, not a replacement.
- **Other links in default Safari.** With Safari's default setting, Tab
  skips *all* plain links (the brand link, navigation links), not only the
  skip link. Safari users reach them with Option+Tab or by turning on
  "Press Tab to highlight each item". This was not changed: it is Safari's
  own behavior and a broader decision. Worth raising if QCH staff use
  Safari.
- Re-run `npm run test:e2e:browsers` after any change to a page, and
  again when QCH IT names its browsers.
