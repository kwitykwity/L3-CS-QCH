# QCH Connect documentation

Deployment and handoff documentation (Card 18; Final Technical PRD 18 and
19). These files describe how QCH will run and own QCH Connect. They hold no
real configuration values, secrets, or QCH internal data.

| File | What it covers |
| --- | --- |
| [deployment.md](deployment.md) | Step-by-step production deployment, verification, and recovery |
| [qch-it-requirements.md](qch-it-requirements.md) | Everything QCH IT needs to provide, and which part of the app needs it |
| [handoff-checklist.md](handoff-checklist.md) | Every handoff deliverable, where it lives, and what it waits on |
| [dependencies.md](dependencies.md) | Direct dependencies and how to list every license |

Elsewhere in the repository:

- The README at the repository root covers setup, configuration, running,
  and tests.
- `db/README.md` covers database migrations. It arrives when PR #4 merges.

Still to come, once its dependency is met: the Data Dictionary, admin
instructions, backup and restore, troubleshooting, and monitoring guidance.
The handoff checklist tracks each one.
