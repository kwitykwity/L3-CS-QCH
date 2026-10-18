import test from 'node:test';
import assert from 'node:assert/strict';
import { getTotalReferrals, getTimingMetrics, getReportingBreadthMetrics } from '../src/services/reportingService.js';

test('Reporting Service Unit Tests - SQL Server Staged Query Verification', async (t) => {
  const timeWindow = {
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-01-31T23:59:59Z',
    programId: 101
  };

  await t.test('Timing Metrics - Standard Populated Cohort', async () => {
    const rows = [
      { resp: 2.0, serv: 10.0 },
      { resp: 3.0, serv: 20.0 },
      { resp: 2.5, serv: 30.0 }
    ];

    const mockDb = {
      async query(sql) {
        if (sql.includes('WITH Durations AS')) {
          const respAvg = rows.reduce((acc, r) => acc + r.resp, 0) / rows.length;
          const servAvg = rows.reduce((acc, r) => acc + r.serv, 0) / rows.length;
          const sortedServ = [...rows.map(r => r.serv)].sort((a, b) => a - b);
          const median = sortedServ[Math.floor(sortedServ.length / 2)];

          return [{
            cohort_size: rows.length,
            avg_hours_to_first_response: respAvg,
            avg_hours_to_service_delivery: servAvg,
            median_hours_to_service_delivery: median
          }];
        }
        return [];
      }
    };

    const metrics = await getTimingMetrics(mockDb, timeWindow);
    assert.strictEqual(metrics.cohortSize, 3);
    assert.strictEqual(metrics.avgHoursToFirstResponse, 2.50);
    assert.strictEqual(metrics.avgHoursToServiceDelivery, 20.00);
    assert.strictEqual(metrics.medianHoursToServiceDelivery, 20.00);
  });

  await t.test('Timing Metrics - Empty Cohort Handling', async () => {
    const mockDb = {
      async query(sql) {
        if (sql.includes('WITH Durations AS')) {
          return [{
            cohort_size: 0,
            avg_hours_to_first_response: null,
            avg_hours_to_service_delivery: null,
            median_hours_to_service_delivery: null
          }];
        }
        return [];
      }
    };

    const emptyMetrics = await getTimingMetrics(mockDb, { ...timeWindow, programId: 999 });
    assert.strictEqual(emptyMetrics.cohortSize, 0);
    assert.strictEqual(emptyMetrics.avgHoursToFirstResponse, null);
    assert.strictEqual(emptyMetrics.avgHoursToServiceDelivery, null);
    assert.strictEqual(emptyMetrics.medianHoursToServiceDelivery, null);
  });

  await t.test('Timing Metrics - Null Durations (Unresolved Services)', async () => {
    const mockDb = {
      async query(sql) {
        if (sql.includes('WITH Durations AS')) {
          return [{
            cohort_size: 5,
            avg_hours_to_first_response: 1.20,
            avg_hours_to_service_delivery: null,
            median_hours_to_service_delivery: null
          }];
        }
        return [];
      }
    };

    const metrics = await getTimingMetrics(mockDb, timeWindow);
    assert.strictEqual(metrics.cohortSize, 5);
    assert.strictEqual(metrics.avgHoursToFirstResponse, 1.20);
    assert.strictEqual(metrics.avgHoursToServiceDelivery, null);
    assert.strictEqual(metrics.medianHoursToServiceDelivery, null);
  });

  await t.test('Timing Metrics - Dynamic Odd vs Even Cohort Interpolation', async () => {
    // Odd cohort array evaluation: [10, 20, 30] -> dynamic median = 20
    const oddCohort = [10.0, 20.0, 30.0];
    const mockDbOdd = {
      async query() {
        const median = oddCohort.sort((a, b) => a - b)[Math.floor(oddCohort.length / 2)];
        return [{ cohort_size: oddCohort.length, avg_hours_to_first_response: 2.0, avg_hours_to_service_delivery: 20.0, median_hours_to_service_delivery: median }];
      }
    };
    const oddMetrics = await getTimingMetrics(mockDbOdd, timeWindow);
    assert.strictEqual(oddMetrics.medianHoursToServiceDelivery, 20.0);

    // Even cohort array evaluation: [10, 20, 30, 40] -> interpolated median = 25
    const evenCohort = [10.0, 20.0, 30.0, 40.0];
    const mockDbEven = {
      async query() {
        const sorted = evenCohort.sort((a, b) => a - b);
        const mid = sorted.length / 2;
        const median = (sorted[mid - 1] + sorted[mid]) / 2;
        return [{ cohort_size: evenCohort.length, avg_hours_to_first_response: 2.0, avg_hours_to_service_delivery: 25.0, median_hours_to_service_delivery: median }];
      }
    };
    const evenMetrics = await getTimingMetrics(mockDbEven, timeWindow);
    assert.strictEqual(evenMetrics.medianHoursToServiceDelivery, 25.0);
  });

  await t.test('Breadth Aggregation Metrics - Canonical Denominators', async () => {
    const mockDb = {
      async query(sql) {
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

    const breadth = await getReportingBreadthMetrics(mockDb, timeWindow);
    assert.strictEqual(breadth.totalReferrals, 4);
    assert.strictEqual(breadth.acceptanceRatePct, 50.00);
    assert.strictEqual(breadth.resultedInServiceRatePct, 50.00);
    assert.strictEqual(breadth.madeCount, 3);
    assert.strictEqual(breadth.receivedCount, 1);
  });
});
