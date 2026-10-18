/**
 * Program Management Service - PRD Compliant (§3, §§9.3-9.6)
 */

async function verifyProgramAccessOnConn(conn, userId, programId = null, departmentId = null, env = process.env) {
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
  const grants = await conn.query(query, { userId });

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
  if (!name || !departmentId) {
    const err = new Error('Bad Request: Program name and departmentId are required.');
    err.statusCode = 400;
    throw err;
  }

  const conn = typeof db.getConnection === 'function' ? await db.getConnection() : db;

  try {
    await conn.query('BEGIN TRANSACTION');

    // Rule 1: Move authorization check INSIDE the transaction boundary
    await verifyProgramAccessOnConn(conn, userId, null, departmentId);

    const insertSql = `
      INSERT INTO dbo.programs (department_id, name, description, lifecycle_status, created_at, updated_at)
      OUTPUT INSERTED.program_id AS programId, INSERTED.department_id AS departmentId, INSERTED.name AS name, INSERTED.description AS description, INSERTED.lifecycle_status AS lifecycleStatus, INSERTED.row_version AS rowVersion
      VALUES (@departmentId, @name, @description, 'ACTIVE', SYSUTCDATETIME(), SYSUTCDATETIME());
    `;

    const result = await conn.query(insertSql, { name, description: description !== undefined ? description : null, departmentId });
    const insertedRow = result && result[0] ? result[0] : result;
    const programId = insertedRow.programId || insertedRow.insertId || insertedRow.id;

    // Rule 3: Build history from authoritative inserted database row
    const afterJson = JSON.stringify(insertedRow);
    await conn.query(
      `INSERT INTO dbo.audit_events (entity_type, entity_id, action, actor_user_id, occurred_at, after_json)
       VALUES ('PROGRAM', @programId, 'CREATED', @userId, SYSUTCDATETIME(), @afterJson)`,
      { programId, userId, afterJson }
    );

    await conn.query('COMMIT');
    return { programId, name: insertedRow.name, departmentId: insertedRow.departmentId, lifecycleStatus: insertedRow.lifecycleStatus, rowVersion: insertedRow.rowVersion };
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    if (typeof conn.release === 'function') conn.release();
  }
}

export async function updateProgram(db, { programId, name, description, departmentId, lifecycleStatus, expectedRowVersion }, userId) {
  if (!expectedRowVersion) {
    const err = new Error('Bad Request: Version precondition (expectedRowVersion) is required.');
    err.statusCode = 400;
    throw err;
  }

  const conn = typeof db.getConnection === 'function' ? await db.getConnection() : db;

  try {
    await conn.query('BEGIN TRANSACTION');

    // Rule 1 & 2: Perform authoritative read and access checks INSIDE transaction under lock
    const existingProg = await conn.query(
      'SELECT program_id, department_id, name, description, lifecycle_status, row_version FROM dbo.programs WITH (UPDLOCK, HOLDLOCK) WHERE program_id = @programId',
      { programId }
    );

    if (!existingProg || existingProg.length === 0) {
      const err = new Error('Not Found: Program does not exist.');
      err.statusCode = 404;
      throw err;
    }

    const current = existingProg[0];
    const currentDeptId = current.department_id;

    // Authorize current scope inside transaction
    await verifyProgramAccessOnConn(conn, userId, programId, currentDeptId);

    // Authorize destination scope if department is being changed
    if (departmentId && departmentId !== currentDeptId) {
      await verifyProgramAccessOnConn(conn, userId, null, departmentId);
    }

    const updateSql = `
      UPDATE dbo.programs
      SET name = COALESCE(@name, name),
          description = COALESCE(@description, description),
          department_id = COALESCE(@departmentId, department_id),
          lifecycle_status = COALESCE(@lifecycleStatus, lifecycle_status),
          updated_at = SYSUTCDATETIME()
      OUTPUT 
        INSERTED.program_id AS program_id,
        INSERTED.department_id AS department_id,
        INSERTED.name AS name,
        INSERTED.description AS description,
        INSERTED.lifecycle_status AS lifecycle_status,
        INSERTED.row_version AS newRowVersion
      WHERE program_id = @programId AND row_version = @expectedRowVersion;
    `;

    const result = await conn.query(updateSql, { programId, name, description, departmentId, lifecycleStatus, expectedRowVersion });
    const rowsAffected = result && (result.rowsAffected ? result.rowsAffected[0] : (result.affectedRows || result.length));

    if (!rowsAffected || rowsAffected === 0) {
      const err = new Error('Conflict: Program state update failed due to stale row_version or missing record.');
      err.statusCode = 409;
      throw err;
    }

    const updatedRow = result[0];

    let action = 'UPDATED';
    if (lifecycleStatus && lifecycleStatus !== current.lifecycle_status) {
      action = lifecycleStatus === 'ACTIVE' ? 'REACTIVATED' : 'DISCONTINUED';
    }

    // Rule 3: Build before/after history directly from authoritative database outputs
    const beforeJson = JSON.stringify(current);
    const afterJson = JSON.stringify(updatedRow);

    await conn.query(
      `INSERT INTO dbo.audit_events (entity_type, entity_id, action, actor_user_id, occurred_at, before_json, after_json)
       VALUES ('PROGRAM', @programId, @action, @userId, SYSUTCDATETIME(), @beforeJson, @afterJson)`,
      { programId, action, userId, beforeJson, afterJson }
    );

    await conn.query('COMMIT');
    return { programId, updated: true, rowVersion: updatedRow.newRowVersion };
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    if (typeof conn.release === 'function') conn.release();
  }
}

export async function setProgramActiveState(db, programId, isActive, expectedRowVersion, userId) {
  const lifecycleStatus = isActive ? 'ACTIVE' : 'DISCONTINUED';
  return updateProgram(db, { programId, lifecycleStatus, expectedRowVersion }, userId);
}
