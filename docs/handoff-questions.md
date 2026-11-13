# Handoff questions for QCH and QCH IT

**Status: open questions, as of `main` at `24966d5a0d53f7d247428e0dfd9f78f03cc9b288` (November 2, 2026).**
Trello Task 231 (refresh of Task SS). Documentation only.

This page lists **questions that QCH or QCH IT still has to decide**,
with recorded release decisions retained alongside them for context.
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

## Release scope decision — November 2, 2026

Christina Ruiz recorded on [Task 231](https://trello.com/c/qtvz1HNQ)
that Page 10 (Review & Submit) and Page 18 (dedicated Multi-Location
Program Management) are deferred for this release. This is a release scope
decision, not a new QCH policy or evidence of final release readiness.
The approved Handoff PRD governs, followed by the Handoff MVP and the
Approved Current Handoff Written Wireframes. The historical R1–R25
register and October 14 Technical PRD are not current authority.
Final candidate verification and Task V remain outstanding.

Christina Ruiz also deferred the dashboard and dedicated correction-history screen for this release. Existing navigation and referral entry paths remain available. The application continues to preserve correction history, but a dedicated screen for viewing it was not delivered. These deferrals do not establish final release readiness; verification and Task V remain outstanding.

## A. Product questions for QCH

| # | Question | Why it is open (frozen text) | Evidence in the repository | Who decides |
| --- | --- | --- | --- | --- |
| Q1 | Are the extra permission-administration rules in PR #63 acceptable to QCH: organization-scope administrators only, new grants only for active staff, and the administrator capability not granted or removed on the screen? If the last stays, how is a new administrator added without QCH IT? | PRD §24 and MVP §23 list what permission changes must do, and say restrictions beyond that must not be treated as QCH policy unless QCH approves them. PRD §23 requires an administrative capability for permission management without saying how the first administrator is made | Merged PR #63 (Task Y), README "open questions" Q1 to Q3; the same question is U-4 in merged PR #71 | QCH |
| Q2 | Page 18 is deferred for this release by Christina’s recorded scope decision. Any future dedicated location-management screen requires a separately agreed scope; no future delivery date is committed here | PRD §13 and MVP §14 capability remains delivered through current Program information; deferring the dedicated screen does not remove that capability | Release scope decision above; merged PR #78; `test/regression/multiLocation.test.js`; known limitations C5 | Release decision recorded by Christina; future UX scope for QCH and the wireframe owner |
| Q3 | Is Program information shown under each Find a Program result enough, or is a separate Program Details page expected? | PRD §8 and MVP §10 require sufficient current Program information to evaluate a referral and list what it may include. They do not require a separate page | `e2e/findProgramInformation.spec.js` (Task X, merged); U-5 in merged PR #71 | QCH, with the wireframe owner |
| Q4 | Should a Program's primary contact appear in Find a Program as its own item? Today it appears only if a manager adds it as a Program information field | PRD §14: Program information **may** display a primary contact, and employees are directed to it only if they cannot find what they need in QCH Connect | `public/referral/guided.js` (the "Send referrals through QCH Connect…" note); `test/findProgramInformation.test.js` | QCH |
| Q5 | Should a correction to a decision or outcome require its own reason? Today a reason and explanation go with a Not Appropriate decision only; every correction keeps the previous value, who and when | PRD §17 (a reason and explanation "when required") and §19 (corrections preserve history; audit shows what, who, when). Neither requires a reason on every correction | `test/regression/correctionHistory.test.js` (Task OO) | QCH |
| Q6 | Which reporting time zone should period boundaries use? The application uses America/New_York | PRD §25 requires month, quarter and year periods "where supported by the reporting design" and does not name a time zone | `src/reporting/periods.js` (`REPORTING_TIME_ZONE`) | QCH |
| Q7 | Dashboard, dedicated correction-history screen and Page 10 Review & Submit are deferred for this release. Future scope remains undecided. Help & Guidance and Referral Confirmation are delivered. | Recorded release scope decisions; existing workflows and correction-history recording remain available. | Task 231 scope decision; merged PRs #106 and #107; public/index.html; test/regression/correctionHistory.test.js | Release deferrals recorded by Christina; future scope for QCH and the wireframe owner |

## B. Production decisions for QCH and QCH IT

The production architecture itself is confirmed (PRD §27 to §30; MVP §28).
These are the decisions that remain.

| # | Question | Why it is open (frozen text) | Evidence in the repository | Who decides |
| --- | --- | --- | --- | --- |
| Q8 | How is each receiving Program's notification address held and maintained: seed data, a setting in QCH Connect, a SharePoint List column, or only the shared mailbox? | PRD §21 and MVP §21 require notification after the referral is saved and traceable failure and retry, and name the shared mailbox for sending. They do not say where the receiving address comes from | No screen sets it; a Program created in the application has no recipient, so its notification fails as `NO_RECIPIENT` while the referral stands (`test/regression/notificationFailure.test.js`); U-1 in merged PR #71 | QCH and QCH IT; the team for scope |
| Q9 | Who builds and runs the archival process: QCH IT as a production process, or the team as application code? | PRD §31 and MVP §30 describe the planned process and its rules; MVP §28 lists it among production requirements; it is not an MVP §32 acceptance gate | No archive logic in `src/`; U-2 in merged PR #71. QCH IT's November 11, 2026 requirements ([production-architecture.md](production-architecture.md) section 2.1) add in-app search and open, access parity, and a separate Archive view. Proposed steps and owners: [Q9 implementation plan](#q9-archive-implementation-plan-proposals-pending-qch-confirmation) below | QCH IT, with the team |
| Q9a | **Corrections and restore.** Can an archived referral's Decision or Service Outcome still be corrected, or must it be restored to the active list first? Who can restore? **OPEN QCH DECISION** | QCH IT's November 11, 2026 email makes archived referrals read-only. The PRD's correction rules (§17, §19) do not mention archived referrals | Corrections live in `src/referrals/outcomeService.js`, which has no archived case; nothing in `src/` archives | QCH, with QCH IT |
| Q9b | **Accepted, outcome not recorded.** Confirm that an accepted referral with no recorded service outcome counts as open and is never archived. **OPEN QCH DECISION** | PRD §31 and the November 11 email protect "open" referrals but do not define open. The team's reading is that it is open (`ACCEPTED_OUTCOME_PENDING`) | `src/referrals/stage.js`; [production-architecture.md](production-architecture.md) section 2.2 | QCH |
| Q9c | **Reporting counts.** Confirm that archived referrals keep counting in Reporting, so historical numbers do not drop after a batch. **OPEN QCH DECISION** | PRD §31 keeps archived records available for authorized reporting; it does not say whether they stay in the counts | `src/reporting/` has no archived filter; nothing in `src/` archives | QCH |
| Q9d | **Archive view search fields.** Which search fields and filters does the Archive view need (for example referral ID, participant name, Program, date range, outcome)? A participant name search must follow the same access rules. **OPEN QCH DECISION** | The November 11 email requires search and filters but does not list them | No Archive view exists | QCH, with QCH IT |
| Q10 | What is the formal retention and deletion policy after archival? | PRD §31 (archived records stay read-only until QCH sets one); PRD §37 item 9; MVP §31 item 10 | Nothing in the application deletes a referral | QCH |
| Q11 | What is the authoritative production Department taxonomy? | PRD §11 (the four demo Departments are seed values, not a production taxonomy); PRD §37 item 8; MVP §31 item 9 | `scripts/syntheticSeed.js` | QCH |
| Q12 | How is the production Program Directory configured, and by whom? | PRD §37 item 7; MVP §31 item 8. The internal Program Directory must never be committed to a public repository (PRD §8, §35) | The repository holds synthetic Programs only | QCH, with QCH IT |
| Q13 | Which browsers and versions must production support? | PRD §37 item 10; MVP §31 item 11 | The team tests Edge, Chromium, Firefox and Playwright WebKit as its own baseline, not QCH policy (`docs/browser-verification.md`) | QCH IT |
| Q14 | Where is the frontend hosted in production? | PRD §32 (the frontend is presentation only); PRD §37 item 11; MVP §31 item 12 | — | QCH IT |
| Q15 | Who are the first production users, groups and permission administrators, and how are they set up? | PRD §24; PRD §37 item 6; MVP §31 item 7 | Synthetic users and grants only (`scripts/syntheticSeed.js`, `scripts/demoPersonas.js`) | QCH and QCH IT |

### Q9 archive implementation plan (proposals pending QCH confirmation)

QCH IT asked that the handoff list the remaining archive implementation
steps and proposed ownership. **Every owner below is a proposal, not an
agreement.** "Development team" is unassigned until QCH decides who builds
QCH Connect in production. Nothing here is built, and nothing here is
production-ready.

| # | Step | Proposed owner |
| --- | --- | --- |
| 1 | Answer Q9a to Q9d and confirm the 2,500 / 500 rule | QCH, with QCH IT |
| 2 | Choose how archived records are stored on the private QCH Connect SharePoint site (an archived flag column, or separate archive Lists) so audit and supporting records follow their parent referral | QCH IT, with the development team |
| 3 | Build the archive process as an Azure Functions timer job with the managed identity and `Sites.Selected`: count active referrals, pick the 500 oldest `COMPLETE` referrals, move each with its supporting records, write an audit entry, stay safe to re-run after a failure, and never touch an open referral | Development team; QCH IT approves the function list, triggers and outbound dependencies |
| 4 | Enforce read-only and the existing access rules on the server for archived referrals | Development team |
| 5 | Add archived-referral search and detail endpoints for the sent and received scopes | Development team |
| 6 | Add the Archive view: a link from Referrals I sent and Received referrals, search, filters, and a read-only detail page clearly labeled Archived, under the same accessibility rules as the rest of the application | Development team |
| 7 | Keep archived referrals in Reporting counts (subject to Q9c) | Development team |
| 8 | Tests: eligibility, open referrals never archived, access parity, read-only, audit kept, report totals the same before and after a batch, accessibility | Development team |
| 9 | Run and monitor the process in production, with a failure and recovery runbook | QCH IT |
| 10 | Formal retention and deletion policy (Q10) | QCH |

The provisioning steps that follow from these decisions (Azure Functions,
SharePoint site and Lists, Entra ID, Graph permissions, Exchange RBAC, the
shared mailbox) are listed as outstanding work in
[known-limitations.md](known-limitations.md), section A, because they are
not open questions: the frozen PRD already decides them.

## Not questions

These are settled by the frozen documents and are not asked again here:
the production architecture (PRD §27 to §30), the archival rules themselves
(PRD §31, with QCH IT's November 11, 2026 additions; only Q9a to Q9d stay open), Entra ID with MFA (PRD §22), the shared-mailbox design (PRD §21),
age as a temporary matching input that is never saved (PRD §5.4), and no
external AI in the MVP (PRD §7).
