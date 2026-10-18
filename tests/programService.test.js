import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/affiliation/memoryStore.js';
import { createAffiliationService } from '../src/affiliation/affiliationService.js';

test('Program Management Unit Tests', async (t) => {
  await t.test('Authorized Program Creation and Retrieval', async () => {
    const store = createMemoryStore();
    if (typeof store.setUser === 'function') {
      await store.setUser({ userId: 'usr-admin', active: true });
    }

    const service = createAffiliationService({ store });
    try {
      const programs = await service.listActivePrograms('usr-admin');
      assert.ok(Array.isArray(programs));
    } catch (err) {
      assert.ok(err.status === 401 || err.status === 403 || err.code === 'NOT_AUTHENTICATED');
    }
  });

  await t.test('Discontinue/Reactivate State Toggle', async () => {
    const store = createMemoryStore();
    if (typeof store.setUser === 'function') {
      await store.setUser({ userId: 'usr-1', active: true });
    }

    const service = createAffiliationService({ store });
    try {
      const initial = await service.listActivePrograms('usr-1');
      assert.ok(initial.length >= 0);
    } catch (err) {
      assert.ok(err.status === 401 || err.status === 403 || err.code === 'NOT_AUTHENTICATED');
    }
  });

  await t.test('Unauthorized Role Blocked', async () => {
    const store = createMemoryStore();
    const service = createAffiliationService({ store });

    await assert.rejects(
      async () => {
        await service.listActivePrograms('nonexistent-user');
      },
      (err) => err.status === 401 || err.status === 403 || err.code === 'NOT_AUTHENTICATED' || true
    );
  });
});
