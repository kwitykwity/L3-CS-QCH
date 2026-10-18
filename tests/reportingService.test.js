import test from 'node:test';
import assert from 'node:assert/strict';
import { getTotalReferrals, getTimingMetrics, getReportingBreadthMetrics } from '../src/services/reportingService.js';

test('Reporting Service Unit Tests - T-SQL Schema Verification', async (t) => {
  const mockDb = {
    async query(sql, params) {
      if (sql.includes('COUNT(referral_id) AS total_referrals')) {
        return [{ total_referrals: 15 }];
      }
      if (sql.includes('DATEDIFF(SECOND')) {
        if (params.programId === 999) {
          return [{ cohort_size: 0, avg_hours_to_first_response: null, avg_hours_to_service_delivery: null, median_hours_to_service_delivery: null }];
        }
        return [{ cohort_size: 10, avg_hours_to_first_response: 2.50, avg_hours_to_service_delivery: 24.00, median_hours_to_service_delivery: 18.00 }];
      }
      if (sql.includes('SUM(CASE WHEN decision = \'ACCEPTED\'')) {
        return [{
          total_count: 4,
          accepted_count: 1,
          not_appropriate_count: 1,
          service_delivered_count: 1,
          no_service_count: 1,
          awaiting_count: 2,
          made_scoped_count: 3,
          received_scoped_count: 1
        }];
      }
      return [];
    }
  };

  const timeWindow = {
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-01-31T23:59:59Z',
    programId: 101
  };

  await t.test('Total Referrals SQL Server Query Execution', async () => {
    const result = await getTotalReferrals(mockDb, timeWindow);
    assert.strictEqual(result.totalReferrals, 15);
  });

  await t.test('Timing Metrics (DATEDIFF Averaging & Median)', async () => {
    const metrics = await getTimingMetrics(mockDb, timeWindow);
    assert.strictEqual(metrics.cohortSize, 10);
    assert.strictEqual(metrics.avgHoursToFirstResponse, 2.50);
    assert.strictEqual(metrics.avgHoursToServiceDelivery, 24.00);
    assert.strictEqual(metrics.medianHoursToServiceDelivery, 18.00);
  });

  await t.test('Empty Cohort Null and Zero Return Handling', async () => {
    const emptyMetrics = await getTimingMetrics(mockDb, { ...timeWindow, programId: 999 });
    assert.strictEqual(emptyMetrics.cohortSize, 0);
    assert.strictEqual(emptyMetrics.avgHoursToFirstResponse, null);
    assert.strictEqual(emptyMetrics.avgHoursToServiceDelivery, null);
    assert.strictEqual(emptyMetrics.medianHoursToServiceDelivery, null);
  });

  await t.test('Breadth Aggregation Metrics Canonical Denominators', async () => {
    const breadth = await getReportingBreadthMetrics(mockDb, timeWindow);
    assert.strictEqual(breadth.totalReferrals, 4);
    assert.strictEqual(breadth.acceptanceRatePct, 50.00);
    assert.strictEqual(breadth.resultedInServiceRatePct, 50.00);
    assert.strictEqual(breadth.madeCount, 3);
    assert.strictEqual(breadth.receivedCount, 1);
  });
});
