const assert = require('assert');
const { getTotalReferrals, getTimingMetrics } = require('../src/services/reportingService');

async function runTests() {
  console.log('Running Reporting Service Unit Tests...');

  // Mock DB setup
  let executedQuery = '';
  let executedParams = {};

  // Test 1: Total Referrals
  const mockDb1 = {
    query: async (sql, params) => {
      executedQuery = sql;
      executedParams = params;
      return [{ total_referrals: 5 }];
    }
  };
  const res1 = await getTotalReferrals(mockDb1, { startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-14T23:59:59Z' });
  assert.strictEqual(res1.totalReferrals, 5);
  console.log('✔ Test 1 Passed: Total Referrals');

  // Test 2: Timing Metrics Known-Answer Verification
  const mockDb2 = {
    query: async (sql, params) => {
      executedQuery = sql;
      executedParams = params;
      return [
        {
          referral_id: 101,
          created_at_utc: '2026-10-01T10:00:00Z',
          first_response_utc: '2026-10-01T12:00:00Z', // 2 hours
          service_delivered_utc: '2026-10-02T10:00:00Z' // 24 hours
        },
        {
          referral_id: 102,
          created_at_utc: '2026-10-01T10:00:00Z',
          first_response_utc: '2026-10-01T14:00:00Z', // 4 hours
          service_delivered_utc: '2026-10-03T10:00:00Z' // 48 hours
        },
        {
          referral_id: 103,
          created_at_utc: '2026-10-01T10:00:00Z',
          first_response_utc: '2026-10-01T16:00:00Z', // 6 hours
          service_delivered_utc: '2026-10-04T10:00:00Z' // 72 hours
        }
      ];
    }
  };

  const timingRes = await getTimingMetrics(mockDb2, {
    startDate: '2026-10-01T00:00:00Z',
    endDate: '2026-10-14T23:59:59Z'
  });

  // Response durations: [2, 4, 6] -> Avg = 4.00
  assert.strictEqual(timingRes.avgTimeToFirstResponseHours, 4);
  // Service durations: [24, 48, 72] -> Avg = 48.00, Median = 48.00
  assert.strictEqual(timingRes.avgTimeToRecordedServiceHours, 48);
  assert.strictEqual(timingRes.medianTimeToRecordedServiceHours, 48);
  console.log('✔ Test 2 Passed: Known-Answer Timing Metrics Calculation');

  console.log('All tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});