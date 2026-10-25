# Database migrations

This folder holds the proposed Azure SQL schema for QCH Connect. Nothing in
this folder creates an Azure resource.

**This is the team's current design, not a confirmed production store.**
Whether production data lives in a relational database like this or in
SharePoint Lists is still open with QCH IT (decision 1 in
[`docs/pending-qch-it-decisions.md`](../docs/pending-qch-it-decisions.md)).
The application today runs on in-memory stores and never connects to a
database. Every table and column is described in
[`docs/data-dictionary.md`](../docs/data-dictionary.md).

## Files

| File                                   | What it does                                          | Where it runs                      | Safe to run twice? |
| -------------------------------------- | ----------------------------------------------------- | ---------------------------------- | ------------------ |
| `db/migrations/001_core_schema.sql`    | Creates 19 tables, their indexes, and 2 triggers      | Every database                     | No                 |
| `db/migrations/002_reference_data.sql` | Adds the 4 departments and 5 Not Appropriate reasons  | Every database                     | No                 |
| `db/migrations/003_gpme_matching_states.sql` | Adds GPME age and service-area states; renames the ZIP table | Every database        | No                 |
| `db/seeds/dev_synthetic_seed.sql`      | Adds made-up service categories for dev and demos     | Development only, never production | Yes                |

## Run order

1. Run `001_core_schema.sql` first. 002 inserts into tables that 001 creates.
2. Run `002_reference_data.sql` second, and only after 001 finished with no
   errors.
3. Run `003_gpme_matching_states.sql` third, and only after 002 finished with
   no errors.
4. Run `dev_synthetic_seed.sql` last, only in development, and only after 003.

Run each migration one time per database, starting from an empty database.

## Command

```bash
sqlcmd -S <server> -d <database> <auth flags> -I -b -i db/migrations/001_core_schema.sql
sqlcmd -S <server> -d <database> <auth flags> -I -b -i db/migrations/002_reference_data.sql
sqlcmd -S <server> -d <database> <auth flags> -I -b -i db/migrations/003_gpme_matching_states.sql
```

For any QCH database, the server, database name, and sign-in details come from
QCH IT. Do not guess them. For local work, use your own local SQL Server
values.

### Why `-I` is required

`-I` turns on `QUOTED_IDENTIFIER`. sqlcmd leaves it off unless you pass `-I`.

001 creates three filtered indexes (indexes with a `WHERE` clause):

- `ux_users_entra_object_id`
- `ix_user_grants_active`
- `ux_referrals_gpme_evaluation`

SQL Server refuses to create a filtered index while `QUOTED_IDENTIFIER` is off.
It returns error 1934 and names `QUOTED_IDENTIFIER` as the wrong setting. If
you leave out `-I`, those indexes do not get created. Losing
`ux_users_entra_object_id` means the database would accept two users with the
same Entra ID.

### Why `-b` is required

`-b` makes sqlcmd stop at the first error and exit with a non-zero code.
Without it, sqlcmd prints the error and keeps running the rest of the file.
That leaves a half-built database that looks finished.

## If a migration fails partway

Neither migration runs inside a transaction. Each `GO` batch saves on its own,
so when one batch fails, every batch before it stays in the database.

Running the same file again will not fix this. 001 fails on the first table
that already exists. 002 fails on the unique rules for department name and
reason code.

What to do:

1. Stop. Do not run the next file.
2. Save the full error message and note which file failed.
3. Fix the cause. Common causes are a missing `-I`, the wrong database, or
   missing permissions. If the SQL file itself has a bug, fix it in a pull
   request, not by editing the file during the run.
4. Get back to an empty database.
   - Local or throwaway dev database: connect to `master`, drop the database,
     and create it again (commands below). This is simpler than dropping 19
     tables in foreign-key order, and the triggers block `DELETE` on
     `referrals` and `audit_events` anyway.
   - Any QCH-owned database: do not drop or change anything yourself. Send the
     error, the file name, and the commit ID to the team and QCH IT. QCH IT
     decides how to restore it.
5. Run again from 001, using the same commit.

Do not run only the part of a file that failed. After that, nobody can be sure
what the database contains.

Local or throwaway dev database only:

```bash
sqlcmd -S <server> -d master <auth flags> -b -Q "DROP DATABASE [<database>]"
sqlcmd -S <server> -d master <auth flags> -b -Q "CREATE DATABASE [<database>]"
```

## Audit verification

See [the audit coverage and instructions](AUDIT_VERIFICATION.md) and the
[repeatable SQL check](checks/referral_audit.sql).
Run the check after the migrations on an isolated synthetic test database,
using a test administrator identity to exercise the append-only trigger.
Runtime permission enforcement is a separate check.

## Check that it worked

On a fresh database, after 001 and 002:

```sql
SELECT COUNT(*) FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo');  -- 19
SELECT COUNT(*) FROM dbo.departments;                                 -- 4
SELECT COUNT(*) FROM dbo.not_appropriate_reasons;                     -- 5
SELECT name FROM sys.indexes WHERE has_filter = 1;                    -- the 3 filtered indexes above
```

After 003:

```sql
SELECT COUNT(*) FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo');  -- still 19
SELECT OBJECT_ID('dbo.program_zip_codes');                            -- NULL (renamed)
SELECT OBJECT_ID('dbo.program_service_area_zips');                    -- not NULL
SELECT name FROM sys.check_constraints
WHERE name IN ('ck_programs_age_limit_state', 'ck_programs_service_area_state',
               'ck_programs_age_limit_values', 'ck_psaz_format');     -- 4 rows
```

### GPME state rules (test T17)

Run on a throwaway dev database after 003. Each of the first two inserts must
fail with a CHECK constraint error (547). The third must succeed. Wrap it in a
transaction and roll back so nothing stays behind.

```sql
BEGIN TRAN;
DECLARE @dept INT = (SELECT TOP 1 department_id FROM dbo.departments);

-- 1. Must FAIL: age state SET with no ages
INSERT dbo.programs (department_id, name, age_limit_state)
VALUES (@dept, N'T17 range without ages', 'SET');

-- 2. Must FAIL: confirmed no age limit, but ages filled in
INSERT dbo.programs (department_id, name, age_limit_state, age_min, age_max)
VALUES (@dept, N'T17 no limit with ages', 'NO_RESTRICTION', 18, 24);

-- 3. Must SUCCEED: age state SET with a range
INSERT dbo.programs (department_id, name, age_limit_state, age_min, age_max)
VALUES (@dept, N'T17 valid range', 'SET', 18, 24);
ROLLBACK;
```

Run it without `-b` so sqlcmd shows all three results instead of stopping at
the first expected error.

## Recording what ran

The database does not record which migrations have run yet (see remaining
tasks). Until it does, the person who runs a migration writes down the
database, the files, the commit ID, the date, and their name, and posts it on
the PR or the Trello card.

## Dev seed

The seed is for development and demos only. Its header says a dev reset script
must check the environment and refuse to run on production or an unknown
environment. That script does not exist yet. Until it does, anyone running the
seed by hand must first confirm the target is a local or dev database.

```bash
sqlcmd -S <server> -d <database> <auth flags> -I -b -i db/seeds/dev_synthetic_seed.sql
```

## Remaining tasks

These are not done in this branch.

- **Migration-history handling.** Record each applied migration (file name,
  commit, time) in the database, and refuse to run a migration that is already
  recorded. 002's header already depends on this.
- **Guarded seed runner.** A dev reset script that checks the environment and
  runs the seed only when the environment is clearly non-production. It must
  refuse when the environment is production or unknown.
