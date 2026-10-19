/* =====================================================================
   QCH Connect - Migration 003: GPME matching states
   Target: Azure SQL Database (T-SQL).
   Matches the Final Technical PRD (Oct 14, 2026) and the GPME Decision
   Proposal (Card 10), approved by the team on Oct 18, 2026.

   MODEL: versioned, run-once migration, like 002. Run it exactly one
   time per database, after 001 and 002, with sqlcmd -I -b. It is
   additive: it does not edit 001, and it works on an empty or a
   populated database.

   WHAT IT DOES
   1. Adds two "on file" state columns to dbo.programs, one for the
      age limit and one for the service area. GPME never treats missing
      Program information as "no restriction" (PRD 8.10).
   2. Renames dbo.program_zip_codes to dbo.program_service_area_zips,
      so the table can only mean "where participants must LIVE", never
      "where the Program runs". Site location stays in programs.site and
      is display only. It never removes a Program from GPME results.

   STATE VALUES (same four for both columns, TEAM DECISION Oct 18)
   - SET             a limit is on file and GPME checks it
                     (age: age_min and/or age_max; area: ZIP rows)
   - NO_RESTRICTION  confirmed: this Program has no such limit
   - NOT_ON_FILE     nobody has entered this yet. GPME shows the Program
                     as "possible", never as "no limit" and never removed
   - OTHER_LIMIT     a limit exists that these fields cannot express,
                     for example a service area of one housing
                     development, or an age rule about someone other
                     than the participant (such as a child's age).
                     GPME treats it like NOT_ON_FILE (never removes the
                     Program) but explains it differently.
   UNKNOWN is deliberately not used: PRD 12.6 already uses "Unknown" as
   a reporting truth state with a different meaning.

   NEED CATEGORIES need no new column. A Program with no rows in
   dbo.program_service_categories is "need not on file".

   Cross-table rule the database cannot CHECK: service_area_state = 'SET'
   needs at least one ZIP row, and every other state needs none. The
   backend enforces it (src/gpme/programFacts.js) and its tests cover it.

   ORDER: add columns with defaults -> backfill -> add CHECKs, so the
   CHECKs are validated against rows that already follow the rules.
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. New state columns. Every existing and new row starts NOT_ON_FILE.
   --------------------------------------------------------------------- */
ALTER TABLE dbo.programs ADD
    age_limit_state     NVARCHAR(20) NOT NULL CONSTRAINT df_programs_age_limit_state    DEFAULT 'NOT_ON_FILE',
    service_area_state  NVARCHAR(20) NOT NULL CONSTRAINT df_programs_service_area_state DEFAULT 'NOT_ON_FILE';
GO

/* ---------------------------------------------------------------------
   2. Rename the ZIP table and its constraints so the meaning is fixed
      in the name. Column zip_code is unchanged.
   --------------------------------------------------------------------- */
EXEC sp_rename N'dbo.program_zip_codes',    N'program_service_area_zips';
EXEC sp_rename N'dbo.pk_program_zip_codes', N'pk_program_service_area_zips', N'OBJECT';
EXEC sp_rename N'dbo.fk_pzip_program',      N'fk_psaz_program',              N'OBJECT';
EXEC sp_rename N'dbo.ck_pzip_format',       N'ck_psaz_format',               N'OBJECT';
GO

EXEC sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'Service-area ZIP codes: where a participant must LIVE to be served. Not where the Program runs (that is programs.site, display only). Rows exist only when programs.service_area_state = SET.',
    @level0type = N'SCHEMA', @level0name = N'dbo',
    @level1type = N'TABLE',  @level1name = N'program_service_area_zips';
GO

/* ---------------------------------------------------------------------
   3. Backfill. Only data that is already on file becomes SET.
      Everything else stays NOT_ON_FILE. NO_RESTRICTION and OTHER_LIMIT
      are never guessed; program staff set them through Program
      maintenance (PRD 4.1).
   --------------------------------------------------------------------- */
UPDATE dbo.programs
SET age_limit_state = 'SET'
WHERE age_min IS NOT NULL OR age_max IS NOT NULL;

UPDATE p
SET service_area_state = 'SET'
FROM dbo.programs AS p
WHERE EXISTS (SELECT 1 FROM dbo.program_service_area_zips AS z WHERE z.program_id = p.program_id);
GO

/* ---------------------------------------------------------------------
   4. CHECKs. Ages exist only when the age state is SET, and SET always
      has at least one bound.
   --------------------------------------------------------------------- */
ALTER TABLE dbo.programs ADD
    CONSTRAINT ck_programs_age_limit_state CHECK (
        age_limit_state IN ('SET','NO_RESTRICTION','NOT_ON_FILE','OTHER_LIMIT')),
    CONSTRAINT ck_programs_service_area_state CHECK (
        service_area_state IN ('SET','NO_RESTRICTION','NOT_ON_FILE','OTHER_LIMIT')),
    CONSTRAINT ck_programs_age_limit_values CHECK (
           (age_limit_state = 'SET'  AND (age_min IS NOT NULL OR age_max IS NOT NULL))
        OR (age_limit_state <> 'SET' AND age_min IS NULL AND age_max IS NULL));
GO
