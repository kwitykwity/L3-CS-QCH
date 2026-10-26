# Requirements reconciliation register

**Status: working register for the Oct 30, 2026 controlled PRD revision
(Trello Task U).** This page does not change any requirement by itself.
The Oct 14, 2026 Final Technical PRD stays the baseline until the team
makes the single controlled revision from this register.

One place for every piece of new QCH or QCH IT evidence received after the
Final Technical PRD, what it would change, and what the code does today,
so the PRD revision does not have to be rebuilt from Slack, pull request
descriptions or memory.

## How to read this page

- **PRD**: the section the item touches, checked against the team's copy
  of the Oct 14 Final Technical PRD on Oct 26, 2026. The PRD itself is not
  in this repository.
- **Evidence**: what QCH or QCH IT said, when, and where it was received.
- **Today**: what `main` does now, with the files that show it. Passing
  tests and merged code are implementation evidence only. They do not
  approve a requirement.
- **Status**, one of three:
  - **CONFIRMED**: QCH or QCH IT stated it directly. Ready to write into
    the PRD revision.
  - **TEAM PRODUCT DECISION**: the team decided it, inside the PRD's
    rules, without a QCH answer. Recorded with the date the team made it,
    or marked "not yet recorded".
  - **OPEN QCH DECISION**: waiting on QCH or QCH IT. The team does not
    guess. If still open at the Oct 30 cutoff, it stays open in the PRD
    revision.
- **Approver**: who gave the answer, and the date.

## Evidence sources

| Source | Date | Where the team holds it |
| --- | --- | --- |
| Final Technical PRD (baseline) | Oct 14, 2026 | `QCH_Connect_Final_Tech_PRD_Oct14_2026.docx` (team copy, not in this repository) |
| QCH IT infrastructure guidance | Oct 22, 2026 | Team copy, not in this repository. The open items it raised are tracked in [pending-qch-it-decisions.md](pending-qch-it-decisions.md) |
| Midpoint check-in with QCH program staff | Oct 23, 2026 | Team transcript copy, not in this repository. Requests summarized in [ai-interpretation-options.md](ai-interpretation-options.md) and [task-c-program-information.md](task-c-program-information.md) |
| Kyle Butler (QCH), reply to "QCH Connect: Midpoint Follow-Up and Remaining Questions" | Oct 26, 2026 | Email to the team. Kyle answered the non-technical questions and invited Joelle Tirado (QCH) to add to them |

PRD 22 closed the business-clarification phase "unless genuinely new or
conflicting business evidence emerges". The Oct 22, Oct 23 and Oct 26
items below are that kind of evidence, which is why they are reconciled
here instead of being treated as already covered.

## Summary

| ID | Item | Status | Built on `main`? |
| --- | --- | --- | --- |
| R1 | Open-ended "describe the need" search | CONFIRMED | No. In review as PR #43 |
| R2 | Show what the app understood, so staff can correct it before matching | CONFIRMED | No. In review as PR #43 |
| R3 | How the free-text step fits PRD 8.2 | TEAM PRODUCT DECISION (not yet recorded) | Not applicable |
| R4 | Everyday age words ("teen", "older adult") mapped to age ranges | TEAM PRODUCT DECISION (not yet recorded) | No. In PR #43 |
| R5 | Approved AI or language-processing boundary | OPEN QCH DECISION | Rules only, no AI |
| R6 | Need is the most important matching factor | CONFIRMED | Yes |
| R7 | Language of service, more than one per Program | CONFIRMED | No |
| R8 | Programs that are full or have a wait list still appear, with status shown | CONFIRMED | Partly. Never removed; status not shown in Find a Program |
| R9 | No participant waitlist-management system | CONFIRMED | Yes. None built |
| R10 | QCH adds and removes Programs as contracts change | CONFIRMED | Yes, through discontinue and retire |
| R11 | Mix of standardized and flexible Program fields | CONFIRMED | Yes |
| R12 | "Program Description" and "Important Information About Our Program" as flexible text | CONFIRMED | Partly. Description yes; second field not named this way |
| R13 | Multiple locations: separate listings, or one shared listing | CONFIRMED | Partly. Separate listings work; shared listing is free text only |
| R14 | Program contact shown in Find a Program and Program Management, with a prompt to refer through the app | CONFIRMED | Partly. Stored; not shown in Find a Program |
| R15 | "No match found" lets staff revise the search or use Direct Referral | CONFIRMED | Yes |
| R16 | No automatic fallback to Family Support | CONFIRMED | Yes |
| R17 | Matching improves through updated Program information and rule changes from staff feedback | CONFIRMED | Yes, through Program Management and rule versions |
| R18 | Missing Program information never treated as "no restriction" | TEAM PRODUCT DECISION (Oct 18, 2026) | Yes |
| R19 | Production data store: SharePoint Lists or Azure SQL design | OPEN QCH DECISION | In-memory stores only |
| R20 | Server-side hosting and compute | OPEN QCH DECISION | Runs on any Node host |
| R21 | SharePoint site and access model | OPEN QCH DECISION | No SharePoint code |
| R22 | Entra configuration | OPEN QCH DECISION | Not built; production fails closed |
| R23 | Microsoft Graph and shared mailbox configuration | OPEN QCH DECISION | Simulated outbox only |
| R24 | Department naming and mapping | OPEN QCH DECISION | Four shortened names in reference data |
| R25 | Archive, retention and audit policy | OPEN QCH DECISION | Everything kept; nothing purged |

## Find a Program and matching

### R1. Open-ended "describe the need" search

| | |
| --- | --- |
| PRD | 2.1 (Guided path), 8.1, 8.2 (approved criteria), 5.3 (matching inputs), 5.4 (sensitive free text) |
| Evidence | Oct 23: program staff asked for a text box where staff describe the need in their own words, instead of only picking from lists. Oct 26: asked whether staff should be able to describe participant needs in their own words and receive matching Program suggestions, Kyle answered "Yes, definitely!" |
| Impact | A new worker input on the Find a Program screen. The free text is a fourth thing the app receives, so the PRD has to say what may be done with it (see R3) |
| Today | `main` matches on need categories, an age range and a ZIP only (`src/gpme/matchPrograms.js`, `public/referral/guided.js`). PR #43 (Task D, branch `task-d`) adds the text box and a rules-based interpreter in the application |
| Status | **CONFIRMED** (the requirement). How it fits PRD 8.2 is R3 |
| Affected | PR #43; `src/gpme/`, `public/referral/` |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R2. Show what the app understood before matching

| | |
| --- | --- |
| PRD | 8.1 (staff decide), 8.6 (explanations) |
| Evidence | Oct 26: asked whether the app should show its reading of the needs so staff can review or correct it before seeing suggestions, Kyle answered "Yes, that would be great" |
| Impact | The interpret, confirm, then match flow becomes a requirement rather than a team design choice |
| Today | Not on `main`. PR #43 proposes needs, age and ZIP, and matching runs only after the worker confirms or corrects them |
| Status | **CONFIRMED** |
| Affected | PR #43 |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R3. How the free-text step fits PRD 8.2

| | |
| --- | --- |
| PRD | 8.2, 5.3, 5.4, 21 |
| Evidence | No QCH evidence on this point. The Task D branch has a proposed reading in `docs/gpme-description-step-prd-8-2.md` (status there: proposed, not approved), written without the PRD text |
| What the PRD says | 8.2 limits what **matching** may use: only explicitly approved structured criteria, never hidden factors such as free-text Notes or Referral Context. 5.3 lets temporary matching inputs stay in memory during the workflow but not be persisted. 5.4 names Referral Context and Notes as sensitive free text. 21 makes external generative-AI services processing referral data a non-goal |
| Impact | The PRD text supports the PR #43 design: free text is read only to propose structured criteria, the worker confirms them, and matching uses only the confirmed criteria. The revision still needs to say two things the PRD does not: that the describe-the-need text is handled like the 5.4 sensitive free text (never logged, stored or sent), and that the interpreter runs inside the application |
| Today | On PR #43, the text is never sent to matching, never saved with the referral, and never logged or returned |
| Status | **TEAM PRODUCT DECISION**, not yet recorded. Decide before PR #43 merges, then write it into the Oct 30 revision |
| Affected | PR #43; Trello Task Q's special handling for PR #43 |
| Approver | None recorded |

### R4. Everyday age words mapped to age ranges

| | |
| --- | --- |
| PRD | 8.2 (age range input) |
| Evidence | No QCH evidence. Team proposal in PR #43's interpreter: "teen" or "teenager" proposes ages 13 to 19; "elderly" or "older adult" proposes 60 and up |
| Impact | Only a proposal the worker sees and can change, so a wrong range is visible before matching. For comparison, QCH's program sheet lists Older Adult Centers as 60 and up and Teen Outreach as 13 to 21 |
| Today | Not on `main` |
| Status | **TEAM PRODUCT DECISION**, not yet recorded. The team can ask QCH to confirm the ranges, but should not present them as QCH's |
| Affected | PR #43 (`src/gpme/interpretation/ruleBasedInterpreter.js` on `task-d`) |
| Approver | None recorded |

### R5. Approved AI or language-processing boundary

| | |
| --- | --- |
| PRD | 1.4 (data stays in the QCH-approved Microsoft environment unless QCH IT approves otherwise in writing), 21 (external generative-AI services processing referral data is a non-goal) |
| Evidence | Earlier guidance: no outside AI services for referral data. Oct 23: program staff asked for AI-assisted matching. Oct 26: Kyle confirmed open-ended search (R1) but answered non-technical questions only, so this is not settled |
| Impact | Decides whether the interpreter can ever be anything other than rules inside the app. Options are compared in [ai-interpretation-options.md](ai-interpretation-options.md) |
| Today | Rules only. No AI service, no API key, no outside calls |
| Status | **OPEN QCH DECISION** (pending decision 7) |
| Affected | [pending-qch-it-decisions.md](pending-qch-it-decisions.md) decision 7 |
| Approver | Waiting on QCH IT |

### R6. Need is the most important matching factor

| | |
| --- | --- |
| PRD | 8.2, 8.3 |
| Evidence | Oct 26: Kyle said the most important factor is need, the Program must address the participant's need, and the factors the team listed are a good foundation |
| Impact | Confirms the current design. No change |
| Today | A Program must offer at least one picked need category to appear (`src/gpme/matchPrograms.js`) |
| Status | **CONFIRMED** |
| Affected | None |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R7. Language of service

| | |
| --- | --- |
| PRD | 4.2 (common searchable or matchable attributes), 8.2 (approved structured criteria), 8.7 and 8.9 (rule versions and regression tests), 20.3 (scope) |
| Evidence | Oct 26: Kyle asked to add language of service (for example English, Spanish or Chinese), and said Programs should be able to select more than one language |
| Impact | New. A structured, multi-valued common Program attribute. PRD 8.2 does not fix the number of matching inputs; it allows "explicitly approved structured criteria supported by Program information". Need, age range and ZIP are the team's `gpme-v1` rule set (Oct 18), not a PRD limit. Kyle's answer approves language as a factor, so using it in matching needs a new rule version (8.7) and regression tests before activation (8.9), not a change to 8.2. A flexible text field would not work for matching, because matching must not read meaning from editable labels or free text ([task-c-program-information.md](task-c-program-information.md)). It passes the 20.3 test: it helps a worker make an appropriate internal referral |
| Today | Not built. No language field in the schema, Program Management or matching |
| Status | **CONFIRMED** (the requirement). The team still needs to decide whether language filters results or is only shown |
| Affected | `db/migrations/` (new table), `src/programs/`, `src/gpme/`, `public/referral/` |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R8. Full or wait-listed Programs still appear, with status shown

| | |
| --- | --- |
| PRD | 4.1 (support genuine Program differences, not one universal Open/Closed plus Next Start Date structure), 4.2, 8.6 |
| Evidence | Oct 26: Kyle said Programs with limited availability or wait lists should still appear with their status clearly shown, and no situation should exclude a Program QCH still has |
| Impact | Availability is information to show, never a filter. Find a Program results need to show it |
| Today | Matching never removes a Program for availability, because it does not read availability. Program staff can store availability and wait-list information as flexible fields (Task C; examples in `scripts/syntheticProgramInformation.js`). The Find a Program results show name, Department, site and explanations only (`public/referral/app.js`) |
| Status | **CONFIRMED** |
| Affected | `src/gpme/gpmeService.js` (`listCurrentProgramInformation` is internal only), `public/referral/` |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R9. No participant waitlist-management system

| | |
| --- | --- |
| PRD | 21 (enrollment management is a non-goal) |
| Evidence | Oct 26: the team's question stated it meant Program availability information, not a participant waitlist system, and Kyle's answers did not ask for one |
| Impact | None. Confirms scope |
| Today | No participant waitlist records exist ([task-c-program-information.md](task-c-program-information.md)) |
| Status | **CONFIRMED** |
| Affected | None |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R10. QCH adds and removes Programs as contracts change

| | |
| --- | --- |
| PRD | 4.3, 4.4 (lifecycle) |
| Evidence | Oct 26: Kyle said QCH should be able to delete or add Programs as it gains or loses contracts, and any Program QCH still has should appear |
| Impact | PRD 4.4 uses discontinue and retire, not hard delete: discontinued items leave new operational choices while history and reporting stay intact. The revision should say that "delete" is met by discontinue or retire |
| Today | Programs are created, discontinued, reactivated and retired in Program Management. Discontinued Programs leave new referral choices; existing referrals keep them |
| Status | **CONFIRMED** (the need). That discontinue or retire meets "delete" is the team's reading of 4.4; under PRD 22 it is not worth a new question to QCH on its own |
| Affected | `src/programs/programService.js`, `public/program-management/` |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R11. Mix of standardized and flexible Program fields

| | |
| --- | --- |
| PRD | 4.1, 4.2 |
| Evidence | Oct 26: Kyle said a mix of standardized and flexible fields would be best |
| Impact | Confirms the current design |
| Today | Common fields live on the Program; Program-specific fields use the configurable field design (`src/programs/fieldService.js`) |
| Status | **CONFIRMED** |
| Affected | None |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R12. "Program Description" and "Important Information About Our Program"

| | |
| --- | --- |
| PRD | 4.1, 4.2 |
| Evidence | Oct 26: Kyle said both should be flexible text fields |
| Impact | Two named free-text fields every Program can fill in |
| Today | Description is a common text field on every Program. "Important Information About Our Program" is not a named field. The closest is the synthetic example label "Current Program information" in `scripts/syntheticProgramInformation.js`, which is demo data, not a standard field |
| Status | **CONFIRMED** |
| Affected | `src/programs/`, `public/program-management/`, Find a Program detail |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R13. Programs at more than one location

| | |
| --- | --- |
| PRD | 4.1, 9.1 |
| Evidence | Oct 26: Kyle said Programs should choose. Option 1: a separate listing per location, each with its own availability, schedule and details. Option 2: one shared listing that includes all locations |
| Impact | Both options must be supported. Task C had assumed one Program identity unless QCH defined separate Programs; QCH has now said both |
| Today | Option 1 works: a Program name can repeat with a different site. Option 2 is only possible as free text in an "Additional locations" flexible field |
| Status | **CONFIRMED** |
| Affected | `src/programs/`, `public/program-management/`, [task-c-program-information.md](task-c-program-information.md) |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R14. Program contact shown to referring staff

| | |
| --- | --- |
| PRD | 4.1, 11.3 (notification routing stays server-side) |
| Evidence | Oct 26: Kyle said referring staff should see the primary Program contact in both Find a Program and Program Management. In Find a Program it should come with a prompt to submit referrals through the system, and call or email the contact only if they cannot find what they need in the tool |
| Impact | Settles the open question in Task C about which contact to show. The contact is separate from the notification address, which stays server-only |
| Today | A primary contact can be stored as a flexible field (Task C). It is not shown in Find a Program. There is no prompt text |
| Status | **CONFIRMED** |
| Affected | `src/gpme/`, `public/referral/`, `public/program-management/` |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R15. "No match found" path

| | |
| --- | --- |
| PRD | 8.5, 8.8 |
| Evidence | Oct 26: asked whether no suitable match should show a "No match found" message and let staff revise their search or use Direct Referral, Kyle said "Yes, that sounds good" |
| Impact | Confirms the current behavior. "No plausible match identified" is the PRD 8.5 wording; Kyle's answer does not ask to change it |
| Today | The screen says no plausible match was identified, that this does not mean QCH has no appropriate Program, and offers changing the answers or Direct Referral (`public/referral/guided.js`). A technical failure is a separate message |
| Status | **CONFIRMED** |
| Affected | None |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R16. No automatic fallback to Family Support

| | |
| --- | --- |
| PRD | 8.1, 21 (automatic Family Support rerouting is a non-goal) |
| Evidence | Oct 23: program staff wanted guidance toward Family Support in some situations, without sending everyone there. Oct 26: the reply says Family Support would not be an automatic fallback. In the plain-text copy this line sits after Kyle's "Yes, that sounds good", so it may be the team's own wording from the question rather than Kyle's; check the original email's colors. Either way it matches PRD 21 |
| Impact | Confirms the current behavior |
| Today | Matching never adds a Program that did not pass on need |
| Status | **CONFIRMED** |
| Affected | None |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R17. How matching improves over time

| | |
| --- | --- |
| PRD | 8.4, 8.7 (rule versions) |
| Evidence | Oct 26: Kyle said improvements should come mainly from updated Program information and refined matching rules based on staff feedback |
| Impact | Confirms the approach. No in-app feedback tool was requested |
| Today | Program staff update Program information in Program Management. Rules carry a version (`gpme-v1`) so a rule change is traceable |
| Status | **CONFIRMED** |
| Affected | None |
| Approver | Kyle Butler (QCH), Oct 26, 2026 |

### R18. Missing Program information

| | |
| --- | --- |
| PRD | 8.10 |
| Evidence | No new QCH evidence. Team decision in the GPME Decision Proposal, Oct 18, 2026: four states for age limits and service areas (set, no restriction, not on file, other limit). Not on file is never "no restriction" and never removes a Program. Kyle's Oct 26 answer that Programs should still appear is consistent with this |
| Impact | None unless QCH disagrees |
| Today | `db/migrations/003_gpme_matching_states.sql`, `src/gpme/programFacts.js`, `src/gpme/matchPrograms.js` |
| Status | **TEAM PRODUCT DECISION** |
| Affected | None |
| Approver | Team, Oct 18, 2026 |

## Production architecture

Each of these is tracked in more detail in
[pending-qch-it-decisions.md](pending-qch-it-decisions.md). None was
answered in Kyle's Oct 26 email.

### R19. Production data store

| | |
| --- | --- |
| PRD | 1.3, 1.4 (Azure SQL Database marked CLIENT CONFIRMED / QCH IT), 9 |
| Evidence | Raised after the PRD: Task U lists it among the Oct 22 QCH IT guidance items, and SharePoint Lists is now an option. This **conflicts** with a PRD item marked client-confirmed, so the revision has to change 1.3 and 1.4 or keep them once QCH IT decides. Check the wording against the Oct 22 email |
| Impact | Decides how the store, migrations, backups and reports are built. The app depends on transactions, row versions and uniqueness rules |
| Today | In-memory stores with synthetic data. The SQL in `db/migrations/` is the team's design, not a confirmed store |
| Status | **OPEN QCH DECISION** (pending decision 1) |
| Affected | `db/`, all store contracts |
| Approver | Waiting on QCH IT |

### R20. Server-side hosting and compute

| | |
| --- | --- |
| PRD | 1.4 (Azure App Service marked CLIENT CONFIRMED / QCH IT), 3.7, 6.4 |
| Evidence | Task U lists it among the Oct 22 QCH IT guidance items, which reopened a PRD item marked client-confirmed. Check the wording against the Oct 22 email |
| Impact | The app is a server application and cannot run as static pages |
| Today | `npm start` runs on any Node host; Node 24.15.0 pinned for development |
| Status | **OPEN QCH DECISION** (pending decision 2) |
| Affected | [deployment.md](deployment.md) |
| Approver | Waiting on QCH IT |

### R21. SharePoint site and access model

| | |
| --- | --- |
| PRD | 3.3, 3.6, 9.12 (direct data changes are not the normal production path) |
| Evidence | Follows from R19 |
| Impact | If staff can open the lists directly, the app's permission and audit rules can be bypassed |
| Today | No SharePoint code |
| Status | **OPEN QCH DECISION** (pending decision 3) |
| Affected | `src/authorization/referralAccess.js` |
| Approver | Waiting on QCH IT |

### R22. Entra configuration

| | |
| --- | --- |
| PRD | 3.1, 3.2, 22 (Entra group names and access configuration: open implementation dependency) |
| Evidence | Requested from QCH IT; no configuration received. The policy is settled in the PRD: Entra grants app access, and action permissions live in QCH Connect |
| Impact | Staff sign-in, MFA, and which Entra group grants access to the app |
| Today | No Entra sign-in. Production passes no identity, so every `/api` route answers 401 |
| Status | **OPEN QCH DECISION** (pending decision 5) |
| Affected | `src/app.js` (`resolveIdentity`), [qch-it-requirements.md](qch-it-requirements.md) |
| Approver | Waiting on QCH IT |

### R23. Microsoft Graph and shared mailbox

| | |
| --- | --- |
| PRD | 11.1 (Graph and a QCH shared mailbox, CLIENT CONFIRMED / QCH IT), 22 (mailbox configuration: open implementation dependency) |
| Evidence | QCH IT has created the shared mailbox. Sending permission and configuration are still pending |
| Impact | Production sends no referral emails until this is set up |
| Today | Notifications run against a simulated outbox that refuses to start outside development and test |
| Status | **OPEN QCH DECISION** (pending decision 6) |
| Affected | `src/notifications/` |
| Approver | Waiting on QCH IT |

### R24. Department naming and mapping

| | |
| --- | --- |
| PRD | 4.4, 9.1, 12.4 (Department context in reports) |
| Evidence | QCH's program sheet groups Programs under four departments. The reference data uses shortened names: Children & Youth, Young Adult, Adult & Family, Older Adult. QCH's website uses longer names |
| Impact | Department names appear on screens and in reports |
| Today | `db/migrations/002_reference_data.sql` notes the names must be confirmed with QCH before production |
| Status | **OPEN QCH DECISION** |
| Affected | `db/migrations/002_reference_data.sql` |
| Approver | Waiting on QCH |

### R25. Archive, retention and audit policy

| | |
| --- | --- |
| PRD | 6.5, 9.6, 9.11, 22 (retention and purge: open QCH policy dependency) |
| Evidence | No answer received. Already open in the PRD |
| Impact | Decides what reports and referral lists show over time |
| Today | Nothing is archived or deleted. Referrals cannot be hard-deleted |
| Status | **OPEN QCH DECISION** (pending decisions 4 and 8) |
| Affected | None until decided |
| Approver | Waiting on QCH |

## Keeping this register current

- Add a row when new QCH or QCH IT evidence arrives before the Oct 30
  cutoff. Record the date and who said it.
- Change a status only with evidence. A merged pull request does not move
  a row to CONFIRMED.
- When the Oct 30 PRD revision is made, note its date here and which rows
  it absorbed.
