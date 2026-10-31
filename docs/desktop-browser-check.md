# Task 203: Manual desktop-browser verification

Status: Manual observations, follow-ups and automated validation recorded;
final documentation/evidence review and merge remain pending.
Finding F1 remains open. Synthetic data only. No application code changes.
Task 203 is not complete.

## Environment

- Tester: Christina
- Tested commit: 2746c83d40d1b8c0ef5a21cd0adf618b0a2e4a0d
- Windows: Windows 11 Home, version 10.0.26300, build 26300
- Browser: Microsoft Edge 156.0.4314.58, 64-bit
- Node: 24.15.0
- Server: npm run dev:demo and npm run dev:synthetic,
  both with NODE_ENV=development; results below identify the mode
- Address: http://127.0.0.1:3000/
- Test sessions: October 30–31, 2026
- Display resolution: 2880 x 1800, landscape
- Windows display scaling: 200%
- Browser viewport: not yet measured

## Scope

The project lead restricts intended production use to authorized office
desktop/laptop use. Remote access and mobile-device use are prohibited.
This local synthetic check does not verify production access enforcement.
Narrow-width and zoom checks address desktop accessibility reflow.

The office-only restriction is a project-lead decision, not independently
confirmed QCH policy. QCH IT must implement and verify production access
enforcement separately. Narrow-width checks do not establish mobile-device
support or replace actual browser-zoom checks.

## Initial demo-mode results

| Check | App text / browser zoom | Result | Evidence |
| --- | --- | --- | --- |
| Guided interpretation and worker correction | M / 100% | Pass | Housing and Employment proposed; worker replaced Employment with Childcare. Matching waited for Find Programs and excluded Employment Programs |
| Guided referral submission | M / 100% | Pass | Referral 1 received by Housing Help Desk |
| Receiving response and outcome | Baseline; exact settings not independently captured | Pass for workflow | Housing staff accepted referral 1 and recorded Resulted in service |
| Sender sees updated outcome | Baseline | Pass | Referral 1 shows Complete, Responded, Accepted, Resulted in service |
| Referrals I sent | XL / 100% | Pass | No issues reported |
| Referrals I sent | XL / 200% | Pass | No clipping, overlap, hidden focus or sideways page scrolling reported |
| Referrals I sent | XL / 400% | Fail | Demo banner overlaps content; screenshots supplied |
| Direct Referral submission | M / 100% | Pass | Housing selected directly; referral 2 received |
| Direct Referral selection | XL / 100%, 200%, 400% | Pass | Worker reported selection controls remained usable |
| Program Management | XL / baseline zoom | Limited | Referring Worker has no assigned management Programs; authorized management workflow not tested |
| Reporting totals | M / 100% | Pass | Total 2; awaiting response 1; accepted 1; resulted in service 1 |
| Reporting layout | XL / 100% | Pass | No issues reported |
| Reporting layout | XL / 200% | Pass | All columns accessible through table scrollbar; controls usable |
| Reporting layout | XL / 400% | Fail | Demo banner obscures controls/content; screenshot supplied |

## Finding F1: Demo banner obscures content at high zoom

- Observed on: Referrals I sent and Reporting Center.
- Settings: XL application text and 400% Edge browser zoom.
- Steps: sign in as Referring Worker, open either page, select XL,
  set browser zoom to 400%, then scroll through the page.
- Expected: content and focused controls can be brought fully into view.
- Actual: demo identity banner remains over page content while scrolling.
- Requirement topic: Frozen Handoff PRD section 33; Handoff MVP section 27.
- Screenshots: linked in the October 31 reproduction evidence section below.
- Cause: not established.
- Fix: not attempted in this verification task.

## Remaining work

- Measure the viewport for any further reproduction, recording browser
  version and zoom. Earlier viewport dimensions remain unknown.
- Inspect saved screenshots for personal browser chrome and verify links
  before publication.
- Link this report from docs/README.md and prepare a defect issue draft
  for F1.
- Review the final documentation/evidence changes before staging,
  committing, pushing or publishing.
- Complete report review and merge before marking Task 203 complete.

Completed follow-ups below cover the common Program information form,
guided form/results, receiving response form and outcome-correction form.
Other management subpages and exhaustive workflow coverage remain untested.
Developer-mode passes do not close the demo-mode finding F1.

This report does not establish full WCAG conformance, HIPAA compliance,
production readiness or enforcement of office-only access.
## Program Management follow-up

Mode: npm run dev:synthetic, fixed synthetic developer identity.
The server restart reset the earlier in-memory referrals.

- M / 100%: opened Adult Evening Classes, edited Description, saved,
  reloaded and confirmed the value persisted.
- XL / 100%: no clipping, overlap, sideways page scrolling or hidden focus reported.
- XL / 200%: controls remained usable; no issues reported.
- XL / 400%: controls remained reachable and visible; no issues reported.

These checks cover the common Program information form. Other management
screens and production authorization were not verified by this pass.

## Guided and receiving follow-up — October 31, 2026

Mode: synthetic developer server, standalone Microsoft Edge.
Tested commit remains 2746c83d40d1b8c0ef5a21cd0adf618b0a2e4a0d.

| Check | Settings | Result |
| --- | --- | --- |
| Guided form and results | XL / 100%, 200%, 400% | Pass: readable, keyboard-reachable, no clipping, overlap, hidden focus or sideways page scrolling reported |
| Receiving response form | XL / 100%, 200%, 400% | Pass: readable, keyboard-reachable, no clipping, overlap, hidden focus or sideways page scrolling reported |
| Outcome-correction form | M / 100%; XL / 100%, 200%, 400% | Pass: controls and save button remained usable; no correction saved |

A new synthetic referral, Task 203 Receiving Check, was created as referral 1
after the server reset. Its response was Accepted and its outcome was saved
as Resulted in service. Exact sizing settings during the initial outcome
save were not independently confirmed; the correction form was checked
separately afterward.

These passes were in developer mode without the demo identity banner.
They do not close finding F1, observed in demo mode on Referrals I sent
and Reporting Center at XL / 400% zoom.

## Screenshot evidence — reproduction on October 31, 2026

The following screenshots reproduce finding F1 in demo mode at XL
application text size and 400% Edge browser zoom. They are new captures,
separate from the original observations.

- [Referrals I sent: banner overlap](evidence/task203/sent-xl-400-banner-overlap.png)
- [Reporting Center: banner overlap](evidence/task203/reporting-xl-400-banner-overlap.png)

The banner obscured content on both pages. No application fix was made.

Both selected images were visually reviewed: banner overlap is visible,
and no personal browser details or participant data were observed.
The page identities and 400% zoom are supported by recorded observations,
not independently visible in the captures. The other five screenshots
have not been reviewed for publication and are not selected for this PR.

## Automated validation

Run locally from the Task 203 worktree on Windows, with baseline commit
2746c83d40d1b8c0ef5a21cd0adf618b0a2e4a0d and the Task 203
documentation/evidence changes present:

- node --version: v24.15.0.
- npm run check-runtime: passed.
- npm test: 1,721 tests across 241 suites; all passed.
  Zero failures, cancellations, skips or todos. Duration: about 12.3 seconds.

This run did not include the separate Playwright browser suite.
Automated results do not close finding F1.
