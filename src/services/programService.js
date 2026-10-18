/**
 * Program Management Service - PRD Compliant (§3, §§9.3-9.6)
 */

async function verifyProgramAccess(db, userId, programId = null, departmentId = null, env = process.env) {
  if (!userId) {
    const err = new Error('Unauthorized: Authentication required.');
    err.statusCode = 401;
    throw err;
  }

  const query = `
    SELECT ug.grant_id, ug.permission, ug.scope_type, ug.department_id, ug.program_id, ug.grant_source
    FROM dbo.user_grants ug
    JOIN dbo.users u ON ug.user_id = u.user_id
    WHERE ug.user_id = @userId AND u.is_active = 1 AND ug.revoked_at IS NULL
  `;
  const grants = await db.query(query, { userId });

  if (!grants || grants.length === 0) {
    const err = new Error('Forbidden: User is inactive or unauthorized.');
    err.statusCode = 403;
    throw err;
  }

  const isProd = env.NODE_ENV === 'production';

  const hasAccess = grants.some(g => {
    if (isProd && g.grant_source === 'DEMO') return false;

    if (g.permission === 'MANAGE_ORGANIZATION' && g.scope_type === 'ORG') return true;

    if (g.permission === 'MANAGE_PROGRAM') {
      if (g.scope_type === 'ORG') return true;
      if (g.scope_type === 'DEPARTMENT' && departmentId && g.department_id === departmentId) return true;
      if (g.scope_type === 'PROGRAM' && programId && g.program_id === programId) return true;
    }

    return false;
  });

  if (!hasAccess) {
    const err = new Error('Forbidden: Insufficient program management privileges for this scope.');
    err.statusCode = 403;
    throw err;
  }

  return true;
}

export async function createProgram(db, { name, description, departmentId }, userId) {
  await verifyProgramAccess(db, userId, null, departmentId);

  if (!name || !departmentId) {
    const err = new Error('Bad Request: Program name and departmentId are required.');
    err.statusCode = 400;
    throw err;
  }

  await db.query('BEGIN TRANSACTION');
  try {
    const insertSql = `
      INSERT INTO dbo.programs (department_id, name, description, lifecycle_status, created_at, updated_at)
      OUTPUT INSERTED.program_id AS programId, INSERTED.row_version AS rowVersion
      VALUES (@departmentId, @name, @description, 'ACTIVE', SYSUTCDATETIME(), SYSUTCDATETIME());
    `;

    const result = await db.query(insertSql, { name, description: description || null, departmentId });
    const row = result && result[0] ? result[0] : result;
    const programId = row.programId || row.insertId || row.id;

    const afterJson = JSON.stringify({ programId, name, departmentId, lifecycleStatus: 'ACTIVE' });
    await db.query(
      `INSERT INTO dbo.audit_events (entity_type, entity_id, action, actor_user_id, occurred_at, after_json)
       VALUES ('PROGRAM', @programId, 'CREATED', @userId, SYSUTCDATETIME(), @afterJson)`,
      { programId, userId, afterJson }
    );

    await db.query('COMMIT');
    return { programId, name, departmentId, lifecycleStatus: 'ACTIVE', rowVersion: row.rowVersion };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

export async function updateProgram(db, { programId, name, description, departmentId, lifecycleStatus, expectedRowVersion }, userId) {
  const existingProg = await db.query(
    'SELECT program_id, department_id, name, description, lifecycle_status, row_version FROM dbo.programs WHERE program_id = @programId',
    { programId }
  );

  if (!existingProg || existingProg.length === 0) {
    const err = new Error('Not Found: Program does not exist.');
    err.statusCode = 404;
    throw err;
  }

  const current = existingProg[0];
  const targetDeptId = departmentId || current.department_id;
  await verifyProgramAccess(db, userId, programId, targetDeptId);

  if (!expectedRowVersion) {
    const err = new Error('Bad Request: Version precondition (expectedRowVersion) is required.');
    err.statusCode = 400;
    throw err;
  }

  await db.query('BEGIN TRANSACTION');
  try {
    const updateSql = `
      UPDATE dbo.programs
      SET name = COALESCE(@name, name),
          description = COALESCE(@description, description),
          department_id = COALESCE(@departmentId, department_id),
          lifecycle_status = COALESCE(@lifecycleStatus, lifecycle_status),
          updated_at = SYSUTCDATETIME()
      OUTPUT INSERTED.row_version AS newRowVersion
      WHERE program_id = @programId AND row_version = @expectedRowVersion;
    `;

    const result = await db.query(updateSql, { programId, name, description, departmentId, lifecycleStatus, expectedRowVersion });
    const rowsAffected = result && (result.rowsAffected ? result.rowsAffected[0] : (result.affectedRows || result.length));

    if (!rowsAffected || rowsAffected === 0) {
      const err = new Error('Conflict: Program state update failed due to stale row_version or missing record.');
      err.statusCode = 409;
      throw err;
    }

    let action = 'UPDATED';
    if (lifecycleStatus && lifecycleStatus !== current.lifecycle_status) {
      action = lifecycleStatus === 'ACTIVE' ? 'REACTIVATED' : 'DISCONTINUED';
    }

    const beforeJson = JSON.stringify(current);
    const afterJson = JSON.stringify({ programId, name: name || current.name, departmentId: targetDeptId, lifecycleStatus: lifecycleStatus || current.lifecycle_status });

    await db.query(
      `INSERT INTO dbo.audit_events (entity_type, entity_id, action, actor_user_id, occurred_at, before_json, after_json)
       VALUES ('PROGRAM', @programId, @action, @userId, SYSUTCDATETIME(), @beforeJson, @afterJson)`,
      { programId, action, userId, beforeJson, afterJson }
    );

    await db.query('COMMIT');
    const newRowVersion = result && result[0] ? result[0].newRowVersion : null;
    return { programId, updated: true, rowVersion: newRowVersion };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

export async function setProgramActiveState(db, programId, isActive, expectedRowVersion, userId) {
  const lifecycleStatus = isActive ? 'ACTIVE' : 'DISCONTINUED';
  return updateProgram(db, { programId, lifecycleStatus, expectedRowVersion }, userId);
}
