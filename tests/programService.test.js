import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgram, setProgramActiveState } from '../src/services/programService.js';

test('Program Management Unit Tests', async (t) => {
  const mockDb = {
    async query(sql, params) {
      if (sql.includes('FROM users')) {
        if (params.userId === 'usr-admin') {
          return [{ user_id: 'usr-admin', is_active: 1, role_name: 'Admin' }];
        }
        if (params.userId === 'usr-unauthorized') {
          return [{ user_id: 'usr-unauthorized', is_active: 1, role_name: 'Case Worker' }];
        }
        return [];
      }
      if (sql.includes('INSERT INTO program')) {
        return { insertId: 42, affectedRows: 1 };
      }
      if (sql.includes('UPDATE program')) {
        if (params.expectedVersion === 999) return { affectedRows: 0, changes: 0 };
        return { affectedRows: 1, changes: 1 };
      }
      if (sql.includes('INSERT INTO audit_log')) {
        return { affectedRows: 1 };
      }
      return [];
    }
  };

  await t.test('Authorized Program Creation and Retrieval', async () => {
    const result = await createProgram(
      mockDb,
      { name: 'Housing Assistance', description: 'Shelter support', departmentId: 10 },
      'usr-admin'
    );
    assert.strictEqual(result.programId, 42);
    assert.strictEqual(result.name, 'Housing Assistance');
    assert.strictEqual(result.isActive, true);
    assert.strictEqual(result.version, 1);
  });

  await t.test('Discontinue/Reactivate State Toggle with Version Protection', async () => {
    const updated = await setProgramActiveState(mockDb, 42, false, 1, 'usr-admin');
    assert.strictEqual(updated.programId, 42);
    assert.strictEqual(updated.updated, true);
  });

  await t.test('Stale Version Update Protection Rejects Conflict', async () => {
    await assert.rejects(
      async () => {
        await setProgramActiveState(mockDb, 42, false, 999, 'usr-admin');
      },
      (err) => err.statusCode === 409 && err.message.includes('Conflict')
    );
  });

  await t.test('Unauthorized Role Blocked', async () => {
    await assert.rejects(
      async () => {
        await createProgram(
          mockDb,
          { name: 'Unauthorized Program', departmentId: 10 },
          'usr-unauthorized'
        );
      },
      (err) => err.statusCode === 403 && err.message.includes('Forbidden')
    );
  });
});
