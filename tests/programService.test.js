import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgram, updateProgram, setProgramActiveState } from '../src/services/programService.js';

test('Program Management Unit Tests - Dual Scope & Transaction Security', async (t) => {
  const createMockDb = (options = {}) => {
    let inTransaction = false;
    let rolledBack = false;
    let committed = false;

    const connection = {
      async query(sql, params) {
        if (sql === 'BEGIN TRANSACTION') {
          inTransaction = true;
          return [];
        }
        if (sql === 'COMMIT') {
          committed = true;
          return [];
        }
        if (sql === 'ROLLBACK') {
          rolledBack = true;
          inTransaction = false;
          return [];
        }
        if (sql.includes('dbo.user_grants')) {
          if (params.userId === 'usr-admin') {
            return [{ grant_id: 1, permission: 'MANAGE_ORGANIZATION', scope_type: 'ORG', grant_source: 'IN_APP' }];
          }
          if (params.userId === 'usr-dept10-only') {
            return [{ grant_id: 2, permission: 'MANAGE_PROGRAM', scope_type: 'DEPARTMENT', department_id: 10, grant_source: 'IN_APP' }];
          }
          return [];
        }
        if (sql.includes('SELECT program_id, department_id')) {
          if (params.programId === 42) {
            return [{ program_id: 42, department_id: 10, name: 'Housing Assistance', description: 'Shelter support', lifecycle_status: 'ACTIVE', row_version: 'v1' }];
          }
          return [];
        }
        if (sql.includes('INSERT INTO dbo.programs')) {
          return [{ programId: 42, departmentId: 10, name: 'Housing Assistance', description: 'Shelter support', lifecycleStatus: 'ACTIVE', rowVersion: 'v1' }];
        }
        if (sql.includes('UPDATE dbo.programs')) {
          if (params.expectedRowVersion === 'stale_version_token') return { rowsAffected: [0] };
          return [{ program_id: 42, department_id: 10, name: 'Housing Assistance', description: 'Shelter support', lifecycle_status: 'ACTIVE', newRowVersion: 'v2' }];
        }
        if (sql.includes('INSERT INTO dbo.audit_events')) {
          if (options.failAudit) {
            throw new Error('Database disk error on audit event log write');
          }
          return { rowsAffected: [1] };
        }
        return [];
      },
      release() {}
    };

    return {
      async getConnection() {
        return connection;
      },
      async query(sql, params) {
        return connection.query(sql, params);
      },
      getState() {
        return { inTransaction, rolledBack, committed };
      }
    };
  };

  await t.test('Authorized Program Creation and Event Auditing', async () => {
    const mockDb = createMockDb();
    const result = await createProgram(
      mockDb,
      { name: 'Housing Assistance', description: 'Shelter support', departmentId: 10 },
      'usr-admin'
    );
    assert.strictEqual(result.programId, 42);
    assert.strictEqual(result.name, 'Housing Assistance');
    assert.strictEqual(result.lifecycleStatus, 'ACTIVE');
    assert.strictEqual(mockDb.getState().committed, true);
  });

  await t.test('Dual-Scope Check Blocks Reassignment Without Destination Permission', async () => {
    const mockDb = createMockDb();
    await assert.rejects(
      async () => {
        await updateProgram(
          mockDb,
          { programId: 42, departmentId: 20, expectedRowVersion: 'v1' },
          'usr-dept10-only'
        );
      },
      (err) => err.statusCode === 403
    );
  });

  await t.test('Audit Insertion Failure Triggers Transaction Rollback', async () => {
    const mockDb = createMockDb({ failAudit: true });
    await assert.rejects(
      async () => {
        await setProgramActiveState(mockDb, 42, false, 'v1', 'usr-admin');
      },
      (err) => err.message.includes('Database disk error')
    );
    assert.strictEqual(mockDb.getState().rolledBack, true);
  });
});
