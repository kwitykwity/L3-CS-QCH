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
- Staff affiliation changes (Card 2): USER UPDATED.
- Existing application tests: test/referral.test.js, test/referralResponse.test.js,
  test/serviceOutcome.test.js, and the Program Management suites.

## Schema rules enforced in every test (application side)

The in-memory stores refuse any audit event the dbo.audit_events INSERT
would refuse in Azure SQL (src/referrals/auditRules.js):

- entity_type in the ck_audit_entity list; action in the ck_audit_action list
- entity_id a positive integer (NOT NULL)
- actor_user_id an existing user (fk_audit_actor)
- correlation_id at most 64 characters (NVARCHAR(64))
- before_json and after_json NULL or a JSON object (ck_audit_*_json)

A refusal throws, so the whole change rolls back, as in SQL. Because the
rule applies to every write, the full test suite also proves that every
audit event the application writes today would be accepted by Azure SQL.
test/auditRules.test.js reads 001_core_schema.sql and fails if the lists
ever drift from the CHECK constraints.

## Coverage test

test/auditCoverage.test.js walks every action that changes stored data
(referral create, respond, outcome, both corrections, retry; affiliation;
Program update, discontinue, reactivate, create, move; field create,
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
