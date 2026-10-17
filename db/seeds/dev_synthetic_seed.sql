/* =====================================================================
   QCH Connect - DEV / DEMO SYNTHETIC SEED

   NON-PRODUCTION ONLY. Never run against production (PRD 16.2, 17.4).
   The dev reset script that runs this file must check the environment
   and refuse (fail closed) if it is production or unknown.

   MODEL: idempotent. Safe to run any number of times. Each insert only
   adds rows that are not already present.

   Nothing in this file is QCH-confirmed. All values are
   TEAM PROPOSAL / SYNTHETIC for development and demos.
   ===================================================================== */

/* Service categories - TEAM/LLM-GENERATED, NOT a QCH-provided list.
   Used only so dev search and matching have something to work with. */
INSERT INTO dbo.service_categories (name)
SELECT v.name
FROM (VALUES
    (N'Benefits'),
    (N'Childcare'),
    (N'Community Space'),
    (N'Counseling & Mental Health'),
    (N'Education'),
    (N'Employment & Training'),
    (N'Family Support'),
    (N'Food'),
    (N'Health & Wellness'),
    (N'Housing'),
    (N'Immigration'),
    (N'Leadership'),
    (N'Legal'),
    (N'LGBTQ+'),
    (N'Older Adult Care'),
    (N'Training for Organizations'),
    (N'Transportation'),
    (N'Youth Enrichment')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM dbo.service_categories s WHERE s.name = v.name);
GO

/* Not Appropriate reasons are NOT seeded here. The initial list
   (team-created with Kyle's authorization) is real reference data and
   is loaded by migration 002. */

/* No GPME rule version is seeded. Add one only when a real rule set
   and its regression tests exist. */
