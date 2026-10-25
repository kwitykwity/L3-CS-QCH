# Referral audit verification (Trello Card 4)

Source of truth: QCH_Connect_Final_Tech_PRD_Oct14_2026.docx.
This document records verification coverage; it does not change requirements.

## Existing implementation

- PR #4: audit schema, actor, action, entity, UTC timestamp, before/after JSON, and append-only trigger.
- PR #8: transactional creation auditing, retry deduplication, rollback, and sensitive-data protections.
- PR #11: transactional response auditing, authorization, and concurrency protections.
- PR #14: service outcome and correction auditing (SERVICE_OUTCOME_RECORDED,
  CORRECTED). A correction that changes or clears the Not Appropriate
  explanation keeps the prior text in that CORRECTED event's before_json,
  as the schema's audit rule allows; it never reaches responses or logs.
- PRs #21, #22, #24, #25 (Card 14): Program, Department, configurable
  field, option, and field value auditing (PROGRAM, DEPARTMENT, FIELD,
  FIELD_OPTION, PROGRAM_FIELD).
- PR #32 (Card 14): matching-facts saves (PROGRAM UPDATED).
- Staff affiliation changes (Card 2): USER UPDATED.
- Existing application tests: test/referral.test.js, test/referralResponse.test.js,
  test/serviceOutcome.test.js, and the Program Management suites.

## Audit rules checked in every test (application side)

The in-memory stores check every audit event against
src/referrals/auditRules.js before accepting it. The rules come in two
kinds, and each refusal says which (`kind` is `SQL` or `APP`):

**SQL rules**, the dbo.audit_events constraints as written in
001_core_schema.sql:

- entity_type in the ck_audit_entity list; action in the ck_audit_action list
- entity_id an integer (BIGINT NOT NULL)
- actor_user_id an existing user (fk_audit_actor)
- correlation_id at most 64 characters (NVARCHAR(64))
- before_json and after_json NULL, or JSON that ISJSON accepts
  (ck_audit_*_json). This is judged on the serialized text, so a value
  that serializes to a lone string, number or boolean is refused. Example:
  a JavaScript Date at the top level becomes a quoted string, which ISJSON
  refuses.

**APP rules**, stricter than SQL on purpose (Azure SQL would accept these):

- entity_id positive (SQL has no CHECK on entity_id; every audited key
  comes from an IDENTITY(1,1) column)
- before_json and after_json a JSON object (ISJSON also accepts an array)

A refusal of either kind throws, so the whole change rolls back, as a
refused INSERT would in SQL. test/auditRules.test.js reads
001_core_schema.sql and fails if the SQL lists drift from the CHECK
constraints, or if SQL adds an entity_id CHECK (then that rule should move
to the SQL kind).

**What this does not prove.** These tests show that every audit event the
application writes today passes the schema rules as written. They do not
prove that Azure SQL accepts, stores or rolls back those events. That
needs the integration verification listed below.

## Coverage test

test/auditCoverage.test.js walks every action that changes stored data
(referral create, respond, outcome, both corrections, retry; affiliation;
Program update, matching facts, discontinue, reactivate, create, move; field create,
apply, value, required/order, rename, replace, discontinue, reactivate,
retire; option create, rename, discontinue, reactivate; Department
create, rename, discontinue, reactivate). Each must write exactly its
expected events with the right actor, correlation ID, and UTC timestamp.
A retried referral submission writes no second event. No audit event may
contain participant name, contact, or referral context.

Audit event kinds written today (26): DEPARTMENT CREATED, RENAMED,
DISCONTINUED, REACTIVATED; FIELD CREATED, RENAMED, REPLACED, DISCONTINUED,
REACTIVATED, RETIRED; FIELD_OPTION CREATED, RENAMED, DISCONTINUED,
REACTIVATED; PROGRAM CREATED, UPDATED, DISCONTINUED, REACTIVATED;
PROGRAM_FIELD CREATED, UPDATED; REFERRAL CREATED, ACCEPTED,
NOT_APPROPRIATE, SERVICE_OUTCOME_RECORDED, CORRECTED; USER UPDATED.

## Repeatable SQL check

Run db/checks/referral_audit.sql against an isolated synthetic test database
after migrations 001, 002, and 003 have been applied.
Do not rerun migrations on an existing database.

Run this trigger check using a test administrator identity.
A restricted runtime identity may receive permission error 229 before the
trigger runs. That denial is expected permission enforcement, not evidence
that the trigger failed. Verify runtime permissions separately.

Command:
sqlcmd -S <server> -d <test-database> <auth flags> -I -b -i db/checks/referral_audit.sql

The script verifies that the append-only trigger is enabled and that
zero-row UPDATE and DELETE statements raise error 51000.
No stored rows are inserted, updated, or deleted.
Unexpected errors propagate; sqlcmd -b returns a nonzero exit code.

Expected output:
PASS: audit UPDATE blocked
PASS: audit DELETE blocked
PASS: audit append-only checks completed

## Validation record

2026-10-19: Christina Ruiz ran the check against the local SQL Server 2022
container qch-sql-test, database qch_pr15_validation.
All three PASS messages were returned.

## Remaining integration items (not application code)

- Resolved: PR #14 outcome/correction auditing merged (41416e0). Prior
  values, including a changed explanation, are kept in protected audit
  history and stay out of responses and logs.
- Azure SQL application persistence, transaction/concurrency behavior,
  and runtime database permissions still require verification against
  the QCH Azure SQL database (QCH IT access).
- Zero-row checks verify trigger enforcement, not populated-row history
  preservation, application atomicity, or privileged schema changes.

All application-side lifecycle auditing is implemented and covered. The
items above are integration verification, tracked with the Azure SQL
store work.
