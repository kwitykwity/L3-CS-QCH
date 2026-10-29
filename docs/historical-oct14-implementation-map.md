# Historical implementation map (Oct 14, 2026 Final Technical PRD)

**Status: historical reference. Not a requirements document and not a verified
conclusion.** This page keeps the earlier Task GG audit, which mapped the
October 14, 2026 Final Technical PRD to the code. The October 14 PRD is the
historical implementation baseline. The governing requirements are the **Frozen
Handoff PRD** (October 28, 2026), then the **Handoff MVP**, then the **Current
Handoff Wireframes**. The current audit is
[prd-traceability.md](prd-traceability.md).

How to use this page:

- The "PRD" section numbers below are Oct 14 Final Technical PRD sections, not
  Handoff PRD sections.
- The status words here (`tested`, `built`, `waits-on-qch`, `not-on-main`,
  `gap-vs-oct14`) describe the code as of `main` at `cd22455` against the Oct 14
  PRD. They are deliberately not the Handoff MVP 33 classifications, and a
  `tested` row here is not a `VERIFIED` conclusion: that needs a Handoff
  requirement and an executed, recorded test run.
- Use the "Where built" and "Evidence" columns to find code and tests. Do not use
  the status column to decide what QCH requires.
- Where the Handoff PRD supersedes this page, the Handoff PRD wins. In
  particular: SharePoint Lists and Azure Functions are the confirmed planned
  production architecture (Handoff PRD 27 to 30), so rows here that call the
  data store or hosting "pending" or assume Azure SQL are out of date; and no
  external AI integration belongs to the delivered MVP (Handoff PRD 7), so the
  AI row (R5) is not a pending dependency. The disposition of each Oct 14
  finding is in [prd-traceability.md](prd-traceability.md#historical-findings-and-what-the-frozen-prd-says-about-them).

## 1. System overview and architecture

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-1.1 | Browser web app: HTML/CSS/JS front end, Node.js JSON API (1.3) | `src/app.js`, `public/` | `test/server.test.js`, `e2e/mvpJourney.spec.js` | `tested` | |
| T-1.2 | Azure SQL Database is the authoritative store (1.3, 9.2) | Design only: `db/migrations/001_core_schema.sql` to `004_language_of_service.sql`. The app runs on in-memory stores (`src/referrals/memoryReferralStore.js`, `src/affiliation/memoryStore.js`) | `docs/pending-qch-it-decisions.md` | `waits-on-qch` | Pending decision 1 and register R19: SharePoint Lists or Azure SQL. The SQL has not been run in QCH's environment |
| T-1.3 | Entra ID SSO and MFA (1.4, 3.1) | `resolveIdentity` seam in `src/app.js`; no Entra code | `test/securityPass.test.js` (production answers 401 without sign-in) | `waits-on-qch` | Pending decision 5, register R22. The fail-closed behavior is verified in T-3.1 |
| T-1.4 | Azure App Service hosting (1.4) | `npm start` (`src/server.js`) runs on any Node host | `docs/deployment.md` | `waits-on-qch` | Pending decision 2, register R20 |
| T-1.5 | Secrets in Key Vault, never in source (1.4, 15.2) | No code reads a secret. `.env.example` holds placeholders only | `test/envExample.test.js`, `test/docs.test.js` | `waits-on-qch` | Key Vault setup is QCH IT's. Placeholders-only is verified; nothing real has been wired |
| T-1.6 | Notifications through Microsoft Graph and a QCH shared mailbox (1.4, 11.1) | Simulated outbox only: `src/notifications/simulatedOutbox.js` | `test/notifications.test.js` | `waits-on-qch` | Pending decision 6, register R23. No Graph sender exists |
| T-1.7 | Azure Monitor and Application Insights (1.4, 15.3) | None. Log lines carry IDs only (see T-15.3) | `docs/operations.md` | `waits-on-qch` | Pending decision 2 |

## 2. Product boundary and workflows

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-2.1 | Two entry paths: Guided (GPME) and Direct (2.1) | `public/referral/guided.js`, `public/referral/app.js` | `e2e/directReferral.spec.js`, `e2e/gpme.spec.js`, `test/regression/workflowJourneys.test.js` | `tested` | |
| T-2.2 | Both paths use one pipeline; source kept as DIRECT or GPME_ASSISTED (2.2) | `src/referrals/referralService.js` | `test/referral.test.js`, `test/gpmeReferral.test.js` | `tested` | |
| T-2.3 | Receiving Program owns the response; no automatic reroute; no response stays Awaiting Response (2.3) | `src/referrals/responseService.js` | `test/referralResponse.test.js`, `test/regression/journeys.test.js` | `tested` | |
| T-2.4 | Receiving Program records Resulted in Service (2.4) | `src/referrals/outcomeService.js` | `test/serviceOutcome.test.js` | `tested` | |

## 3. Identity, authorization and access

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-3.1 | Identity is server-derived; client user IDs, roles and headers never count (3.2) | `src/app.js` (`resolveIdentity`), `src/server.js` | `test/securityPass.test.js`, `test/regression/securityRegression.test.js` | `tested` | Where sign-in comes from is T-1.3 |
| T-3.2 | Every protected action checks current authorization; an ID or URL grants nothing (3.3) | `src/authorization/referralAccess.js` | `test/securityPass.test.js`, `docs/security-regression.md` | `tested` | Route inventory test fails if a route is added without coverage |
| T-3.3 | Any user may create; creator and authorized receivers may view (3.4) | `src/referrals/referralQueryService.js`, `src/authorization/referralAccess.js` | `test/receivingQueue.test.js`, `test/regression/securityRegression.test.js` | `tested` | |
| T-3.4 | Any signed-in user sees aggregate reporting only (3.5) | `src/reporting/routes.js` | `test/securityPass.test.js` ("reporting is aggregate only"), `e2e/reportingKnownAnswers.spec.js` | `tested` | |
| T-3.5 | Capability matrix (3.6): VIEW_RECEIVED, RESPOND, UPDATE_RECEIVED, RECORD_OUTCOME, CORRECT_OUTCOME, MANAGE_PROGRAM, MANAGE_ORGANIZATION | `src/authorization/referralAccess.js`, `src/programs/programService.js`, `src/programs/organizationService.js` | `test/securityPass.test.js`, `test/programManagement.test.js`, `test/programOrganization.test.js` | `tested` | CREATE_REFERRAL, VIEW_AGGREGATE_REPORTING and VIEW_CREATED_REFERRAL are enforced as "signed-in user" and "creator", not as named grants. Same behavior as the PRD table |
| T-3.6 | ADMINISTER_PERMISSIONS and in-app grant and revoke (3.6, 3.8) | Not on `main`. Open PR #63 (Task Y) adds the Permissions screen and `/api/permissions` | None on `main`. PR #63 carries its own tests; Task CC (branch `jimmy/task-cc-permission-security`) tests it | `not-on-main` | Task V rated this BLOCKS FREEZE until a decision is recorded. Which people are the first administrators, and break-glass access, are QCH's to name (3.8) |
| T-3.7 | Frontend shows read-only when the user can view but not edit (3.7) | `public/receiving/`, `public/program-management/` (server sends `permissions`) | `e2e/receivingLifecycle.spec.js`, `e2e/sentReferrals.spec.js` | `tested` | Backend remains authoritative (T-3.2) |
| T-3.8 | Referring Program is the staff member's selected affiliation; fails closed; history not rewritten (3.9) | `src/affiliation/affiliationService.js`, `src/referrals/referralService.js` | `test/affiliation.test.js`, `test/securityPass.test.js` | `tested` | Production passes `allowDemoGrants: false` (`src/server.js`) |

## 4. Program directory and management

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-4.1 | Authorized staff maintain Program information in the app (4.1) | `src/programs/programService.js`, `public/program-management/` | `test/programManagement.test.js`, `e2e/programManagement.spec.js` | `tested` | |
| T-4.2 | Common attributes plus Program-specific fields; core fields not removable (4.2) | `src/programs/fieldService.js`, `src/gpme/programFacts.js` | `test/programFields.test.js`, `test/gpme.test.js` | `tested` | Age and service area carry the four states (set, no restriction, not on file, other limit), not N/A / Not Listed / Unknown wording; the meaning matches |
| T-4.3 | Field identity follows meaning; lifecycle; retire after about three months; audit (4.3) | `src/programs/fieldService.js` (`RETIRE_AFTER_DAYS = 90`) | `test/programFields.test.js`, `test/programFieldValues.test.js`, `e2e/fieldValues.spec.js` | `tested` | 90 days is a recorded team decision, not QCH's |
| T-4.4 | Program and Department lifecycle; a Department with active Programs cannot be discontinued (4.4) | `src/programs/organizationService.js` | `test/programOrganization.test.js`, `e2e/organization.spec.js` | `tested` | Department names: register R24, QCH-IT |
| T-4.5 | Program Directory is never committed (4.5, 19.3) | `.gitignore` (`*.xlsx`, `*Program_Directory*`, `data/private/`) | `docs/freeze-audit.md` (manual scan of every commit on `main`) | `built` | Documentation evidence only. A test that fails if a data file is tracked is in open PR #70 (Task FF) and not on `main`; this row becomes `tested` when it merges |
| T-4.6 | Real QCH Program data loaded for production (4.5) | Seed is synthetic: `scripts/syntheticSeed.js`, `db/seeds/dev_synthetic_seed.sql` | `docs/pending-qch-it-decisions.md` | `not-on-main` | Handoff step. Depends on the store (T-1.2) and QCH supplying the data privately |

## 5. Referral data and privacy

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-5.1 | Referral-centered; no permanent participant profile (5.1) | `src/referrals/memoryReferralStore.js`, `db/migrations/001_core_schema.sql` | `test/referral.test.js` | `tested` | |
| T-5.2 | Only the approved minimal fields; no DOB, SSN or address (5.2, 21) | `src/referrals/validateReferral.js` (`ALLOWED_FIELDS`) | `test/referral.test.js`, `test/securityPass.test.js` (unexpected fields refused) | `tested` | |
| T-5.3 | Matching inputs are not persisted or echoed (5.3) | `src/gpme/gpmeService.js` | `test/securityPass.test.js` ("GPME never echoes, stores or logs the matching answers") | `tested` | |
| T-5.4 | Referral Context and Notes stay out of logs, reports, search and notifications (5.4) | `src/notifications/content.js`, `src/errorHandler.js` | `test/securityPass.test.js` (lifecycle writes no participant data to any console channel), `test/notifications.test.js`, `test/errorHandler.test.js` | `tested` | |
| T-5.5 | Notes support safe bold and italic (5.4, 14.6) | `public/referral/index.html` has a plain `<textarea>`; `src/referrals/validateReferral.js` cleans plain text | None | `gap-vs-oct14` | Plain text is safe, but no bold or italic is offered or kept. No document mentioned this before the audit. Team decides: build it, or record the deferral and tell QCH (PRD 20.4) |
| T-5.6 | No sensitive data in URLs, browser storage, caches or the console (5.5) | `public/referral/textSize.js` (the only stored value is text size), `src/app.js` (`Cache-Control: no-store`) | `test/securityPass.test.js`, `e2e/directReferral.spec.js`, `e2e/gpme.spec.js`, `test/referralUi.test.js` | `tested` | Receiving, Sent, Reporting and Program Management are checked only by the Task DD tests in open PR #68 |

## 6. Referral lifecycle, status and outcome

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-6.1 | Response, Decision and Service Outcome are separate; transition matrix (6.1, 6.2) | `src/referrals/stage.js`, `responseService.js`, `outcomeService.js` | `test/referralResponse.test.js`, `test/serviceOutcome.test.js`, `test/regression/journeys.test.js` | `tested` | |
| T-6.2 | The server holds state; the browser never advances it (6.4, 13.3) | `src/referrals/routes.js` | `test/referralResponse.test.js`, `e2e/receiving.spec.js` | `tested` | |
| T-6.3 | Authorized corrections, prior value kept in audit; Not Appropriate cannot receive an outcome until corrected (6.5) | `src/referrals/outcomeService.js`, `src/referrals/auditRules.js` | `test/serviceOutcome.test.js`, `test/auditCoverage.test.js`, `test/auditRules.test.js` | `tested` | |
| T-6.4 | Not Appropriate needs a standard reason; free text is optional and sensitive (6.5) | `src/referrals/responseService.js` | `test/referralResponse.test.js`, `e2e/receiving.spec.js` | `tested` | |
| T-6.5 | The reason list is configurable by QCH later (6.5) | Reasons are reference data read from the store (`GET /api/referrals/not-appropriate-reasons`; `db/migrations/002_reference_data.sql`) | `test/referralResponse.test.js` (reads the list) | `built` | No screen or route edits the list; today a change is a data change. Whether data-level is enough is the team's call; not a QCH IT item |

## 7. Submission, idempotency and recovery

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-7.1 | Deliberate submit, control disabled, "Sending referral ..." (7.1) | `public/referral/app.js` | `test/referralUi.test.js`, `e2e/screenReader.spec.js` | `tested` | |
| T-7.2 | Success is shown only after server confirmation (7.2) | `public/referral/submission.js` | `test/referralUi.test.js`, `test/regression/journeys.test.js` | `tested` | |
| T-7.3 | One Referral per Submission ID, including concurrent requests (7.3) | `src/referrals/referralService.js` | `test/referral.test.js`, `test/regression/journeys.test.js` | `tested` | The database uniqueness constraint is proved only by the SQL design, not a running database |
| T-7.4 | The four recovery messages, with the space before "!" (7.4) | `public/referral/submission.js` | `test/referralUi.test.js`, `test/referral.test.js`, `test/regression/journeys.test.js` | `tested` | |
| T-7.5 | Recoverable errors keep the worker's input (7.5) | `public/referral/app.js` | `e2e/gpme.spec.js`, `test/regression/journeys.test.js` | `tested` | |
| T-7.6 | Warn before leaving unsaved referral or Program-edit work (7.6) | `beforeunload` in `public/referral/app.js` and the Program Management pages | `e2e/programManagementJourneys.spec.js`, `e2e/programManagement.spec.js`, `e2e/fieldValues.spec.js` | `built` | The Program-edit warning is tested. The referral form's warning has no test (no spec or test mentions it); the runbook shows it only by hand |

## 8. Guided Program Matching Engine

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-8.1 | Deterministic, server-side, advisory; creates nothing (8.1, 8.4) | `src/gpme/matchPrograms.js`, `src/gpme/gpmeService.js` | `test/gpme.test.js` (100 runs identical; ties keep one order, no score) | `tested` | |
| T-8.2 | Only approved structured criteria; no hidden factors (8.2) | `src/gpme/validateMatchRequest.js`, `matchPrograms.js` | `test/gpme.test.js`, `test/securityPass.test.js` | `tested` | |
| T-8.3 | Unavailable optional criteria (ZIP) do not block matching (8.3) | `src/gpme/matchPrograms.js` | `test/gpme.test.js`, `e2e/gpme.spec.js` | `tested` | |
| T-8.4 | "No plausible match" is distinct from "Unable to perform matching" (8.5, 8.8) | `public/referral/guided.js`, `src/gpme/errors.js` | `e2e/gpme.spec.js`, `test/gpmeUi.test.js` | `tested` | |
| T-8.5 | Concise explanations, no scores or eligibility claims (8.6) | `src/gpme/matchPrograms.js` | `test/gpme.test.js`, `test/gpmeUi.test.js` | `tested` | |
| T-8.6 | Rule version IDs; the evaluation context is kept with a GPME referral (8.7, 9.1) | `src/referrals/referralService.js` (`insertGpmeEvaluation`), `db/migrations/001_core_schema.sql` | `test/gpmeReferral.test.js` | `tested` | Against the in-memory store |
| T-8.7 | Direct Referral works when matching fails (8.8) | `public/referral/guided.js` | `e2e/gpme.spec.js`, `docs/demo-runbook.md` section 6 | `tested` | |
| T-8.8 | Missing Program facts never read as "no restriction" or "unsuitable" (8.10) | `src/gpme/programFacts.js`, `db/migrations/003_gpme_matching_states.sql` | `test/gpme.test.js`, `test/gpmeProgramManagement.test.js` | `tested` | |
| T-8.9 | Material rule changes need regression tests before activation (8.9) | `src/gpme/matchPrograms.js` (`gpme-v1`) | `test/gpme.test.js`, `test/programMatching.test.js` | `tested` | Process rule; the tests exist for the current version |

## 9. Database architecture

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-9.1 | Stable IDs, historical context, no participant master (9.1) | `db/migrations/001_core_schema.sql`, `docs/data-dictionary.md` | `test/referral.test.js`, `test/programManagement.test.js` | `built` | Design plus in-memory proof. Not run on Azure SQL (T-1.2) |
| T-9.2 | Referral configurable values keep their field identity (9.1) | Not built: referrals collect no Program-specific values (`ALLOWED_FIELDS` in `src/referrals/validateReferral.js`) | None | `not-on-main` | No confirmed QCH requirement collects Program-specific values on a referral. Task C's fields are Program information shown to staff. Team to confirm in the Oct 30 revision |
| T-9.3 | Referral creation and status changes commit with their audit event; notification outside the transaction (9.3) | `src/referrals/referralService.js`, `src/referrals/memoryReferralStore.js` | `test/gpmeReferral.test.js`, `test/auditRules.test.js`, `test/notificationWiring.test.js` | `built` | Proved against the in-memory store's transaction contract only. A real database must be shown to meet it (decision 1) |
| T-9.4 | Optimistic concurrency; stale updates rejected (9.4, 13.4) | `src/referrals/outcomeService.js`, `src/programs/programService.js` | `test/serviceOutcome.test.js`, `test/programFields.test.js`, `e2e/receivingLifecycle.spec.js` | `tested` | |
| T-9.5 | Append-only audit history with actor, action, UTC time (9.6) | `src/referrals/auditRules.js`, `db/checks/referral_audit.sql` | `test/auditCoverage.test.js`, `test/auditRules.test.js` | `built` | The in-memory rules are tested. The append-only trigger in SQL has never been run in CI or on QCH's database; see `db/AUDIT_VERIFICATION.md` |
| T-9.6 | Timestamps stored in UTC, shown in the business time zone, never fixed UTC-5 (9.7) | Reports use `America/New_York` (`src/reporting/periods.js`, `public/reporting/format.js`). `public/receiving/common.js` formats with the viewer's own browser time zone | `test/referralActivity.test.js`, `test/reportingUi.test.js` (reports only) | `gap-vs-oct14` | Sent and Received lists show the browser's time zone, reports show New York. The PRD says one QCH-approved business time zone; no record shows QCH approved New York, so that choice is also the team's assumption to confirm |
| T-9.7 | Schema reproducible from migrations; never changed at startup (9.8) | `db/migrations/`, `db/README.md` | `docs/deployment.md` | `waits-on-qch` | The app does no schema work at startup. Migration-history handling waits on decision 1 |
| T-9.8 | Parameterized SQL, bounded pooling, safe retries (9.9) | None: no database driver in use | None | `waits-on-qch` | Applies once a database exists (decision 1) |
| T-9.9 | Historical imports with provenance, dry-run, no live side effects (9.10) | Not built | None | `not-on-main` | PRD says "may be imported when trustworthy". No validated historical data has been supplied |
| T-9.10 | Retention and purge (9.11) | Nothing is purged; committed referrals are never hard-deleted | `docs/pending-qch-it-decisions.md` | `waits-on-qch` | Pending decisions 4 and 8; register R25. The PRD forbids inventing a policy |
| T-9.11 | Health checks show availability only, with no secrets or internals (9.12, 15.3) | `GET /health` in `src/app.js` returns `{ status: "ok" }` | `test/health.test.js` | `tested` | Covers the app only. A database or dependency readiness check cannot exist yet (decision 1); see T-15.4 |

## 10. API and backend

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-10.1 | Backend enforces identity, authorization, validation and business rules (10.1) | `src/*/routes.js`, services | `test/securityPass.test.js`, `test/regression/securityRegression.test.js` | `tested` | |
| T-10.2 | Allowlisted inputs; client cannot set server fields (10.3) | `src/referrals/validateReferral.js`, `src/programs/validate*.js` | `test/securityPass.test.js` | `tested` | |
| T-10.3 | Predictable statuses; errors leak nothing (10.4) | `src/errorHandler.js` | `test/errorHandler.test.js` | `tested` | |
| T-10.4 | Minimum-necessary output (10.5) | Services return named fields | `test/securityPass.test.js`, `test/regression/securityRegression.test.js` | `tested` | Spot-checked by the route tests, not an exhaustive field audit |
| T-10.5 | Correlation IDs across browser, Node, SQL, Graph and Application Insights (10.6) | A correlation ID links a request to its audit event (`src/referrals/routes.js`, `src/programs/routes.js`) | `test/notificationWiring.test.js` | `built` | No per-request header and no Application Insights link (T-1.7) |
| T-10.6 | Server-side size bounds (10.7) | `src/referrals/validateReferral.js` (`LIMITS`) | `test/referral.test.js` | `tested` | Exact limits are an engineering decision (PRD 22) |

## 11. Notifications

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-11.1 | Generic notification content; no PII in subject or body (11.2) | `src/notifications/content.js` | `test/notifications.test.js` | `tested` | |
| T-11.2 | Recipients come from the server's Program data, never the browser (11.3) | `src/notifications/notificationService.js` | `test/notifications.test.js`, `test/notificationWiring.test.js` | `tested` | |
| T-11.3 | Notify only after commit; failure never undoes the referral (11.4, 11.6) | `src/referrals/routes.js`, `src/notifications/` | `test/notificationWiring.test.js` | `tested` | |
| T-11.4 | Pending, Sent, Failed delivery state; bounded duplicate-safe retry (11.5, 11.6) | `src/notifications/memoryDeliveryStore.js`, `retryTimer.js` | `test/notifications.test.js` | `tested` | |
| T-11.5 | Notification failures surface in monitoring (11.6) | Safe log lines with IDs and category only | `test/notificationWiring.test.js` | `waits-on-qch` | The Application Insights half waits on decision 2. The log content is verified |
| T-11.6 | A Program has a notification address to send to (11.3, 9.1) | Seed data only. No screen or route sets it (`src/programs/routes.js` never exposes routing) | `docs/freeze-audit.md` finding 6 | `gap-vs-oct14` | A Program created in the app gets no recipient, so its emails fail with `NO_RECIPIENT`; the referral still saves. Task V filed this as a QCH IT item, but nothing here waits on QCH IT. It has no card |

## 12. Reporting

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-12.1 | One Reporting Center, open to every signed-in user (12.1) | `public/reporting/`, `src/reporting/routes.js` | `test/reportingUi.test.js`, `e2e/reportingKnownAnswers.spec.js` | `tested` | |
| T-12.2 | Weekly, Monthly, Quarterly and Yearly sections in one report, with several periods and same-level comparisons (12.1, CLIENT CONFIRMED) | Not built. The screen shows one period at a time (`public/reporting/index.html`, `src/reporting/routes.js` takes one `period` and one `date`) | None | `gap-vs-oct14` | No document recorded this gap. PRD 20.4 says the MVP is never silently reduced: the team must build it, or record a decision and tell QCH and Pursuit |
| T-12.3 | Period definitions: Sunday to Saturday weeks, fiscal year Jul 1 to Jun 30, fiscal quarters (12.2) | `src/reporting/periods.js` | `test/referralActivity.test.js`, `test/regression/reportingJourney.test.js` | `tested` | |
| T-12.4 | P0 metrics and exact definitions, including N/A for zero denominators (12.3, 12.4) | `src/reporting/referralActivityService.js`, `timingMetrics.js`, `reportingService.js` | `test/totalReferrals.test.js`, `test/referralActivity.test.js`, `test/timingMetrics.test.js`, `e2e/reportingKnownAnswers.spec.js` | `tested` | |
| T-12.5 | Department reporting, with historical Department context (12.4, 3.5) | `src/reporting/referralActivityService.js`, `GET /api/reports/departments` | `test/reportingDepartments.test.js`, `e2e/reportingDepartments.spec.js` | `tested` | |
| T-12.6 | Metrics are computed on the server, once, as one result (12.5, 12.7) | `src/reporting/` | `test/referralActivity.test.js`, `test/reportingUi.test.js` | `tested` | |
| T-12.7 | Zero, No Data, Unknown and Pending are distinct (12.6) | `src/reporting/timingMetrics.js`, `public/reporting/format.js` | `test/timingMetrics.test.js`, `e2e/reportingKnownAnswers.spec.js` | `tested` | |
| T-12.8 | Aggregate only; no drill-down; no small-number suppression (12.7, CLIENT CONFIRMED) | No drill-down route exists | `test/securityPass.test.js`, `e2e/reportingKnownAnswers.spec.js` | `tested` | |
| T-12.9 | Visible filters, data-as-of, partial-period warning, metric help, numerator and denominator (12.8) | `public/reporting/index.html`, `app.js` | `test/reportingUi.test.js` | `tested` | |
| T-12.10 | Trend views with change and percentage, and lifecycle changes beside referral activity (12.8) | Not built | None | `not-on-main` | PRD wording is "may". It follows from T-12.2, so decide both together |
| T-12.11 | Browser print or Save as PDF, and an Excel-compatible aggregate export (12.9) | None. The browser's own print works; there is no print stylesheet and no export | None | `gap-vs-oct14` | PRD says "where implemented" for the export, but print and export are listed as MVP and no document records a deferral |
| T-12.12 | Saved reports, geographic and forecast views, shared templates (12.10, 12.11) | Not built | None | `not-on-main` | P1 and future-ready; the PRD says they stay disabled unless approved |

## 13 and 14. Frontend, accessibility and interaction

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-13.1 | Visible in-progress states; duplicate execution prevented per action (13.2) | `public/referral/app.js`, `public/receiving/` | `test/referralUi.test.js`, `e2e/receiving.spec.js` | `tested` | |
| T-13.2 | Stale data is explained and reviewed, never merged (13.4) | `public/receiving/detail.js` | `e2e/receivingLifecycle.spec.js` | `tested` | |
| T-13.3 | Shallow, task-oriented navigation (13.5) | `public/index.html` | `e2e/mvpJourney.spec.js` | `tested` | The home link reads "Make a Direct Referral" though the page also offers guided matching (Task V finding 5, a label only) |
| T-13.4 | Confirmation only before consequential actions (13.6) | `public/receiving/detail.js` | `e2e/receiving.spec.js` | `tested` | |
| T-14.1 | WCAG 2.2 AA is the team's target, tested practically (14.1, 17.7) | `public/` | `test/regression/accessibility.test.js`, `e2e/screenReader.spec.js`, `docs/screen-reader-check.md` | `tested` | Automated checks plus a recorded VoiceOver run (Oct 24 to 25). A final pass is open PR #69 (Task BB). Not claimed as a client-confirmed standard |
| T-14.2 | Logical Tab order, visible focus, keyboard-only completion (14.2) | `public/styles.css`, `public/referral/referral.css` | `test/regression/accessibility.test.js`, `e2e/directReferral.spec.js` | `tested` | |
| T-14.3 | Undo and Redo on editable fields; never reverses a submission (14.2) | The browser's native behavior in text fields; no custom code | None | `built` | Native and not tested. Nothing in the app can reverse a submission |
| T-14.4 | Required fields marked `*` with the required text; focus moves to the first invalid field (14.3) | `public/referral/validation.js` | `test/regression/accessibility.test.js`, `e2e/directReferral.spec.js` | `tested` | |
| T-14.5 | Persistent labels; programmatic names and states (14.4) | `public/` | `test/regression/accessibility.test.js`, `e2e/screenReader.spec.js` | `tested` | |
| T-14.6 | Text size S 12px, M 14px, L 18px, XL 24px; work preserved (14.5) | `public/referral/textSize.js` | `test/regression/accessibility.test.js`, `e2e/gpme.spec.js` | `tested` | |
| T-14.7 | No sideways scroll at XL on a phone-width screen (14.5, Task V finding 4) | `public/referral/referral.css` | `e2e/gpme.spec.js` (`test.fixme`, skipped) | `gap-vs-oct14` | Open issues #46 and #51. The fix and its test are in open PR #69 (Task BB) |

## 15 to 18. Security, demo, testing and deployment

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-15.1 | TLS 1.2 or higher, encrypted at rest, private database access (15.1) | None in this repository | `docs/qch-it-requirements.md` | `waits-on-qch` | Azure configuration, owned by QCH IT |
| T-15.2 | Logs hold no PII, notes, secrets or raw payloads (15.3, 15.4) | `src/errorHandler.js`, `src/notifications/notificationService.js` | `test/securityPass.test.js`, `test/errorHandler.test.js` | `tested` | |
| T-15.3 | Demo and test work uses synthetic data only (15.5) | `scripts/syntheticSeed.js` | `test/demoEnvironment.test.js`, `test/receivingSeed.test.js` | `tested` | |
| T-15.4 | Health and readiness show application, database and dependency availability (15.3, 23) | `GET /health` reports the application only | `test/health.test.js` | `waits-on-qch` | The database and dependency half cannot exist until the store is chosen (decision 1) |
| T-16.1 | Demo sign-in is team-only, labelled, and unavailable in production (16.1, 17.4) | `scripts/demoSignIn.js`, `scripts/demoPersonas.js` | `test/demoSignIn.test.js`, `test/securityPass.test.js` | `tested` | |
| T-16.2 | Synthetic seed and reset are environment-guarded and fail closed (16.2, 17.4) | `scripts/dev-synthetic-server.js` | `test/demoEnvironment.test.js`, `test/securityPass.test.js` | `tested` | |
| T-16.3 | QCH preview uses QCH Entra identities where practical (16.3) | None | None | `waits-on-qch` | Needs Entra (decision 5) |
| T-16.4 | Plan B demo: synthetic people, labelled sign-in, simulated outbox (16.4) | `scripts/dev-demo-server.js` | `test/demoSignIn.test.js`, `docs/demo-environment.md` | `tested` | |
| T-17.1 | End-to-end tests prove each critical journey "across frontend, backend and Azure SQL" (17.2) | `e2e/`, `test/regression/` | `e2e/mvpJourney.spec.js`, `e2e/receivingLifecycle.spec.js`, `e2e/reportingKnownAnswers.spec.js` | `waits-on-qch` | The journeys run on the in-memory store. "Across Azure SQL" needs the store (decision 1) |
| T-17.2 | Authorization tests include manipulated IDs, filters and payloads (17.3) | `test/securityPass.test.js` | `test/securityPass.test.js`, `test/regression/securityRegression.test.js` | `tested` | |
| T-17.3 | Production-safety tests: demo sign-in and reset rejected, unknown environments fail closed (17.4) | `src/config.js`, `src/server.js` | `test/securityPass.test.js`, `test/config.test.js`, `test/demoSignIn.test.js` | `tested` | |
| T-17.4 | Submission and recovery tests (17.5) | `src/referrals/referralService.js` | `test/referral.test.js`, `test/notificationWiring.test.js`, `test/regression/journeys.test.js` | `tested` | |
| T-17.5 | Reporting known-answer tests (17.6) | `src/reporting/` | `test/regression/reportingJourney.test.js`, `test/timingMetrics.test.js`, `e2e/reportingKnownAnswers.spec.js` | `tested` | Covers the single-period report that exists (see T-12.2) |
| T-18.1 | Dev, demo and production are technically separated (18.1) | `src/config.js`, `scripts/` | `test/securityPass.test.js`, `test/demoSignIn.test.js` | `tested` | |
| T-18.2 | Repeatable, documented production deployment (18.2) | `docs/deployment.md` | `docs/deployment.md` | `waits-on-qch` | Tooling is QCH IT's (PRD 22). Draft, not exercised in QCH's environment |
| T-18.3 | Controlled migrations; no schema change at startup (18.3) | `db/migrations/` | `db/README.md` | `waits-on-qch` | Waits on decision 1 |
| T-18.4 | Post-deployment verification and recovery (18.4) | `docs/operations.md`, `docs/deployment.md` | `docs/operations.md` | `waits-on-qch` | Procedures are written as drafts; none has run on QCH's hosting |
| T-18.5 | Startup validates environment, Entra, Azure SQL and secrets; fails closed (18.5) | `src/config.js` (checks `NODE_ENV` and `PORT`) | `test/config.test.js`, `test/runtime.test.js` | `waits-on-qch` | The Entra, SQL and secret checks cannot exist until those do (decisions 1, 2 and 5). What exists fails closed and is tested |

## 19 to 23. Handoff, priorities and acceptance

| ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| T-19.1 | Source code in a QCH-owned repository at handoff (19.3) | This repository during development | `docs/handoff-checklist.md` | `waits-on-qch` | QCH IT names the location |
| T-19.2 | Deployment, environment, data dictionary, admin, troubleshooting, dependency and operations documents (19.2) | `docs/` | `test/docs.test.js` (secret patterns only) | `not-on-main` | All are drafts. `docs/admin-guide.md` still lacks permission administration (T-3.6) and Program notification email (T-11.6) |
| T-19.3 | Backup, restore and recovery procedures (19.2) | `docs/operations.md` (concepts only). No backup and restore document exists | None | `not-on-main` | Handoff step, waiting on the store and hosting (decisions 1 and 2) |
| T-19.4 | One restore exercised in an isolated, QCH-approved context before acceptance (19.5, 23) | Not started | None | `waits-on-qch` | A gap plan cannot replace it (PRD 19.5) |
| T-19.5 | QCH owns credentials and access; no team member's personal account (19.4) | None in this repository | `docs/handoff-checklist.md` | `waits-on-qch` | QCH IT must confirm it can rotate credentials and remove team access (PRD 19.4). Open checklist items |
| T-19.6 | Knowledge transfer and handoff acceptance (19.5, 19.6) | Not started | `docs/handoff-checklist.md` | `not-on-main` | Target Nov. 10 (PRD 20.2) |
| T-20.1 | Priority and non-goals respected: no Salesforce, no external AI, no maps, no forecasting, no participant bulk export (20, 21) | None built | `test/securityPass.test.js` (aggregate only), `test/gpmeInterpretation.test.js` (no outside call) | `tested` | Absence is proved for AI and bulk export. Salesforce, maps and forecasting are absent by inspection |

## Newer confirmed QCH requirements

Mapped from [requirements-reconciliation-register.md](requirements-reconciliation-register.md).
That page is the controlled record; this table only adds the audit's
verification of what `main` does today.

| Register ID | Requirement | Where built | Evidence | Status | Note |
| --- | --- | --- | --- | --- | --- |
| R1, R2 | Describe the need in words; show the reading for the worker to correct before matching | `src/gpme/interpretation/`, `public/referral/guided.js` | `test/gpmeInterpretation.test.js`, `e2e/gpme.spec.js` | `tested` | PR #43 merged (`f3905cb`). The register still says "In review"; corrected in this PR |
| R3, R4 | How free text fits PRD 8.2; everyday age words | `src/gpme/interpretation/ruleBasedInterpreter.js`, `docs/gpme-description-step-prd-8-2.md` | `test/gpmeInterpretation.test.js` | `not-on-main` | The code is merged. The two team decisions are still unrecorded; record them in the Oct 30 revision |
| R5 | Approved AI or language-processing service | Rules only, no AI | `docs/ai-interpretation-options.md` | `waits-on-qch` | Pending decision 7 |
| R6 | Need is the most important factor | `src/gpme/matchPrograms.js` | `test/gpme.test.js` | `tested` | |
| R7 | Language of service, several per Program | `db/migrations/004_language_of_service.sql`, `src/programs/`, `src/gpme/gpmeService.js` | `test/languageOfService.test.js`, `e2e/languageOfService.spec.js` | `tested` | Shown, not used to match, per Task W. Which languages QCH lists is a QCH decision (R7) |
| R8, R14 | Full or wait-listed Programs still appear with status; contact shown with a prompt to refer through the app | Not on `main`. Open PR #64 (Task X) shows current Program information in Find a Program | None on `main` | `not-on-main` | Never removed from results, but the status and contact are not shown until #64 merges. Confirmed by QCH on Oct 26, so this needs a recorded scope decision if #64 does not land before the freeze |
| R9 | No participant waitlist system | None built | `docs/task-c-program-information.md` | `built` | Nothing was built, which is the requirement. No test proves an absence; a search of `db/migrations/` and `src/` found no waitlist table or route |
| R10 | Add and remove Programs as contracts change | `src/programs/programService.js` | `test/programManagement.test.js`, `test/programOrganization.test.js` | `tested` | "Remove" is met by discontinue and retire (PRD 4.4) |
| R11 | Mix of standard and flexible fields | `src/programs/fieldService.js` | `test/programFields.test.js` | `tested` | |
| R12 | "Program Description" and "Important Information About Our Program" as flexible text | `src/programs/programService.js` (description); the second is not a named field | `test/currentProgramInformation.test.js` | `gap-vs-oct14` | Confirmed by QCH on Oct 26 and only half built. Task C's "Current Program information" label is demo data, not a standard field |
| R13 | Multiple locations: separate listings, or one shared listing | Separate listings work (site is part of a Program). A shared listing is only free text | `test/programFieldValues.test.js` | `gap-vs-oct14` | Confirmed by QCH on Oct 26. Both options were requested |
| R15, R16 | "No match found" lets staff revise or use Direct Referral; no automatic Family Support | `public/referral/guided.js` | `e2e/gpme.spec.js`, `test/gpmeUi.test.js` | `tested` | |
| R17, R18 | Improve through Program information and rule versions; missing information is never "no restriction" | `src/gpme/matchPrograms.js`, `src/gpme/programFacts.js` | `test/gpme.test.js`, `test/programMatching.test.js` | `tested` | |
| R19 to R25 | Data store, hosting, SharePoint access, Entra, Graph, Department names, retention | None built | `docs/pending-qch-it-decisions.md` | `waits-on-qch` | All still open. R24 (Department names) is QCH's, not QCH IT's |

## Gaps measured against the Oct 14 PRD (historical)

These rows were gaps measured against the Oct 14 Final Technical PRD. They are **not** current
requirements. Which of them survive in the frozen Handoff PRD is decided in
[prd-traceability.md](prd-traceability.md); several do not (see its "Historical findings" section).

| # | Row | Gap | Found before this audit? |
| --- | --- | --- | --- |
| 1 | T-12.2 | Reporting Center takes one period at a time; no multi-period or comparison | **No.** No document mentioned it |
| 2 | T-12.11 | No print layout and no aggregate export | **No** |
| 3 | T-5.5 | Notes do not support bold or italic | **No** |
| 4 | T-9.6 | Lists show the browser's time zone; reports show New York; the business time zone is unconfirmed | **No** |
| 5 | T-11.6 | No way to set a Program's notification address | Yes, Task V finding 6, but classed as a QCH IT item |
| 6 | T-14.7 | XL text on a phone-width screen scrolls sideways | Yes, issues #46 and #51; fix in PR #69 |
| 7 | R12 | "Important Information About Our Program" is not a standard field | Yes, Task V finding 8 |
| 8 | R13 | A shared multi-location listing is only free text | Yes, Task V finding 8 |

Also worth deciding, but not `gap-vs-oct14`: T-3.6 (permission administration, PR #63,
the item Task V rated BLOCKS FREEZE), T-8 and R8/R14 (PR #64), and T-9.2.

## Documentation corrections

Statements that were wrong on `main` at `cd22455`, checked against the merge
history:

| Document | Said | Reality | Action |
| --- | --- | --- | --- |
| `requirements-reconciliation-register.md` R1, R2, R4 | "No. In review as PR #43" | Merged as `f3905cb` | Corrected in this PR |
| `pending-qch-it-decisions.md` gaps table | Demo sign-in is engineering work; describe-the-need is in review; language of service is not built | Task O (#60), PR #43 and Task W (#62) are merged | Corrected in this PR |
| `README.md` "Not built yet" | Demo sign-in "in progress" | Merged (#60) | Corrected in this PR |
| `demo-runbook.md` sections 2 and 7 (L1, L4) | One person plays every role; describe-the-need not on `main` | `npm run dev:demo` adds three people and describe-the-need is merged | Not changed: Task T owns the runbook; the team must decide what the Nov. 9 demo shows |
| `freeze-audit.md` findings 2 and 3 | PR #43 and Task O unmerged | Both merged | Not changed: it is a dated record of `36f6e82`; Task V's "re-run on the freeze candidate" updates it |
