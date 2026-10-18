/**
 * Program Management Service
 * Source of Truth: QCH_Connect_Final_Tech_PRD_Oct14_2026.docx (Section 12.4 / Program Management)
 */

const AUTHORIZED_ROLES = ['Program Director', 'Designated Staff', 'Admin'];

function checkAuthorization(userRole) {
  if (!AUTHORIZED_ROLES.includes(userRole)) {
    const err = new Error('Unauthorized: User role does not have permission to manage programs.');
    err.statusCode = 403;
    throw err;
  }
}

/**
 * Creates a new program.
 */
async function createProgram(db, { name, description, departmentId }, userRole) {
  checkAuthorization(userRole);

  if (!name || !departmentId) {
    const err = new Error('Bad Request: Program name and departmentId are required.');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const sql = `
    INSERT INTO programs (name, description, department_id, is_active, created_at_utc, updated_at_utc)
    VALUES (@name, @description, @departmentId, true, @now, @now)
  `;

  const result = await db.query(sql, { name, description: description || null, departmentId, now });
  return { programId: result.insertId || result.id, name, departmentId, isActive: true };
}

/**
 * Updates program details or toggles active state (discontinue/reactivate).
 * Preserves stable identity without deleting existing history.
 */
async function updateProgram(db, { programId, name, description, departmentId, isActive }, userRole) {
  checkAuthorization(userRole);

  const now = new Date().toISOString();
  const sql = `
    UPDATE programs
    SET name = COALESCE(@name, name),
        description = COALESCE(@description, description),
        department_id = COALESCE(@departmentId, department_id),
        is_active = COALESCE(@isActive, is_active),
        updated_at_utc = @now
    WHERE program_id = @programId
  `;

  await db.query(sql, { programId, name, description, departmentId, isActive, now });
  return { programId, updated: true, updatedAtUtc: now };
}

/**
 * Discontinues a program (soft-disable by setting is_active = false).
 */
async function setProgramActiveState(db, programId, isActive, userRole) {
  checkAuthorization(userRole);

  const now = new Date().toISOString();
  const sql = `UPDATE programs SET is_active = @isActive, updated_at_utc = @now WHERE program_id = @programId`;
  await db.query(sql, { programId, isActive, now });

  return { programId, isActive, updatedAtUtc: now };
}

module.exports = {
  createProgram,
  updateProgram,
  setProgramActiveState
};