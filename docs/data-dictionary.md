# Data Dictionary

**Status: draft.** Part of the handoff documentation. It does not complete production deployment, restore verification, or QCH handoff acceptance.

Every table and column in the team's current SQL schema design:
[`db/migrations/`](../db/migrations/) 001 (core schema), 002 (reference
data) and 003 (GPME matching states), in that order.

**Read this first.** This is the schema **design**, not a running
database. It is **not the production store**: production data lives in
SharePoint Lists in a private QCH Connect site, with no separate database
(Frozen Handoff PRD §27; see
[production-architecture.md](production-architecture.md)). The Lists must
not store exact age, age range, or unnecessary discovery or interpretation
inputs (PRD §28).
The application runs on in-memory stores that follow the same rules. If
the storage decision changes, this page still describes the information
the application keeps and the rules it depends on.

Conventions used in every table:

- Times are UTC (`DATETIME2(3)`, set with `SYSUTCDATETIME()`).
- `lifecycle_status` is `ACTIVE`, `DISCONTINUED` or `RETIRED`. Records are
  discontinued or retired, not deleted, so history stays readable.
- `row_version` (`ROWVERSION`) changes on every update. The application
  sends it back as `version` to detect "someone else changed this" (PRD
  9.4).
- "Sensitive" columns are never logged, reported or put in notifications
  (PRD 5.4).

## Organization

### departments

QCH's Departments. Migration 002 adds four, with shortened names that
still need QCH's confirmation.

| Column | Type | Meaning |
| --- | --- | --- |
| `department_id` | INT, key | Identifier |
| `name` | NVARCHAR(200), unique | Department name |
| `lifecycle_status` | NVARCHAR(20) | A Department with active Programs cannot be discontinued |
| `created_at`, `updated_at` | DATETIME2 | When created and last changed |
| `row_version` | ROWVERSION | Change detection |

### programs

One row per Program (and site). Programs are loaded from QCH's internal
Program Directory, which is never committed to this repository (PRD 4.5).

| Column | Type | Meaning |
| --- | --- | --- |
| `program_id` | INT, key | Identifier |
| `department_id` | INT → departments | Current Department. Past referrals keep the Department they had (see referrals) |
| `name`, `site` | NVARCHAR(200) | Name and site; the pair is unique |
| `description`, `eligibility_notes`, `schedule_notes` | NVARCHAR(MAX) | Common Program information, edited in Program Management |
| `cost_notes` | NVARCHAR(1000) | Cost information |
| `age_min`, `age_max` | TINYINT | Age limit used by guided matching when `age_limit_state` is `SET` (`age_min` ≤ `age_max`) |
| `grades` | NVARCHAR(50) | Grades served. Not used by the application yet |
| `enrollment_type`, `referral_path` | NVARCHAR | Team classifications with no allowed-value list until QCH confirms its vocabulary. Not used by the application yet |
| `notification_email` | NVARCHAR(320) | Where new-referral emails go. Read on the server only; never sent to a browser (PRD 11.3). No screen sets it yet |
| `age_limit_state` | NVARCHAR(20) (003) | `SET`, `NO_RESTRICTION`, `NOT_ON_FILE` (default) or `OTHER_LIMIT`. Missing information is never treated as "no limit" (PRD 8.10) |
| `service_area_state` | NVARCHAR(20) (003) | Same four values, for where participants must live |
| `lifecycle_status` | NVARCHAR(20) | A discontinued Program drops out of new referral choices; past referrals keep it |
| `created_at`, `updated_at`, `row_version` | | As above |

### service_categories and program_service_categories

The need categories used by guided matching ("Childcare", "Housing", ...).
No QCH-provided list exists yet, so production has none; the synthetic dev
seed has samples. A Program with no rows here has its need "not on file".

| Table | Column | Meaning |
| --- | --- | --- |
| `service_categories` | `service_category_id`, `name` (unique), `lifecycle_status` | A need category |
| `program_service_categories` | `program_id`, `service_category_id` (together the key) | Which needs a Program serves |

### service_languages and program_service_languages

Added by 004 (Task W). Languages of service, the same shape as need
categories. No QCH-provided list exists yet, so production has none; the
synthetic dev seed has Kyle's three examples (English, Spanish, Chinese) as
samples only. A Program with no rows here has its languages "not on file",
never "English only". Matching (rule `gpme-v1`) does not read these tables;
Find a Program shows the languages to staff.

| Table | Column | Meaning |
| --- | --- | --- |
| `service_languages` | `language_id`, `name` (unique), `lifecycle_status` | A language of service |
| `program_service_languages` | `program_id`, `language_id` (together the key) | Which languages a Program serves in |

### program_service_area_zips

Renamed from `program_zip_codes` by 003. ZIP codes where a participant
must **live** to be served; not where the Program runs (that is
`programs.site`). Rows exist only when `service_area_state` is `SET`; the
application enforces that rule, because SQL cannot check it across tables.

| Column | Type | Meaning |
| --- | --- | --- |
| `program_id` | INT → programs | Program |
| `zip_code` | CHAR(5), five digits | ZIP code |

## Configurable Program fields

Extra information a Program can carry beyond the common columns (PRD 4.2,
4.3). A field's identity follows its **meaning**: a wording change keeps
`field_id`; a meaning change discontinues the field and creates a new one.

### field_definitions

| Column | Type | Meaning |
| --- | --- | --- |
| `field_id` | INT, key | Identifier |
| `field_key` | NVARCHAR(100), unique | Stable key, generated by the application |
| `label` | NVARCHAR(200) | The wording staff see |
| `applies_to` | NVARCHAR(20) | `PROGRAM_INFO` (used today) or `REFERRAL_FORM` (extra referral questions, not used yet) |
| `data_type` | NVARCHAR(20) | `TEXT`, `NUMBER`, `DATE`, `BOOLEAN`, `SINGLE_SELECT` or `MULTI_SELECT` |
| `lifecycle_status` | NVARCHAR(20) | Retiring is allowed 90 days after discontinuing (the team's implementation decision, not confirmed QCH policy) and deletes nothing |
| `replaced_by_field_id` | INT → field_definitions | The new field that replaced this one, when its meaning changed |
| `discontinued_at`, `retired_at`, `created_at` | DATETIME2 | Lifecycle times |
| `row_version` | ROWVERSION | Change detection |

### field_options

Choices for `SINGLE_SELECT` and `MULTI_SELECT` fields.

| Column | Type | Meaning |
| --- | --- | --- |
| `option_id` | INT, key | Identifier |
| `field_id` | INT → field_definitions | The field it belongs to |
| `label` | NVARCHAR(200) | The wording staff see |
| `display_order` | INT | Order on screen |
| `lifecycle_status`, `row_version` | | A discontinued option can stay on a saved answer but cannot be chosen again |

### program_field_applicability

Which fields a Program uses. The same field can be shared by several
Programs, with its own settings in each.

| Column | Type | Meaning |
| --- | --- | --- |
| `program_id`, `field_id` | together the key | Program and field |
| `is_required` | BIT | Whether this Program must have a value |
| `display_order` | INT | Order on this Program's screen |
| `row_version` | ROWVERSION | Changes with each value or setting change for this Program |

### program_field_values

A Program's answers. Exactly one value column is filled per row; a
multi-select answer is one row per chosen option.

| Column | Type | Meaning |
| --- | --- | --- |
| `value_id` | INT, key | Identifier |
| `program_id`, `field_id` | | Program and field |
| `option_id` | INT | The chosen option; must belong to the same field |
| `value_text` | NVARCHAR(2000) | Text answer |
| `value_number` | DECIMAL(18,4) | Number answer |
| `value_date` | DATE | Date answer |
| `value_bool` | BIT | Yes or no answer |
| `updated_at`, `row_version` | | When last changed |

### referral_field_values

Answers to extra referral-form questions, kept with the field and option
they were collected under. Same value columns as `program_field_values`,
keyed by `referral_id`. **Not used by the application yet.**

## People and permissions

### users

| Column | Type | Meaning |
| --- | --- | --- |
| `user_id` | INT, key | Identifier |
| `entra_object_id` | UNIQUEIDENTIFIER | The person's Entra ID object, once sign-in exists. Unique when present |
| `display_name`, `email` | NVARCHAR | Name and email (email unique) |
| `current_program_id` | INT → programs | The Program the person sends referrals from, chosen by them. Empty until chosen; sending fails closed while it is empty. Changing it never changes past referrals |
| `is_demo_user` | BIT | Demo-only person; must never exist in production, and cannot have an Entra ID |
| `is_active` | BIT | An inactive person can do nothing |
| `created_at`, `row_version` | | |

### user_grants

What each person may do (PRD 3.6). Granted and removed inside QCH Connect
by designated administrators (PRD 3.8); no screen does this yet.

| Column | Type | Meaning |
| --- | --- | --- |
| `grant_id` | INT, key | Identifier |
| `user_id` | INT → users | Who |
| `permission` | NVARCHAR(40) | One of the PRD 3.6 capabilities; see [architecture.md](architecture.md#who-may-do-what) |
| `scope_type` | NVARCHAR(20) | `ORG`, `DEPARTMENT` (with `department_id`) or `PROGRAM` (with `program_id`) |
| `department_id`, `program_id` | INT | The scope's Department or Program |
| `grant_source` | NVARCHAR(20) | `IN_APP` (real) or `DEMO` (non-production only) |
| `granted_at`, `revoked_at` | DATETIME2 | A grant counts while `revoked_at` is empty |

`CREATE_REFERRAL` and `VIEW_AGGREGATE_REPORTING` are not stored here: every
person with app access has them.

## Referrals

### not_appropriate_reasons

The standard reasons a receiving Program picks when a referral is Not
Appropriate. Migration 002 adds five (Program criteria not met; Program
currently unavailable; Program not appropriate for identified need; Unable
to proceed with referral; Other), written by the team and authorized by
QCH.

| Column | Type | Meaning |
| --- | --- | --- |
| `reason_id` | INT, key | Identifier |
| `code` | NVARCHAR(50), unique | Stable code |
| `label` | NVARCHAR(200) | Wording staff see |
| `requires_explanation` | BIT | Whether an explanation must be written (0 for all five today) |
| `display_order`, `lifecycle_status` | | |

### referrals

One row per referral. Response, Decision and Service Outcome are three
separate columns; there is no "closed" status. The stage shown on screen
is worked out from them (`src/referrals/stage.js`). Referrals cannot be
deleted (a trigger blocks it); mistakes are fixed with audited corrections.

| Column | Type | Meaning |
| --- | --- | --- |
| `referral_id` | BIGINT, key | Identifier |
| `submission_id` | UNIQUEIDENTIFIER, unique | Random ID the browser makes, so a retried send never creates a second referral (PRD 7.3) |
| `source` | NVARCHAR(20) | `DIRECT` or `GPME_ASSISTED` |
| `gpme_evaluation_id` | BIGINT → gpme_evaluations | The matching result it came from (`GPME_ASSISTED` only) |
| `created_by_user_id` | INT → users | Who sent it |
| `referring_program_id`, `receiving_program_id` | INT → programs | From and to. Never change |
| `referring_department_id`, `receiving_department_id` | INT → departments | The Departments at the time it was sent. Reports group by these, so moving a Program later does not move its history |
| `participant_name` | NVARCHAR(200) | Sensitive. No date of birth, SSN or address is collected |
| `contact_method` | NVARCHAR(20) | `PHONE_CALL`, `PHONE_TEXT`, `EMAIL` or `NOT_AVAILABLE` |
| `contact_value` | NVARCHAR(320) | Sensitive. Empty exactly when the method is `NOT_AVAILABLE` |
| `participant_zip` | CHAR(5) | Optional |
| `referral_context` | NVARCHAR(4000) | Sensitive: what the person needs |
| `notes` | NVARCHAR(4000) | Sensitive, optional |
| `response_status` | NVARCHAR(20) | `AWAITING_RESPONSE` or `RESPONDED` |
| `decision` | NVARCHAR(20) | Empty while awaiting; then `ACCEPTED` or `NOT_APPROPRIATE` |
| `service_outcome` | NVARCHAR(30) | `NOT_RECORDED`, `RESULTED_IN_SERVICE` or `DID_NOT_RESULT_IN_SERVICE`. Only an accepted referral can have one |
| `not_appropriate_reason_id` | INT → not_appropriate_reasons | Required when Not Appropriate; empty otherwise |
| `not_appropriate_explanation` | NVARCHAR(1000) | Sensitive, optional; only with Not Appropriate |
| `responded_by_user_id`, `outcome_recorded_by_user_id` | INT → users | Who responded and who recorded the outcome |
| `created_at` | DATETIME2 | When sent |
| `first_responded_at`, `first_resulted_in_service_at` | DATETIME2 | Set once; corrections never rewrite them, so timing reports stay honest (PRD 12.4) |
| `outcome_recorded_at` | DATETIME2 | When the current outcome was recorded |
| `updated_at`, `row_version` | | Change detection |

The database itself checks the combinations: awaiting has no decision;
responded always has one; Not Appropriate needs a reason; an outcome needs
Accepted; times never come before `created_at`.

## Guided Program Matching

Matching **inputs** (age, ZIP, needs) are never stored (PRD 5.3).
Explanations are written from Program facts, never from participant
answers.

| Table | Columns | Meaning |
| --- | --- | --- |
| `gpme_rule_versions` | `rule_version_id`, `version_label` (unique), `description`, `activated_at`, `retired_at` | Versions of the matching rules. None seeded yet; the code's rules are `gpme-v1` |
| `gpme_evaluations` | `evaluation_id`, `rule_version_id`, `evaluated_at` | One matching run that led to a referral |
| `gpme_evaluation_results` | `evaluation_id`, `program_id`, `display_order`, `explanation`, `program_context_json` (JSON), `was_selected` | Each Program shown, why, the Program facts at that time, and which one the worker chose |

## Notifications and audit

### notification_deliveries

One row per "new referral" email. No message body, recipient address or
participant data is stored.

| Column | Type | Meaning |
| --- | --- | --- |
| `delivery_id` | BIGINT, key | Identifier |
| `referral_id` | BIGINT → referrals | The referral |
| `notification_type` | NVARCHAR(30) | `NEW_REFERRAL`. One per referral and type |
| `status` | NVARCHAR(10) | `PENDING`, `SENT` or `FAILED` |
| `attempt_count`, `last_attempt_at`, `sent_at` | | Retry bookkeeping |
| `failure_category` | NVARCHAR(100) | A category such as throttled or timeout; never message content |
| `correlation_id` | NVARCHAR(64) | Links to logs |
| `created_at`, `row_version` | | |

### audit_events

Append-only history of every change (PRD 6.5, 9.6), written in the same
transaction as the change. A trigger blocks updates and deletes.

| Column | Type | Meaning |
| --- | --- | --- |
| `audit_event_id` | BIGINT, key | Identifier |
| `entity_type` | NVARCHAR(30) | `REFERRAL`, `PROGRAM`, `DEPARTMENT`, `FIELD`, `FIELD_OPTION`, `PROGRAM_FIELD`, `USER`, `USER_GRANT`, `REASON` or `GPME_RULE` |
| `entity_id` | BIGINT | Which record |
| `action` | NVARCHAR(40) | `CREATED`, `UPDATED`, `RENAMED`, `ACCEPTED`, `NOT_APPROPRIATE`, `SERVICE_OUTCOME_RECORDED`, `CORRECTED`, `DISCONTINUED`, `REACTIVATED`, `RETIRED`, `REPLACED`, `GRANTED`, `REVOKED` or `ACTIVATED` |
| `actor_user_id` | INT → users | Who did it |
| `occurred_at` | DATETIME2 | When |
| `before_json`, `after_json` | NVARCHAR(MAX), JSON | The values before and after, kept to the minimum. Participant data is copied only when that field is the thing being corrected (the Not Appropriate explanation) |
| `correlation_id` | NVARCHAR(64) | Links to the request's logs |

What the application writes today, and the rules each event must pass,
are in [`db/AUDIT_VERIFICATION.md`](../db/AUDIT_VERIFICATION.md).
