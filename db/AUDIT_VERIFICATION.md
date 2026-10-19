# Referral audit verification (Trello Card 4)

Source of truth: QCH_Connect_Final_Tech_PRD_Oct14_2026.docx.
This document records verification coverage; it does not change requirements.

## Existing implementation

- PR #4: audit schema, actor, action, entity, UTC timestamp, before/after JSON, and append-only trigger.
- PR #8: transactional creation auditing, retry deduplication, rollback, and sensitive-data protections.
- PR #11: transactional response auditing, authorization, and concurrency protections.
- Existing application tests: test/referral.test.js and test/referralResponse.test.js.

## Repeatable SQL check

Run db/checks/referral_audit.sql against an isolated synthetic test database
with migration 001 applied. Do not rerun migrations on an existing database.

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

## Remaining acceptance dependencies

- PR #14 outcome/correction auditing remains pending review and merge.
  This change does not duplicate those lifecycle operations.
- Corrections must preserve necessary prior values in protected history.
  Sensitive revision history must remain separate from operational logs.
- Azure SQL application persistence, transaction/concurrency behavior,
  and runtime database permissions still require integration verification.
- Zero-row checks verify trigger enforcement, not populated-row history
  preservation, application atomicity, or privileged schema changes.

Card 4 is not fully complete while lifecycle audit dependencies remain open.
