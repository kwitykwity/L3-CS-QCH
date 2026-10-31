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
[pending-qch-it-decisions.md](pending-qch-it-decisions.md) predates that
confirmation.

These files must not contain real configuration values, secrets, or QCH
internal data. `test/docs.test.js` checks them for a few known secret and
identifier patterns. That is a limited guard against obvious mistakes, not
proof that the documents contain no secrets; reviewers still check by eye.

## Start here

| File | What it covers |
| --- | --- |
| [release-notes-capstone-handoff.md](release-notes-capstone-handoff.md) | **Capstone handoff release notes**: what is delivered (with evidence), production status, how to run and verify, and the final verification, with the frozen commit and Task V results pending (Task 219) |
| [demo-runbook.md](demo-runbook.md) | **Nov. 9 demo runbook**: setup, who plays which role, the exact journey and what to expect, reset, fallbacks, and what must not be presented as done (Task T) |
| [production-architecture.md](production-architecture.md) | **Confirmed production architecture** from the Frozen Handoff PRD (SharePoint Lists, Azure Functions, Graph, Exchange RBAC, Entra ID with MFA), confirmed archival behavior, and the full checklist of QCH/QCH IT production dependencies still outstanding (Task PP/QQ) |
| [pending-qch-it-decisions.md](pending-qch-it-decisions.md) | **Pending QCH IT Architecture Decisions** as they stood before the frozen PRD (most are now confirmed; see production-architecture.md), and which unfinished work is an engineering gap versus an outside dependency |
| [architecture.md](architecture.md) | How the application is built today: where it runs, folders, request flow, permissions, API, screens, tests |
| [data-dictionary.md](data-dictionary.md) | Every table and column in the current schema design |
| [admin-guide.md](admin-guide.md) | Program Management and organization tasks for administrators |
| [troubleshooting.md](troubleshooting.md) | Start-up problems, error codes, test problems, what is logged |
| [operations.md](operations.md) | Monitoring expectations, verification procedures, recovery concepts, known dependencies |
| [security-regression.md](security-regression.md) | What the security tests prove for every route, what they found, and what to re-run once the production architecture is confirmed (Task F) |
| [freeze-audit.md](freeze-audit.md) | Is `main` ready for the Nov 2 code freeze? Findings by class and the evidence for each check (Task V) |
| [verification-evidence.md](verification-evidence.md) | Evidence that the MVP journeys work together, failures found and fixed, and what waits on the QCH environment (Task G) |
| [ai-interpretation-options.md](ai-interpretation-options.md) | Research only: three ways an open-ended "Find a Program" box could work, compared for pending decision 7 |
| [prd-traceability.md](prd-traceability.md) | Handoff requirements traceability audit (Task GG): frozen requirements, implementation, verification evidence and remaining questions |
| [historical-oct14-implementation-map.md](historical-oct14-implementation-map.md) | The earlier audit against the Oct 14 Final Technical PRD. Historical only: not a source of requirements |

## Deployment and handoff

| File | What it covers |
| --- | --- |
| [deployment.md](deployment.md) | The release procedure in PRD 18.2 order, with QCH IT steps marked |
| [qch-it-requirements.md](qch-it-requirements.md) | Everything QCH IT needs to provide, and which part of the app needs it |
| [handoff-checklist.md](handoff-checklist.md) | Every handoff deliverable, where it lives, and what it waits on |
| [dependencies.md](dependencies.md) | Direct dependencies and how to list every license |
| [demo-environment.md](demo-environment.md) | Starting, resetting and safety-checking the synthetic demo for Nov 9 (Task S) |
| [regression-coverage.md](regression-coverage.md) | Accessibility and end-to-end regression coverage, and the manual keyboard checklist |
| [screen-reader-check.md](screen-reader-check.md) | VoiceOver script and record sheet: labels, required fields, errors, announcements, dialogs, focus |
| [browser-verification.md](browser-verification.md) | Browser matrix (team baseline, pending QCH IT), critical journeys run in Edge, Chromium, Firefox and WebKit, and what they found |
| [demo-rehearsal.md](demo-rehearsal.md) | Demo dress rehearsal: one connected synthetic journey through every feature, its record, and what it found (Task R) |
| [desktop-browser-check.md](desktop-browser-check.md) | Task 203 manual Windows/Edge desktop verification: synthetic workflows, application text size and browser zoom, demo-banner finding F1, screenshot evidence, and coverage limits |

Elsewhere in the repository:

- The README at the repository root covers setup, configuration, running,
  tests, and the API in detail.
- [`db/README.md`](../db/README.md) covers the schema design's migrations
  001 to 003: run order, required `sqlcmd` flags, checks, and what to do if
  a run fails partway. [`db/AUDIT_VERIFICATION.md`](../db/AUDIT_VERIFICATION.md)
  covers the audit rules.

- [Task C: current Program information](task-c-program-information.md): scope, reconciliation, and storage-independent interface.
