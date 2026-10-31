# QCH Connect documentation

Handoff documentation (Trello cards 18 and Task H; Final Technical PRD 18,
19 and 22). It describes the application **as it exists today** and keeps
the confirmed production design and the provisioning QCH IT still has to do
separate from it.

**Status: draft, not yet exercised.** Nothing here has run in QCH's
environment. This documentation does not complete production deployment,
restore verification, or QCH handoff acceptance. The application runs on in-memory stores with synthetic data.
The production architecture is confirmed by the Frozen Handoff PRD:
SharePoint Lists in a private site (no separate database), Azure Functions
with a managed identity, Graph `Sites.Selected`, the shared mailbox through
Exchange RBAC, and Entra ID single sign-on with MFA. What QCH and QCH IT
still have to provision is listed in
[production-architecture.md](production-architecture.md).

**Authority.** The Frozen Handoff PRD (October 28, 2026) governs, then the
Handoff MVP. The documents under "Historical and superseded" below are kept
for the record. They are not current guidance and are not a source of
requirements.

These files must not contain real configuration values, secrets, or QCH
internal data. `test/docs.test.js` checks them for a few known secret and
identifier patterns. That is a limited guard against obvious mistakes, not
proof that the documents contain no secrets; reviewers still check by eye.

## Start here: current handoff guidance

For QCH and QCH IT, in reading order.

| File | What it covers |
| --- | --- |
| [known-limitations.md](known-limitations.md) | **Known limitations and outstanding verification**: what does not work yet, is not built here, or is not yet verified, with the repository evidence for each (Task TT) |
| [handoff-questions.md](handoff-questions.md) | **Handoff questions for QCH and QCH IT**: the decisions still open, each tied to the Frozen Handoff PRD or Handoff MVP (Task SS) |
| [production-architecture.md](production-architecture.md) | **Confirmed production architecture** from the Frozen Handoff PRD (SharePoint Lists, Azure Functions, Graph, Exchange RBAC, Entra ID with MFA), confirmed archival behavior, and the full checklist of QCH/QCH IT production dependencies still outstanding (Task PP/QQ) |
| [qch-it-requirements.md](qch-it-requirements.md) | Everything QCH IT needs to provide, and which part of the app needs it |
| [handoff-checklist.md](handoff-checklist.md) | Every handoff deliverable, where it lives, and what it waits on |
| [prd-traceability.md](prd-traceability.md) | Handoff requirements traceability audit (Task GG): frozen requirements, implementation, verification evidence and remaining questions |
| [demo-runbook.md](demo-runbook.md) | **Nov. 9 demo runbook**: setup, who plays which role, the exact journey and what to expect, reset, fallbacks, and what must not be presented as done (Task T) |
| [demo-environment.md](demo-environment.md) | Starting, resetting and safety-checking the synthetic demo for Nov 9 (Task S) |

## Reference: how the application works today

| File | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | How the application is built today: where it runs, folders, request flow, permissions, API, screens, tests |
| [data-dictionary.md](data-dictionary.md) | Every table and column in the earlier SQL schema design. A design record, **not** the production store |
| [admin-guide.md](admin-guide.md) | Program Management and organization tasks for administrators |
| [troubleshooting.md](troubleshooting.md) | Start-up problems, error codes, test problems, what is logged |
| [operations.md](operations.md) | Monitoring expectations, verification procedures, recovery concepts, known dependencies |
| [deployment.md](deployment.md) | The release procedure in PRD 18.2 order, with QCH IT steps marked. A draft: steps that name App Service, Azure SQL or Key Vault come from the earlier plan and are superseded |
| [dependencies.md](dependencies.md) | Direct dependencies and how to list every license |
| [task-c-program-information.md](task-c-program-information.md) | Task C: current Program information: scope, reconciliation, and storage-independent interface |

## Verification evidence

Point-in-time records of what was run and what it found. Each is accurate for
the commit or date it names, not necessarily for today's `main`.

| File | What it covers |
| --- | --- |
| [verification-evidence.md](verification-evidence.md) | Evidence that the MVP journeys work together, failures found and fixed, and what waits on the QCH environment (Task G) |
| [security-regression.md](security-regression.md) | What the security tests prove for every route, what they found, and what to re-run once the production architecture is confirmed (Task F) |
| [freeze-audit.md](freeze-audit.md) | Is `main` ready for the Nov 2 code freeze? Findings by class and the evidence for each check (Task V) |
| [regression-coverage.md](regression-coverage.md) | Accessibility and end-to-end regression coverage, and the manual keyboard checklist |
| [screen-reader-check.md](screen-reader-check.md) | VoiceOver script and record sheet: labels, required fields, errors, announcements, dialogs, focus |
| [browser-verification.md](browser-verification.md) | Browser matrix (team baseline, pending QCH IT), critical journeys run in Edge, Chromium, Firefox and WebKit, and what they found |
| [desktop-browser-check.md](desktop-browser-check.md) | Task 203 manual Windows/Edge desktop verification: synthetic workflows, application text size and browser zoom, demo-banner finding F1, screenshot evidence, and coverage limits |
| [demo-rehearsal.md](demo-rehearsal.md) | Demo dress rehearsal: one connected synthetic journey through every feature, its record, and what it found (Task R) |

## Historical and superseded

**Not current authority.** Read these for background only. Where they differ
from the Frozen Handoff PRD or the documents above, the Frozen Handoff PRD and
the current guidance govern.

| File | What it is |
| --- | --- |
| [pending-qch-it-decisions.md](pending-qch-it-decisions.md) | Pending QCH IT Architecture Decisions as they stood **before** the frozen PRD. Most are now confirmed; see [production-architecture.md](production-architecture.md) and [handoff-questions.md](handoff-questions.md) |
| [historical-oct14-implementation-map.md](historical-oct14-implementation-map.md) | The earlier audit against the Oct 14 Final Technical PRD. Historical only: not a source of requirements |
| [stale-pr-verification.md](stale-pr-verification.md) | Security dependency update and stale pull requests (Task P), checked against `main` on October 25, 2026 |
| [gpme-description-step-prd-8-2.md](gpme-description-step-prd-8-2.md) | A **proposed** reading of the describe-the-need step against Final Technical PRD 8.2. Not approved |
| [ai-interpretation-options.md](ai-interpretation-options.md) | Research only: three ways an open-ended "Find a Program" box could work, compared for pending decision 7. No external AI is part of the MVP |

## Elsewhere in the repository

- The README at the repository root covers setup, configuration, running,
  tests, and the API in detail.
- [`db/README.md`](../db/README.md) covers the earlier SQL schema design's
  migrations 001 to 004: run order, required `sqlcmd` flags, checks, and what
  to do if a run fails partway. It is a design record, not the production
  store. [`db/AUDIT_VERIFICATION.md`](../db/AUDIT_VERIFICATION.md) covers the
  audit rules.
