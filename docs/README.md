# QCH Connect documentation

Deployment and handoff documentation (Card 18; Final Technical PRD 18 and
19). These files describe how QCH will run and own QCH Connect.

**Status: draft, not yet exercised.** Nothing here has been run against
QCH's Azure environment. Production deployment, the operational
documentation, and handoff acceptance are all unfinished.

These files must not contain real configuration values, secrets, or QCH
internal data. `test/docs.test.js` checks them for a few known secret and
identifier patterns. That is a limited guard against obvious mistakes, not
proof that the documents contain no secrets; reviewers still check by eye.

| File | What it covers |
| --- | --- |
| [deployment.md](deployment.md) | Step-by-step production deployment, verification, and recovery |
| [qch-it-requirements.md](qch-it-requirements.md) | Everything QCH IT needs to provide, and which part of the app needs it |
| [handoff-checklist.md](handoff-checklist.md) | Every handoff deliverable, where it lives, and what it waits on |
| [dependencies.md](dependencies.md) | Direct dependencies and how to list every license |

Elsewhere in the repository:

- The README at the repository root covers setup, configuration, running,
  and tests.
- [`db/README.md`](../db/README.md) covers database migrations 001 and 002
  (merged in PR #4): run order, required `sqlcmd` flags, and what to do if a
  run fails partway. Migration 003 (GPME matching states) is in review in
  PR #15 and is not part of the documented schema until it merges.

Still to come, once its dependency is met: the Data Dictionary, admin
instructions, backup and restore, troubleshooting, and monitoring guidance.
The handoff checklist tracks each one.
