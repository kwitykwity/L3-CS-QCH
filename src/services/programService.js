/**
 * Program Management Service - Azure SQL DB (T-SQL) Schema Compliant
 * Source of Truth: db/migrations/001_core_schema.sql & Final Technical PRD
 */

async function verifyProgramManagementAccess(db, userId) {
  if (!userId) {
    const err = new Error('Unauthorized: Authentication required.');
    err.statusCode = 401;
    throw err;
  }

  const query = `
    SELECT grant_id, permission, scope_type, department_id, program_id 
    FROM dbo.user_grants 
    WHERE user_id = @userId AND revoked_at IS NULL
  `;
  const grants = await db.query(query, { userId });

  if (!grants || grants.length === 0) {
    const err = new Error('Forbidden: User is inactive or has no active authorization grants.');
    err.statusCode = 403;
    throw err;
  }

  const hasAccess = grants.some(g => 
    ['MANAGE_PROGRAM', 'MANAGE_ORGANIZATION', 'ADMINISTER_PERMISSIONS'].includes(g.permission)
  );

  if (!hasAccess) {
    const err = new Error('Forbidden: Insufficient privileges for program management.');
    err.statusCode = 403;
    throw err;
  }

  return true;
}

export async function createProgram(db, { name, description, departmentId }, userId) {
  await verifyProgramManagementAccess(db, userId);

  if (!name || !departmentId) {
    const err = new Error('Bad Request: Program name and departmentId are required.');
    err.statusCode = 400;
    throw err;
  }

  const insertSql = `
    INSERT INTO dbo.programs (department_id, name, description, lifecycle_status, created_at, updated_at)
    OUTPUT INSERTED.program_id AS programId
    VALUES (@departmentId, @name, @description, 'ACTIVE', SYSUTCDATETIME(), SYSUTCDATETIME());
  `;

  const result = await db.query(insertSql, { name, description: description || null, departmentId });
  const programId = result && result[0] ? result[0].programId : (result.insertId || result.id);

  await db.query(
    `INSERT INTO dbo.audit_events (entity_type, entity_id, action, actor_user_id, occurred_at)
     VALUES ('PROGRAM', @programId, 'CREATED', @userId, SYSUTCDATETIME())`,
    { programId, userId }
  );

  return { programId, name, departmentId, lifecycleStatus: 'ACTIVE' };
}

export async function updateProgram(db, { programId, name, description, departmentId, lifecycleStatus, expectedRowVersion }, userId) {
  await verifyProgramManagementAccess(db, userId);

  if (!expectedRowVersion) {
    const err = new Error('Bad Request: Optimistic concurrency control requires expectedRowVersion.');
    err.statusCode = 400;
    throw err;
  }

  const updateSql = `
    UPDATE dbo.programs
    SET name = COALESCE(@name, name),
        description = COALESCE(@description, description),
        department_id = COALESCE(@departmentId, department_id),
        lifecycle_status = COALESCE(@lifecycleStatus, lifecycle_status),
        updated_at = SYSUTCDATETIME()
    WHERE program_id = @programId AND row_version = @expectedRowVersion;
  `;

  const result = await db.query(updateSql, { programId, name, description, departmentId, lifecycleStatus, expectedRowVersion });
  const rowsAffected = result && (result.rowsAffected ? result.rowsAffected[0] : (result.affectedRows || result.changes));

  if (!rowsAffected || rowsAffected === 0) {
    const err = new Error('Conflict: Program update failed due to stale row_version or missing record.');
    err.statusCode = 409;
    throw err;
  }

  const action = lifecycleStatus === 'ACTIVE' ? 'REACTIVATED' : 'DISCONTINUED';

  await db.query(
    `INSERT INTO dbo.audit_events (entity_type, entity_id, action, actor_user_id, occurred_at)
     VALUES ('PROGRAM', @programId, @action, @userId, SYSUTCDATETIME())`,
    { programId, action, userId }
  );

  return { programId, updated: true };
}

export async function setProgramActiveState(db, programId, isActive, expectedRowVersion, userId) {
  const lifecycleStatus = isActive ? 'ACTIVE' : 'DISCONTINUED';
  return updateProgram(db, { programId, lifecycleStatus, expectedRowVersion }, userId);
}
