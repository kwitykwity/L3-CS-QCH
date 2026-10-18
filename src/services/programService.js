/**
 * Program Management Service
 * Source of Truth: QCH_Connect_Final_Tech_PRD_Oct14_2026.docx (Section 12.4 / Program Management)
 */

async function verifyProgramManagementAccess(db, userId) {
  if (!userId) {
    const err = new Error('Unauthorized: Authentication required.');
    err.statusCode = 401;
    throw err;
  }
  const userRows = await db.query(
    `SELECT u.user_id, u.is_active, r.role_name 
     FROM users u 
     LEFT JOIN user_roles ur ON u.user_id = ur.user_id 
     LEFT JOIN roles r ON ur.role_id = r.role_id 
     WHERE u.user_id = @userId AND u.is_active = true`,
    { userId }
  );

  if (!userRows || userRows.length === 0) {
    const err = new Error('Forbidden: User is inactive or unauthorized.');
    err.statusCode = 403;
    throw err;
  }

  const roles = userRows.map(r => r.role_name);
  const isAuthorized = roles.some(role => ['Program Director', 'Designated Staff', 'Admin', 'SYSTEM_ADMIN'].includes(role));
  if (!isAuthorized) {
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

  const now = new Date().toISOString();
  const sql = `
    INSERT INTO program (name, description, department_id, is_active, version, created_at_utc, updated_at_utc)
    VALUES (@name, @description, @departmentId, true, 1, @now, @now)
  `;

  const result = await db.query(sql, { name, description: description || null, departmentId, now });
  const programId = result.insertId || result.id;

  await db.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, performed_by_user_id, timestamp_utc)
     VALUES ('PROGRAM', @programId, 'CREATE', @userId, @now)`,
    { programId, userId, now }
  );

  return { programId, name, departmentId, isActive: true, version: 1 };
}

export async function updateProgram(db, { programId, name, description, departmentId, isActive, expectedVersion }, userId) {
  await verifyProgramManagementAccess(db, userId);

  const now = new Date().toISOString();
  const sql = `
    UPDATE program
    SET name = COALESCE(@name, name),
        description = COALESCE(@description, description),
        department_id = COALESCE(@departmentId, department_id),
        is_active = COALESCE(@isActive, is_active),
        version = version + 1,
        updated_at_utc = @now
    WHERE program_id = @programId AND (@expectedVersion IS NULL OR version = @expectedVersion)
  `;

  const result = await db.query(sql, { programId, name, description, departmentId, isActive, expectedVersion: expectedVersion || null, now });
  if (!result || (result.affectedRows === 0 && result.changes === 0)) {
    const err = new Error('Conflict: Program state update failed due to stale version or missing record.');
    err.statusCode = 409;
    throw err;
  }

  await db.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, performed_by_user_id, timestamp_utc)
     VALUES ('PROGRAM', @programId, 'UPDATE', @userId, @now)`,
    { programId, userId, now }
  );

  return { programId, updated: true, updatedAtUtc: now };
}

export async function setProgramActiveState(db, programId, isActive, expectedVersion, userId) {
  return updateProgram(db, { programId, isActive, expectedVersion }, userId);
}
