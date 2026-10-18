import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgram, setProgramActiveState } from '../src/services/programService.js';

test('Program Management Unit Tests', async (t) => {
  const mockDb = {
    async query(sql, params) {
      if (sql.includes('INSERT INTO programs')) {
        return { insertId: 42 };
      }
      if (sql.includes('UPDATE programs')) {
        return { affectedRows: 1 };
      }
      return [];
    }
  };

  await t.test('Authorized Program Creation and Retrieval', async () => {
    const result = await createProgram(
      mockDb,
      { name: 'Housing Assistance', description: 'Shelter support', departmentId: 10 },
      'Program Director'
    );
    assert.strictEqual(result.programId, 42);
    assert.strictEqual(result.name, 'Housing Assistance');
    assert.strictEqual(result.isActive, true);
  });

  await t.test('Discontinue/Reactivate State Toggle', async () => {
    const updated = await setProgramActiveState(mockDb, 42, false, 'Admin');
    assert.strictEqual(updated.programId, 42);
    assert.strictEqual(updated.isActive, false);
  });

  await t.test('Unauthorized Role Blocked', async () => {
    await assert.rejects(
      async () => {
        await createProgram(
          mockDb,
          { name: 'Unauthorized Program', departmentId: 10 },
          'Case Worker'
        );
      },
      (err) => err.statusCode === 403 && err.message.includes('Unauthorized')
    );
  });
});
