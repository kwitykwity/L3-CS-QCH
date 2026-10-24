# QCH Connect documentation

Handoff documentation (Trello cards 18 and Task H; Final Technical PRD 18,
19 and 22). It describes the application **as it exists today** and keeps
production decisions that are still open with QCH IT separate.

**Status: draft, not yet exercised.** Nothing here has run in QCH's
environment. The application runs on in-memory stores with synthetic data.
Where production data will live (SharePoint Lists or a relational database
such as the Azure SQL design in `db/`), hosting, sign-in and email are open
decisions, listed in
[pending-qch-it-decisions.md](pending-qch-it-decisions.md).

These files must not contain real configuration values, secrets, or QCH
internal data. `test/docs.test.js` checks them for a few known secret and
identifier patterns. That is a limited guard against obvious mistakes, not
proof that the documents contain no secrets; reviewers still check by eye.

## Start here

| File | What it covers |
| --- | --- |
| [pending-qch-it-decisions.md](pending-qch-it-decisions.md) | **Pending QCH IT Architecture Decisions**, and which unfinished work is an engineering gap versus an outside dependency |
| [architecture.md](architecture.md) | How the application is built today: where it runs, folders, request flow, permissions, API, screens, tests |
| [data-dictionary.md](data-dictionary.md) | Every table and column in the current schema design |
| [admin-guide.md](admin-guide.md) | Program Management and organization tasks for administrators |
| [troubleshooting.md](troubleshooting.md) | Start-up problems, error codes, test problems, what is logged |
| [operations.md](operations.md) | Monitoring expectations, verification procedures, recovery concepts, known dependencies |
| [ai-interpretation-options.md](ai-interpretation-options.md) | Research only: three ways an open-ended "Find a Program" box could work, compared for pending decision 7 |

## Deployment and handoff

| File | What it covers |
| --- | --- |
| [deployment.md](deployment.md) | The release procedure in PRD 18.2 order, with QCH IT steps marked |
| [qch-it-requirements.md](qch-it-requirements.md) | Everything QCH IT needs to provide, and which part of the app needs it |
| [handoff-checklist.md](handoff-checklist.md) | Every handoff deliverable, where it lives, and what it waits on |
| [dependencies.md](dependencies.md) | Direct dependencies and how to list every license |
| [regression-coverage.md](regression-coverage.md) | Accessibility and end-to-end regression coverage, and the manual keyboard checklist |

Elsewhere in the repository:

- The README at the repository root covers setup, configuration, running,
  tests, and the API in detail.
- [`db/README.md`](../db/README.md) covers the schema design's migrations
  001 to 003: run order, required `sqlcmd` flags, checks, and what to do if
  a run fails partway. [`db/AUDIT_VERIFICATION.md`](../db/AUDIT_VERIFICATION.md)
  covers the audit rules.
