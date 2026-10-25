# Operations: monitoring, verification and recovery

**Status: draft.** Part of the handoff documentation. It does not complete production deployment, restore verification, or QCH handoff acceptance.

What a person running QCH Connect needs to watch, check and know how to
recover, written for the application as it exists today. Hosting,
storage and alerting are not chosen yet
([pending-qch-it-decisions.md](pending-qch-it-decisions.md)), so this page
states **expectations and concepts**, not tool-specific steps. The
step-by-step release procedure is [deployment.md](deployment.md).

## Monitoring expectations

| Watch | Why | Available today |
| --- | --- | --- |
| `GET /health` answers `200 {"status":"ok"}` | The server process is up. It does not check the store, sign-in or email | Built |
| Store availability | Every action needs the store; `503 NOT_CONFIGURED` means none is configured | A readiness check is not built (depends on the storage decision) |
| `[error]` log lines | Unexpected failures. A rise means something is wrong | Built; no alerting yet |
| Notification final failures (`warn`, status `FAILED`) | A receiving Program may not know a referral arrived. The referral itself is safe | Built and called after each referral commits (simulated outbox in development); no alerting exists |
| Notifications stuck `PENDING` | Retries are not running | The retry timer exists (`src/notifications/retryTimer.js`) and runs in development; production wiring waits on the sender and store |
| Sign-in failures | Staff cannot open the app | Not built (Entra) |

Alerts belong in QCH's monitoring service (the earlier plan named Azure
Monitor and Application Insights). Logs never contain participant data, so
they can be sent there without exposing it.

## Verification procedures

Run these after any release or configuration change. Use synthetic data
only, never a real participant.

**Every time, today:**

1. `npm ci` and `npm test` on the exact commit being released: 0 failures.
2. `npm run test:e2e`: 0 failures (browser tests; needs Chromium).
3. Start the app; the log shows the listening line with the right
   environment, and `GET /health` returns `{"status":"ok"}`.

**Once each piece exists in production** (listed in
[deployment.md](deployment.md), step 5):

4. A QCH test account signs in through Entra ID.
5. The readiness check reports the store as available.
6. A synthetic referral to a QCH-approved test Program: it appears in that
   Program's received list; accept it, record an outcome, correct it; the
   sender sees the result; each step has one audit event.
7. One generic email arrives in the test Program's configured inbox, and
   its delivery row ends `SENT`.
8. Permission checks, two different refusals:
   - A staff member with **no access** to the referral (for example staff
     of an unrelated Program) gets **404** for reading it **and** for any
     change they send, the same answer as for a referral that does not
     exist, so nothing is revealed.
   - A staff member who **can view** the referral but lacks the action
     permission (for example view-only receiving staff) can read it but
     gets **403** for the change.

The manual keyboard and screen-reader checks are in
[regression-coverage.md](regression-coverage.md).

## Recovery concepts

These hold whatever store and hosting QCH IT chooses.

- **The server keeps no state of its own.** Restarting or redeploying it
  loses nothing; everything lives in the store. With the in-memory store
  (development and tests), everything is lost on restart by design.
- **Rolling back the app does not roll back the data.** An older version
  must work with whatever the newer version already changed in the store.
  If that is not certain, treat it as a data recovery with QCH IT (see
  [deployment.md](deployment.md), step 6).
- **Mistakes in referrals are corrected, not deleted.** Use the audited
  corrections (decision, outcome). Direct edits to stored data are not a
  normal fix; any exceptional correction must be authorized, documented
  and auditable (PRD 9.12).
- **Every change is all-or-nothing.** A change and its audit event commit
  together. A failed save leaves no half-written record, and the screens
  never retry a save on their own, so a dropped connection cannot
  duplicate a change.
- **Emails can be retried; referrals cannot be lost to email.** A failed
  notification never undoes a referral. Delivery is "at least once while
  attempts remain", so a duplicate generic email is possible and harmless.
- **Backups and restore** are QCH IT's, and depend on the storage
  decision. PRD 19.5 requires one successful restore in an isolated,
  QCH-approved environment before handoff.

## Known dependencies

| Dependency | Used for | Notes |
| --- | --- | --- |
| Node.js 24.15.0 | Running the server | Development pin; the production version is a QCH IT choice |
| Express 5 and `dotenv` | Web server and local configuration | See [dependencies.md](dependencies.md) for every package and license |
| Playwright with Chromium, axe-core, supertest | Tests only | Not installed in production (`npm ci --omit=dev`) |
| A production store | Everything stored | Not chosen (decision 1) |
| Microsoft Entra ID | Staff sign-in | Not built (decision 5) |
| Microsoft Graph and a shared mailbox | New-referral email | Not built (decision 6) |
| Hosting and monitoring | Running and watching the app | Not chosen (decision 2) |
