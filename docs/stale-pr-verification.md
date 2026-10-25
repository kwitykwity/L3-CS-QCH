# Security dependency update and stale pull requests (Task P)

**Status: complete for engineering.** Checked against `main` at `81c91fe`
on October 25, 2026. Each security claim below is judged on code and
tests on `main`, not on a pull request's description.

## Summary

| Item | Result |
| --- | --- |
| Security dependency update (#35) | Reviewed, tested and merged on October 24, 2026. `npm audit` on `main`: 0 vulnerabilities |
| #17, transaction-authorization protection | **COVERED ON MAIN.** Closed without merging on October 20, 2026; nothing from it needs to be brought back |
| #29, reporting breadth | **Superseded** by #30 (merged October 21, 2026) and the reporting work since. Closed without merging on October 20, 2026 |

## 1. Security dependency update (#35)

[GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)
(high): `body-parser` 2.0.0 to 2.3.0 can be slowed down by trailing bytes
after a compressed request body (denial of service). Fixed in 2.4.0.

- #35 changed `package-lock.json` only: `body-parser` 2.3.0 to 2.4.0 and
  `qs` 6.16.0 to 6.16.1. `package.json` did not need to change, because
  Express 5.3.0 already allows `body-parser ^2.3.0`. No license changed.
- Reviewed and merged by the Team Lead on October 24, 2026. At review:
  `npm audit` 0 vulnerabilities (was 1 high), `npm test` 1,184 passed,
  `npm run test:e2e` 68 passed.
- Today on `main`: installed `body-parser` is 2.4.0 and `express` is
  5.3.0. `npm audit` reports 0 vulnerabilities. `npm test` passes in
  full (see "Verification" below).

## 2. #17: transaction-authorization protection

#17 ("Program management, reporting metrics, security sanitizer, and E2E
regression suite") combined six Trello cards. It was closed without
merging on October 20, 2026, so its work could be redone as focused pull
requests. The question for this task is whether its security protection
for Program changes is on `main`, so nothing was lost when it closed.

### What #17 claimed, and what review asked for

From the PR description and the Team Lead's eight review rounds
(October 18, 2026):

1. Program changes authorized by server-side capability, resource and
   scope, not role labels; active users only; a grant for one Program
   does not authorize another; `ADMINISTER_PERMISSIONS` alone does not
   authorize Program edits.
2. A Program move authorized for both the current and the destination
   scope.
3. Grant and active-user reads protected through commit, so a revocation
   or deactivation cannot slip in between the check and the write (a
   plain `SELECT` inside a transaction does not do this under Azure SQL's
   `READ_COMMITTED_SNAPSHOT`).
4. An explicit transaction-bound connection; no fallback to a
   non-transactional query.
5. The change and its audit event in one transaction; a failed audit rolls
   both back.
6. Stale-version rejection, and checking that the update really changed a
   row.
7. Logs that never carry sensitive referral fields, and error responses
   that never pass internal messages to the browser.

At its last review, #17 still had open findings on items 3, 4 and 6, and
its reporting queries had not been checked against SQL Server for a
populated cohort.

### Where each one is on `main`

| # | Protection | Code on `main` | Tests on `main` | Result |
| --- | --- | --- | --- | --- |
| 1 | Capability + resource + scope; active user; other Programs, revoked, DEMO (outside development/test), admin-only and wider-scope grants refused | `src/programs/programService.js` (`authorize`), `src/authorization/referralAccess.js` (`programIdsWithCapability`) | `test/programManagement.test.js`: the eight "refused: …" cases, "a DEMO grant works only when demo grants are explicitly allowed" | Covered |
| 2 | Program moves | `src/programs/organizationService.js`: moves need `MANAGE_ORGANIZATION` as an active **ORG**-scope grant, which covers both Departments by definition; Program- or Department-scope grants and `MANAGE_PROGRAM` do not count. The destination Department is held for update and must be `ACTIVE` | `test/programOrganization.test.js`: "only an ORG-scope MANAGE_ORGANIZATION grant counts", "move rules", "Department discontinue vs. moving a Program into it: the move waits, then is refused" | Covered (stricter than #17: one organization-wide capability instead of two Program-scope checks) |
| 3 | Grant and user reads held to commit | `tx.getUser` and `tx.getActiveGrants` are locking reads (`src/referrals/memoryReferralStore.js`). The store contract at the top of that file names the Azure SQL lock hints (`REPEATABLEREAD`, `UPDLOCK`) and explains why a plain `SELECT` is not enough under `READ_COMMITTED_SNAPSHOT` | `test/programManagement.test.js`: "a grant revoked during an edit waits for it", "an account deactivated during an edit waits for it, then is refused"; the same in `programOrganization.test.js` and `programFields.test.js` | Covered at the store contract (see the note below) |
| 4 | Transaction-bound connection, no fallback | Each service refuses to start without `store.withTransaction` (`requires a transactional store`); every change runs inside it. There is no generic query fallback | Every Program Management test runs through `withTransaction` | Covered |
| 5 | Change and audit in one transaction | Each change calls `tx.appendAuditEvent` inside the same `withTransaction`; a throw rolls everything back | `test/programManagement.test.js`: "if the audit write fails, the change rolls back and can be retried", "audit failure on discontinue: still ACTIVE, still selectable"; `test/auditRules.test.js`: "a refused audit event rolls back the whole transaction" | Covered |
| 6 | Stale versions and 0-row updates | Two layers: the service compares the version it read, and `updateProgram` is a single conditional update on the expected version that returns nothing (0 rows) if it moved | `test/programManagement.test.js`: "a stale version -> 409 PROGRAM_CHANGED …; nothing written", "two editors at the same moment with the same version: exactly one wins", "updateProgram writes nothing on a stale version (0 rows updated)" | Covered |
| 7 | Safe logs and error responses | `src/errorHandler.js`: only fixed, listed error names and codes are logged; the request path is reduced to its route pattern; responses use fixed messages. Nothing in `src/` logs a request body | `test/securityPass.test.js`: "a full referral lifecycle, including failures, writes no participant data to any console channel", "error responses never echo submitted values", "through the real app: a store error carrying participant text is logged safely, answered generically", the 4xx and after-response cases | Covered |

### Checked by breaking it on purpose

To show the tests guard these protections, rather than only mention them,
each protection was removed in a scratch copy and the tests were run
(nothing was committed):

| Removed | Tests that failed |
| --- | --- |
| The active-user check in `authorize` | 2 in the Program Management suites |
| The Program scope check (any `MANAGE_PROGRAM` grant accepted) | 2 |
| Grants as a locking read | The revocation race tests (1 failed; the suite then stopped waiting, 59 cancelled) |
| Rollback on audit failure (the audit error swallowed) | "if the audit write fails, the change rolls back and can be retried" |
| The version guard in `updateProgram` | "updateProgram writes nothing on a stale version (0 rows updated)" |

Removing only the service's own version comparison failed no test,
because the conditional update below it still refuses the stale change.
That is the second layer working as designed, and that layer has its own
test.

### Note: the production store

Item 3 depends on the production store taking the locks the contract
describes. There is no Azure SQL store on `main` yet; where data will live
is pending QCH IT decision 1. This is already on the re-run list in
[security-regression.md](security-regression.md) ("Production store"
rows): the same suites must pass, unchanged, against the production
store. #17 did not solve this either. Its last review found that its
in-transaction `SELECT`s did not hold locks under `READ_COMMITTED_SNAPSHOT`.

**Classification: COVERED ON MAIN.** Nothing from #17 needs to be
brought back. Its reporting and Program Management features were also
rebuilt in focused pull requests (Program maintenance #21, #22, #24, #25;
reporting #18, #26, #30).

## 3. #29: reporting breadth

#29 ("Card 12: P0 reporting breadth") was closed without merging on
October 20, 2026, in favor of a replacement built on the reporting
foundation in #18. The replacement is #30, "Referral activity report
(P0 reporting breadth), replaces #29", merged October 21, 2026.

| #29 feature | On `main` |
| --- | --- |
| America/New_York period bounds, half-open, DST-aware | `src/reporting/periods.js` (IANA zone rules, never a fixed offset); `test/totalReferrals.test.js` (the November 1 clock change), `test/timingMetrics.test.js` (elapsed time across a DST change) |
| Program or Department scope | `programId` / `departmentId` query parameters, allowlisted; unknown IDs refused (400); Department by the Department at creation. `test/regression/reportingJourney.test.js` (`KNOWN_SCOPES`) |
| Made and received counted separately | `src/reporting/referralActivityService.js` (`made` belongs to the sender, every other count to the receiver); `KNOWN_BREAKDOWNS` in `test/regression/reportingFixture.js` |
| Department totals from counts, not averaged Program rates | Department rows are built from counts, so rates are exact (Adult Services resulted-in-service 1 of 3 = 33.33%); Department made and received add up to the organization |
| Rates as `{ numerator, denominator, value, state }` with `CALCULATED`, `PENDING`, `NO_DATA` | Same shape on `main`; checked in the API journey and on screen (`e2e/reportingKnownAnswers.spec.js`, #50) |
| Required `VIEW_AGGREGATE_REPORTING` to see reports | **Not carried over, on purpose.** PRD 3.5 lets any active user see aggregate reports; this was one of the review's reasons for closing #29. `main` checks only that the user is active (`test/regression/reportingJourney.test.js`: "any active user sees the aggregate reports; inactive users do not") |

**Result: superseded.** Every useful part of #29 is on `main`, and the one
part that conflicted with the PRD is deliberately not.

## Verification

On `main` at `81c91fe`, October 25, 2026, Node 22.23.4 (the team's pinned
version is 24.15.0):

- `npm audit`: 0 vulnerabilities
- `npm test`: 1,402 passed, 0 failed
- No application code changed for this task
