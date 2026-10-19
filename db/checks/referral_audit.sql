-- Card 4: audit append-only verification.
-- Run against an isolated synthetic SQL Server/Azure SQL test database
-- after the core schema migration, using sqlcmd -I -b.
-- No rows are inserted, updated, or deleted.
-- This checks trigger enforcement, not application persistence,
-- transaction atomicity, or production database permissions.

SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.audit_events', N'U') IS NULL
    THROW 51099, 'FAIL: dbo.audit_events is missing.', 1;

IF NOT EXISTS (
    SELECT 1
    FROM sys.triggers
    WHERE object_id = OBJECT_ID(N'dbo.trg_audit_events_append_only', N'TR')
      AND parent_id = OBJECT_ID(N'dbo.audit_events', N'U')
      AND is_disabled = 0
      AND is_instead_of_trigger = 1
)
    THROW 51099, 'FAIL: enabled append-only trigger is missing.', 1;

BEGIN TRY
    UPDATE dbo.audit_events SET action = action WHERE 1 = 0;
    THROW 51099, 'FAIL: audit UPDATE was not blocked.', 1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() <> 51000 THROW;
    PRINT 'PASS: audit UPDATE blocked';
END CATCH;

BEGIN TRY
    DELETE FROM dbo.audit_events WHERE 1 = 0;
    THROW 51099, 'FAIL: audit DELETE was not blocked.', 1;
END TRY
BEGIN CATCH
    IF ERROR_NUMBER() <> 51000 THROW;
    PRINT 'PASS: audit DELETE blocked';
END CATCH;

PRINT 'PASS: audit append-only checks completed';
GO
