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

/* Need categories (stored in dbo.service_categories).
   SOURCE: GPME Decision Proposal (Card 10), 15-category draft approved by
   the team on Oct 18, 2026 as a TEAM PRODUCT DECISION. NOT a QCH-provided
   list. Names follow QCH's public website sections where one exists.
   OPEN: final wording for "LGBTQ+ community and support" and
   "Immigration and citizenship" (both say something about the
   participant). How this list reaches production is a separate decision.
   Re-running the seed on an older dev database leaves the earlier
   LLM-generated names in place; reset the dev database to remove them. */
INSERT INTO dbo.service_categories (name)
SELECT v.name
FROM (VALUES
    (N'Food'),
    (N'Housing and eviction prevention'),
    (N'Immigration and citizenship'),
    (N'English classes (ESOL)'),
    (N'Benefits help'),
    (N'Jobs and job training'),
    (N'Finishing high school or getting an HSE'),
    (N'College access'),
    (N'Childcare for infants and toddlers'),
    (N'After-school and youth programs'),
    (N'LGBTQ+ community and support'),
    (N'Family support and connection to services'),
    (N'Older adult center activities'),
    (N'Help at home for older adults'),
    (N'Adult day program (frail or memory-impaired)')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM dbo.service_categories s WHERE s.name = v.name);
GO

/* Languages of service (stored in dbo.service_languages, migration 004).
   SOURCE: the three examples Kyle Butler (QCH) gave on Oct 26, 2026.
   SYNTHETIC SAMPLE ONLY, NOT the QCH list. Which languages QCH lists,
   and whether "Chinese" means Mandarin, Cantonese or both, is an open
   QCH decision. Runs only after 004. */
INSERT INTO dbo.service_languages (name)
SELECT v.name
FROM (VALUES
    (N'English'),
    (N'Spanish'),
    (N'Chinese')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM dbo.service_languages s WHERE s.name = v.name);
GO

/* Not Appropriate reasons are NOT seeded here. The initial list
   (team-created with Kyle's authorization) is real reference data and
   is loaded by migration 002. */

/* No GPME rule version is seeded. Add one only when a real rule set
   and its regression tests exist. */
