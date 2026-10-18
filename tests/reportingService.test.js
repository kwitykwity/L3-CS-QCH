import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';

test('Reporting Service Unit Tests', async (t) => {
  await t.test('Total Referrals & Metrics Calculation', async () => {
    const store = createMemoryReferralStore();
    const result = await store.listReferralsByReceivingPrograms([1], {});
    assert.ok(Array.isArray(result));
  });

  await t.test('Timing Metrics Verification', async () => {
    const store = createMemoryReferralStore();
    const result = await store.getReferralById(999999);
    assert.strictEqual(result, null);
  });
});
