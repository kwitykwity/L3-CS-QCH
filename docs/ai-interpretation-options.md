# AI interpretation options for "Find a Program"

**Status: research only (Trello Task I). Nothing here is a decision.** No
code was written, no service was connected, no API key exists, and no
participant information was used. This page compares three ways QCH Connect
could read an open-ended "describe the need" box, so the team is ready when
QCH IT answers pending decision 7 in
[pending-qch-it-decisions.md](pending-qch-it-decisions.md). Any change it
leads to must be reconciled into the Final Technical PRD first.

**Nothing here authorizes an AI service or sending participant data
anywhere.** The provider privacy, retention and region details below come
from public pages; they must be verified with QCH IT and the provider
before any architecture decision.

## What QCH asked for (Oct 23 midpoint check-in)

- **A text box instead of only picking from lists.** Staff describe a need
  in their own words and get help finding Programs that may fit, before
  making a referral. Direct Referral stays for staff who already know the
  Program.
- **Use current Program information.** Matching should use the program
  directory documents and what Program Directors keep up to date in
  Program Management, not a static copy.
- **Facts the app does not hold yet.** Whether a Program is fully enrolled,
  when slots open, and class times (for example an ESOL cycle that fits a
  work schedule).
- **It advises staff; it never contacts participants.** The staff member
  chooses. "No Program fits" is an acceptable answer.
- **QCH wants to teach it over time.** For example, guidance that certain
  situations point toward Family Support, without sending everyone there
  automatically.

This is new evidence from a check-in. Under the team's rules it does not
change a requirement until it is reconciled into the PRD.

## Rules every option must keep, or change on purpose

These hold today in `src/gpme/matchPrograms.js` (rule version `gpme-v1`).
An option that breaks one needs a PRD change first, not just code.

| Today | PRD | What a text box does to it |
| --- | --- | --- |
| Matching reads only need categories, an age range and a ZIP code. Notes and Referral Context never reach it | 8.2 | A free-text box is a new input that will hold participant details. **Every option needs a PRD change for this** |
| Same inputs, same Program data, same rule version give the same result. No scores; order never means "better" | 8.4 | Matching on the **confirmed** inputs stays repeatable. The interpretation step itself may not be: with an AI model (Options B and C), the same text can produce different suggested inputs on different tries. Lost entirely if a model picks or ranks Programs |
| Explanations come from Program facts only | 8.6 | Same as above |
| Missing Program information is never treated as "no restriction" | 8.10 | A model reading documents could guess. The rules engine never does |
| Direct Referral works even if matching fails | 8.8 | Must stay true: if interpretation is down, staff can still pick from the lists |
| Referral data stays in QCH-approved Microsoft infrastructure unless QCH IT approves otherwise in writing | 1.4 | Decides which options are even allowed |
| Logs never contain participant data | 15.3 | The typed text must never be logged by the app, and each outside service's own storage must be known |

## One shape that works with all three options

**Interpret, confirm, then match.**

1. Staff type the need in their own words.
2. An interpreter turns the words into the inputs matching already uses:
   suggested need categories, an age range, and a ZIP code. It never picks
   Programs.
3. Staff see the suggestions, fix them, and confirm. Anything the
   interpreter could not read is left blank, never guessed.
4. The existing rules engine (`gpme-v1`) runs on the confirmed inputs,
   unchanged, with the same explanations.
5. The typed text is thrown away. It is not stored, not sent with the
   referral, and not logged.

Why this shape: a mistake by the interpreter is visible and fixable before
matching runs; matching stays testable and explainable; and the
interpreter can be swapped later (Option A today, Option B if approved)
without touching the rules engine.

What it does **not** make repeatable: the interpretation. Repeatable
matching on confirmed inputs does not mean the suggestions are
repeatable. Option A's word lists give the same suggestions for the same
text and the same list version. An AI model (Options B and C) may suggest
different inputs for identical text on different tries. Staff
confirmation is what keeps a varying suggestion from reaching matching
unchecked; it does not remove the variation.

What it does not solve by itself: enrollment status, open slots and class
times are **Program facts**, not interpretation. They need new fields in
Program Management and a new matching rule whichever option is chosen.
That is a separate PRD change.

The alternative QCH described, where an AI reads the program directory and
recommends Programs itself, is possible with Options B and C. It is noted
under each, and it would replace PRD 8.4, 8.6 and 8.10 rather than extend
them.

## Option A: interpretation inside the application

**How it would work.** A QCH-maintained word list per need category (for
example "learn English", "English classes" and "ESOL" all suggest the
adult education need), simple patterns for ages ("65", "senior",
"teenager") and five-digit ZIP codes, and QCH-written guidance rules
("if the text mentions X, also suggest the Family Support need"). Program
Directors or organization admins would edit the lists in Program
Management. A heavier variant runs a small language model library inside
the app server itself, with no outside service; it adds a large dependency,
memory needs and license review, so it is listed for completeness, not
recommended first.

| Question | Answer |
| --- | --- |
| Participant information processed | The typed text, in memory, for one request |
| Where processing happens | The QCH Connect server, wherever QCH IT hosts it |
| Crosses the security boundary? | No |
| Sign-in and access | The same signed-in user and checks as matching today. No new identity |
| Logging | None of the text. Only the existing safe error lines |
| Retention | Nothing kept. The word lists are Program information, audited like other Program changes |
| Region and network | No new network traffic |
| Implementation effort | Low to medium: a list editor, the interpreter, a confirm step on the matching page |
| QCH IT dependencies | None beyond the app itself |
| Impact on GPME | None to `gpme-v1`. New input step before it |
| Limits | Only understands words someone added. Misses phrasing nobody thought of; it says so and falls back to the lists |

## Option B: a QCH-approved Microsoft-hosted AI capability

**No service is assumed to be approved.** Two shapes are possible.

**B1: QCH Connect calls a model QCH IT deploys in QCH's own Azure tenant**
(for example a model in Azure AI Foundry). The app sends the typed text
and gets back suggested need categories, age range and ZIP, using the
interpret, confirm, then match shape. Microsoft's published terms say:

- Prompts and completions are not shared with OpenAI or other model
  providers and are not used to train models.
- Where processing happens depends on the deployment type QCH IT picks.
  **Standard** processes in the chosen geography (and may move between
  regions inside it); **Data Zone (US)** may process anywhere in the
  United States; **Global** may process anywhere the model is deployed. Data
  at rest stays in the chosen geography for all three.
- **Abuse monitoring:** content flagged by automated checks may be stored
  in the resource's geography and reviewed by authorized Microsoft staff.
  Turning human review off ("modified abuse monitoring") needs an
  application, and Microsoft decides eligibility.
- Some features store data in the resource until deleted (stored
  conversation history, threads, uploaded files, stored completions). A
  single stateless request per interpretation avoids them.
- Microsoft Entra ID and managed identity sign-in, private endpoints and
  turning off public network access are supported, so no API key needs to
  exist.

**B2: a Microsoft 365 agent beside QCH Connect** (for example Copilot
Studio answering from QCH's program documents in SharePoint). Microsoft
says such an agent answers on behalf of the signed-in user and only from
SharePoint content that user can already open, needs Dataverse search,
and keeps conversation transcripts that include the source content it
used. It would not use the rules engine. Whether it could use Program
Management data depends on the integration capabilities QCH approves, on
permissions, and on the chosen architecture (including where data lives,
pending decision 1); this research did not confirm any particular way.
Licensing was not confirmed either.

| Question | B1 (app calls a QCH model) | B2 (Microsoft 365 agent) |
| --- | --- | --- |
| Participant information processed | The typed text | Whatever staff type into the agent |
| Where processing happens | QCH's Azure tenant, in the geography or data zone QCH IT picks | Microsoft 365, under QCH's tenant settings |
| Crosses the security boundary? | Leaves the app, stays in QCH's Microsoft tenant. Needs QCH IT approval | Outside QCH Connect entirely. Its own rules apply |
| Sign-in and access | App's managed identity to the model; staff sign-in unchanged | Staff's own Microsoft sign-in and SharePoint permissions |
| Logging | App logs no text. Azure resource logs must be set so they hold no content | Agent transcripts are kept; QCH sets their retention |
| Retention | None if stateless; flagged content may be held for abuse review unless modified | Transcripts and SharePoint content under QCH's Microsoft 365 policies |
| Region and network | US geography or US data zone; private endpoint possible | QCH's Microsoft 365 tenant location |
| Implementation effort | Medium to high: resource setup by QCH IT, prompt design, a synthetic test set, fallback when it is down | Low code for the team; configuration and upkeep by QCH |
| QCH IT dependencies | Approval, Azure resource, model deployment, identity, network, cost | Licensing, SharePoint site, agent ownership |
| Impact on GPME | None with interpret, confirm, then match. Replaces it if the model picks Programs | None; separate tool. Two answers could disagree |

## Option C: an external AI API (documented for comparison only)

**Not connected and not to be connected.** The app would send the typed
text over the internet to an AI company's API with an API key. As one
example, OpenAI's published API terms say: API data is not used for
training by default; abuse monitoring logs are kept up to 30 days by
default; zero data retention needs OpenAI's approval; some features keep
data until deleted; and US data residency is offered. Other providers
publish different terms, and all of them change over time.

| Question | Answer |
| --- | --- |
| Participant information processed | The typed text |
| Where processing happens | The provider's infrastructure, outside QCH's Microsoft tenant |
| Crosses the security boundary? | **Yes.** Needs written QCH IT approval under PRD 1.4. Earlier QCH guidance was no outside AI for referral data |
| Sign-in and access | An API key held in Key Vault; a new secret to protect and rotate |
| Logging | App logs no text; the provider keeps its own logs |
| Retention | Up to 30 days by default for the example above, unless zero retention is approved |
| Region and network | Provider's regions; outbound internet from the app |
| Implementation effort | Medium in code; high in approvals, contracts and review |
| QCH IT dependencies | Written approval, a contract and data terms, a key, network egress |
| Impact on GPME | Same as B1 |

## Side by side

| | A: in the app | B1: QCH's Azure model | B2: Microsoft 365 agent | C: external API |
| --- | --- | --- | --- | --- |
| Data leaves QCH Connect | No | Yes, stays in QCH's tenant | Yes, separate tool | Yes, leaves QCH's Microsoft tenant |
| Approval needed before building | PRD reconciliation | QCH IT + PRD reconciliation | QCH IT + licensing + PRD reconciliation | Written QCH IT exception + PRD reconciliation |
| Understands new wording | Only listed words | Yes | Yes | Yes |
| Matching on confirmed inputs is explainable and repeatable | Yes | Yes, if it only interprets | No (separate answers) | Yes, if it only interprets |
| Same text always gives the same suggestions | Yes, for the same word-list version | No, may vary | No, may vary | No, may vary |
| Can start before QCH IT answers | Yes, once the PRD is reconciled, with synthetic data | No | No | No |

## Questions for QCH IT and QCH

1. Is any AI service approved for QCH Connect? If so, which one, in which
   tenant and region, and with which deployment type?
2. May a staff member's description of a participant be sent to it, or only
   Program information?
3. Is "interpret, confirm, then match" acceptable, or does QCH want the AI
   to recommend Programs itself (a larger PRD change)?
4. Is Microsoft's human review of flagged content acceptable, or would QCH
   apply to modify abuse monitoring?
5. Who keeps the word lists and guidance rules up to date?
6. Who updates enrollment status and open slots, and how often?

## What the research suggests (for Christina to decide)

Option A fits inside today's boundary and does not need a QCH IT
decision. It still **must not be implemented until the free-text input is
reconciled into the Final Technical PRD** (it changes PRD 8.2, see above)
and that change is approved. After that, it could be built with synthetic
data, using the interpret, confirm, then match shape. If QCH IT later approves a Microsoft-hosted model, B1 can replace
the interpreter without changing the rules engine. Option C should only be
considered with a written exception from QCH IT. Enrollment status is
needed in every option and is a separate Program Management change.

## Sources

Checked October 24, 2026. These are public pages, and the terms change.
Verify every provider-specific privacy, retention and region claim with
QCH IT and the provider before any architecture decision.

- Microsoft: [Data, privacy, and security for Models Sold by Azure](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy)
- Microsoft: [Abuse monitoring](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/abuse-monitoring)
- Microsoft: [Azure OpenAI security baseline](https://learn.microsoft.com/en-us/security/benchmark/azure/baselines/azure-openai-security-baseline)
- Microsoft: [Copilot Studio: SharePoint as a knowledge source](https://learn.microsoft.com/en-us/microsoft-copilot-studio/nlu-generative-answers-sharepoint-onedrive)
- OpenAI: [Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data)
- QCH midpoint check-in transcript, October 23, 2026 (team copy)
