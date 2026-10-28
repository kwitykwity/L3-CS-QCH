# Status report: review changes requested on PR #70 and PR #71

Date: 2026-10-28
Status: **Not started. Blocked on missing requirements documents.**

## Summary

Changes were requested on PR #70 (Task FF, branch `TaskFF`, head `5b40c56`) and
PR #71 (Task GG, branch `TaskGG`, head `3827e50`). No fixes have been made to
either PR. No tests were run, so there is no tested SHA or result to report.

## Blocker

Both reviews cite the **Frozen Handoff PRD** (§§7, 27–30, 35–36), the **Handoff
MVP** (§§25, 26, 32, 33) and the **Current Handoff Wireframes** as the
requirements source of truth.

- None of these documents is in the repository. They were searched for on
  `main`, `TaskFF` and `origin/TaskGG`.
- The document supplied with the task is the October 14 Final Technical PRD
  (25 sections, Azure SQL). PR #71's review says that document is historical and
  must not redefine current requirements. It has no §§27–36, and it conflicts
  with the review's statement that SharePoint Lists and Azure Functions are the
  planned architecture.

Without the frozen documents it is not possible to determine what §35 permits for
tracked file types, which DEFECT rows have frozen support, or how the MVP §33
classifications apply.

## Planned work once unblocked

### PR #70 (`TaskFF`)
1. Exercise both Direct and GPME-assisted submissions, or narrow the "full journey" claim.
2. Verify reset after an authorized demo sign-in, or mark the scenario unverified.
3. Test language reset across edits and restarts, or narrow the documentation.
4. Narrow the tracked-file-type ban to what PRD §35 prohibits.
5. Replace "No real participant data: Pass" with the specific safeguards and inspection evidence.
6. Wait explicitly, with a timeout, for asynchronous notification outcomes before asserting captured logs.
7. Rerun the focused demo tests and the full Node suite; report the tested SHA and results.

### PR #71 (`TaskGG`)
1. Re-base the audit on the frozen PRD, then the Handoff MVP and wireframes.
2. Correct the production-architecture rows; separate confirmed decisions from provisioning and verification gaps.
3. Remove external AI from pending MVP claims (PRD §7, MVP §26).
4. Reassess every DEFECT row against a specific frozen requirement.
5. Apply the MVP §33 classifications; an open PR is not an approved deferral.
6. Require passing execution evidence, with the tested revision and limitations, for VERIFIED status.
7. Update the traceability guard to cover the frozen PRD and MVP acceptance gates.
8. Rerun the documentation and traceability tests; report the tested SHA and results.

## Needed to proceed

Either the Frozen Handoff PRD, Handoff MVP and wireframes, or confirmation that
the October 14 Final Technical PRD should be used instead. The PR #70 test fixes
that do not depend on PRD §35 (items 1–3, 5 and 6) can start immediately if approved.
