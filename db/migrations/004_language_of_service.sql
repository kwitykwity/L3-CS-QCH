/* =====================================================================
   QCH Connect - Migration 004: Language of service
   Target: Azure SQL Database (T-SQL).
   Requirement: Kyle Butler (QCH), Oct 26, 2026: Programs list their
   language(s) of service, and a Program may select more than one
   (Trello Task W; requirements register R7).

   MODEL: versioned, run-once migration, like 002 and 003. Run it exactly
   one time per database, after 001 to 003, with sqlcmd -I -b. It is
   additive: it only creates two tables and changes nothing else.

   SHAPE: the same pattern as need categories (001: service_categories and
   program_service_categories), PRD 4.2 and 9.9: a controlled list with
   stable IDs, plus one row per language a Program serves in.
   - A Program with NO rows here has its languages "not on file". That is
     never read as "English only" or as "all languages".
   - Matching (GPME rule version gpme-v1) does not read these tables.
     Languages are shown to staff as decision support only. A later,
     approved rule version could use the stable language IDs without
     changing this design.
   - Meaning comes from language_id, never from the editable name.

   NO VALUES ARE INSERTED HERE. Which languages QCH lists is an open QCH
   decision (for example whether "Chinese" means Mandarin, Cantonese or
   both). The synthetic dev seed has sample values only.
   ===================================================================== */

CREATE TABLE dbo.service_languages (
    language_id       INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_service_languages PRIMARY KEY,
    name              NVARCHAR(100) NOT NULL CONSTRAINT uq_service_languages_name UNIQUE,
    lifecycle_status  NVARCHAR(20)  NOT NULL CONSTRAINT df_service_languages_status DEFAULT 'ACTIVE',
    CONSTRAINT ck_service_languages_status CHECK (lifecycle_status IN ('ACTIVE','DISCONTINUED','RETIRED'))
);
GO

CREATE TABLE dbo.program_service_languages (
    program_id   INT NOT NULL CONSTRAINT fk_psl_program  REFERENCES dbo.programs(program_id),
    language_id  INT NOT NULL CONSTRAINT fk_psl_language REFERENCES dbo.service_languages(language_id),
    CONSTRAINT pk_program_service_languages PRIMARY KEY (program_id, language_id)
);
GO
