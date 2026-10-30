# Handoff questions for QCH and QCH IT

**Status: open questions, as of `main` at `a322407` (October 30, 2026).**
Trello Task SS. Documentation only.

This page lists only **questions that QCH or QCH IT still has to decide**.
Known limitations and verification that is still outstanding are a separate
list: [known-limitations.md](known-limitations.md).

**Nothing on this page is a new requirement.** Each question points to the
Frozen Handoff PRD (October 28, 2026) or the Handoff MVP section it comes
from. Until a question is answered, the application keeps its current,
documented behavior, and that behavior is not presented as QCH policy. An
answer becomes a requirement only if QCH or the project lead records it.

Who decides: **QCH** (policy and business decisions) or **QCH IT**
(environment, accounts, configuration). "With the team" means the team can
help carry out the answer.

## A. Product questions for QCH

| # | Question | Why it is open (frozen text) | Evidence in the repository | Who decides |
| --- | --- | --- | --- | --- |
| Q1 | Are the extra permission-administration rules in PR #63 acceptable to QCH: organization-scope administrators only, new grants only for active staff, and the administrator capability not granted or removed on the screen? If the last stays, how is a new administrator added without QCH IT? | PRD §24 and MVP §23 list what permission changes must do, and say restrictions beyond that must not be treated as QCH policy unless QCH approves them. PRD §23 requires an administrative capability for permission management without saying how the first administrator is made | Merged PR #63 (Task Y), README "open questions" Q1 to Q3; the same question is U-4 in merged PR #71 | QCH |
| Q2 | Does representing shared-listing locations through configurable Program fields meet the intended UX, or are dedicated location-management screens expected? | PRD §13 and MVP §14 require support for separate listings and a shared listing. The expected location-management experience needs reconciliation with the Current Handoff Wireframes | Merged PR #78; `test/regression/multiLocation.test.js` tests a multi-select Locations field and updated locations returned through /api/gpme/match. Dedicated location-management screens are not verified by that test | QCH, with the wireframe owner |
| Q3 | Is Program information shown under each Find a Program result enough, or is a separate Program Details page expected? | PRD §8 and MVP §10 require sufficient current Program information to evaluate a referral and list what it may include. They do not require a separate page | `e2e/findProgramInformation.spec.js` (Task X, merged); U-5 in merged PR #71 | QCH, with the wireframe owner |
| Q4 | Should a Program's primary contact appear in Find a Program as its own item? Today it appears only if a manager adds it as a Program information field | PRD §14: Program information **may** display a primary contact, and employees are directed to it only if they cannot find what they need in QCH Connect | `public/referral/guided.js` (the "Send referrals through QCH Connect…" note); `test/findProgramInformation.test.js` | QCH |
| Q5 | Should a correction to a decision or outcome require its own reason? Today a reason and explanation go with a Not Appropriate decision only; every correction keeps the previous value, who and when | PRD §17 (a reason and explanation "when required") and §19 (corrections preserve history; audit shows what, who, when). Neither requires a reason on every correction | `test/regression/correctionHistory.test.js` (Task OO) | QCH |
| Q6 | Which reporting time zone should period boundaries use? The application uses America/New_York | PRD §25 requires month, quarter and year periods "where supported by the reporting design" and does not name a time zone | `src/reporting/periods.js` (`REPORTING_TIME_ZONE`) | QCH |
| Q7 | Are the wireframe screens that no PRD or MVP section requires expected for the MVP (for example a dashboard, a separate review step, a correction-history screen, a help panel)? | The Current Handoff Wireframes are the UX reference; the PRD governs where they differ, and these screens have no matching requirement | U-6 in merged PR #71 | QCH, with the wireframe owner |

## B. Production decisions for QCH and QCH IT

The production architecture itself is confirmed (PRD §27 to §30; MVP §28).
These are the decisions that remain.

| # | Question | Why it is open (frozen text) | Evidence in the repository | Who decides |
| --- | --- | --- | --- | --- |
| Q8 | How is each receiving Program's notification address held and maintained: seed data, a setting in QCH Connect, a SharePoint List column, or only the shared mailbox? | PRD §21 and MVP §21 require notification after the referral is saved and traceable failure and retry, and name the shared mailbox for sending. They do not say where the receiving address comes from | No screen sets it; a Program created in the application has no recipient, so its notification fails as `NO_RECIPIENT` while the referral stands (`test/regression/notificationFailure.test.js`); U-1 in merged PR #71 | QCH and QCH IT; the team for scope |
| Q9 | Who builds and runs the archival process: QCH IT as a production process, or the team as application code? | PRD §31 and MVP §30 describe the planned process and its rules; MVP §28 lists it among production requirements; it is not an MVP §32 acceptance gate | No archive logic in `src/` or any open PR; U-2 in merged PR #71 | QCH IT, with the team |
| Q10 | What is the formal retention and deletion policy after archival? | PRD §31 (archived records stay read-only until QCH sets one); PRD §37 item 9; MVP §31 item 10 | Nothing in the application deletes a referral | QCH |
| Q11 | What is the authoritative production Department taxonomy? | PRD §11 (the four demo Departments are seed values, not a production taxonomy); PRD §37 item 8; MVP §31 item 9 | `scripts/syntheticSeed.js` | QCH |
| Q12 | How is the production Program Directory configured, and by whom? | PRD §37 item 7; MVP §31 item 8. The internal Program Directory must never be committed to a public repository (PRD §8, §35) | The repository holds synthetic Programs only | QCH, with QCH IT |
| Q13 | Which browsers and versions must production support? | PRD §37 item 10; MVP §31 item 11 | The team tests Edge, Chromium, Firefox and Playwright WebKit as its own baseline, not QCH policy (`docs/browser-verification.md`) | QCH IT |
| Q14 | Where is the frontend hosted in production? | PRD §32 (the frontend is presentation only); PRD §37 item 11; MVP §31 item 12 | — | QCH IT |
| Q15 | Who are the first production users, groups and permission administrators, and how are they set up? | PRD §24; PRD §37 item 6; MVP §31 item 7 | Synthetic users and grants only (`scripts/syntheticSeed.js`, `scripts/demoPersonas.js`) | QCH and QCH IT |

The provisioning steps that follow from these decisions (Azure Functions,
SharePoint site and Lists, Entra ID, Graph permissions, Exchange RBAC, the
shared mailbox) are listed as outstanding work in
[known-limitations.md](known-limitations.md), section A, because they are
not open questions: the frozen PRD already decides them.

## Not questions

These are settled by the frozen documents and are not asked again here:
the production architecture (PRD §27 to §30), the archival rules themselves
(PRD §31), Entra ID with MFA (PRD §22), the shared-mailbox design (PRD §21),
age as a temporary matching input that is never saved (PRD §5.4), and no
external AI in the MVP (PRD §7).
