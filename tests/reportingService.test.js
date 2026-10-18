import test from 'node:test';
import assert from 'node:assert/strict';
import { getTotalReferrals, getTimingMetrics, getReportingBreadthMetrics } from '../src/services/reportingService.js';

test('Reporting Service Unit Tests', async (t) => {
  const mockDb = {
    async query(sql, params) {
      if (sql.includes('COUNT(referral_id) AS total_referrals')) {
        return [{ total_referrals: 15 }];
      }
      if (sql.includes('avg_hours_to_first_response')) {
        if (params.programId === 999) {
          return [{ cohort_size: 0, avg_hours_to_first_response: null, avg_hours_to_service_delivery: null }];
        }
        return [{ cohort_size: 10, avg_hours_to_first_response: 2.50, avg_hours_to_service_delivery: 24.00 }];
      }
      if (sql.includes('FROM referral')) {
        return [
          { status: 'ACCEPTED', referring_program_id: 101, receiving_program_id: 102 },
          { status: 'FULFILLED', referring_program_id: 101, receiving_program_id: 103 },
          { status: 'DECLINED', referring_program_id: 104, receiving_program_id: 101 },
          { status: 'PENDING', referring_program_id: 101, receiving_program_id: 105 }
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

  await t.test('Total Referrals Metric Calculation', async () => {
    const result = await getTotalReferrals(mockDb, timeWindow);
    assert.strictEqual(result.totalReferrals, 15);
  });

  await t.test('Timing Metrics Known-Answer Verification', async () => {
    const metrics = await getTimingMetrics(mockDb, timeWindow);
    assert.strictEqual(metrics.cohortSize, 10);
    assert.strictEqual(metrics.avgHoursToFirstResponse, 2.50);
    assert.strictEqual(metrics.avgHoursToServiceDelivery, 24.00);
  });

  await t.test('Empty Cohort Zero/Null Handling', async () => {
    const emptyMetrics = await getTimingMetrics(mockDb, { ...timeWindow, programId: 999 });
    assert.strictEqual(emptyMetrics.cohortSize, 0);
    assert.strictEqual(emptyMetrics.avgHoursToFirstResponse, null);
    assert.strictEqual(emptyMetrics.avgHoursToServiceDelivery, null);
  });

  await t.test('Breadth Metrics Canonical Calculations', async () => {
    const breadth = await getReportingBreadthMetrics(mockDb, timeWindow);
    assert.strictEqual(breadth.totalReferrals, 4);
    assert.strictEqual(breadth.acceptanceRatePct, 25.00);
    assert.strictEqual(breadth.resultedInServiceRatePct, 25.00);
    assert.strictEqual(breadth.madeCount, 3);
    assert.strictEqual(breadth.receivedCount, 1);
  });
});
