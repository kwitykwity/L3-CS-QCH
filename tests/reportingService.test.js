import test from 'node:test';
import assert from 'node:assert/strict';
import { getTotalReferrals, getTimingMetrics } from '../src/services/reportingService.js';

test('Reporting Service Unit Tests', async (t) => {
  const mockDb = {
    async query(sql, params) {
      if (sql.includes('COUNT(referral_id)')) {
        return [{ total_referrals: 15 }];
      }
      if (sql.includes('referral_status_history')) {
        return [
          {
            referral_id: 1,
            created_at_utc: '2026-01-01T00:00:00Z',
            first_response_utc: '2026-01-01T02:00:00Z',
            service_delivered_utc: '2026-01-02T00:00:00Z'
          }
        ];
      }
      return [];
    }
  };

  const timeWindow = {
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-01-31T23:59:59Z',
    programId: 101
  };

  await t.test('Total Referrals & Metrics Calculation', async () => {
    const result = await getTotalReferrals(mockDb, timeWindow);
    assert.strictEqual(result.totalReferrals, 15);
  });

  await t.test('Timing Metrics Verification', async () => {
    const metrics = await getTimingMetrics(mockDb, timeWindow);
    assert.ok(Array.isArray(metrics));
  });
});
