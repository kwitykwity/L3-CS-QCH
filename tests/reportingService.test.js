const assert = require('assert');
const { getTotalReferrals, getTimingMetrics, getReportingBreadthMetrics } = require('../src/services/reportingService');

async function runTests() {
  console.log('Running Reporting Service Unit Tests...');

  // Test 1: Total Referrals
  const mockDb1 = {
    query: async () => [{ total_referrals: 5 }]
  };
  const res1 = await getTotalReferrals(mockDb1, { startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-14T23:59:59Z' });
  assert.strictEqual(res1.totalReferrals, 5);
  console.log('✔ Test 1 Passed: Total Referrals');

  // Test 2: Timing Metrics Known-Answer Verification
  const mockDb2 = {
    query: async () => [
      { referral_id: 101, created_at_utc: '2026-10-01T10:00:00Z', first_response_utc: '2026-10-01T12:00:00Z', service_delivered_utc: '2026-10-02T10:00:00Z' },
      { referral_id: 102, created_at_utc: '2026-10-01T10:00:00Z', first_response_utc: '2026-10-01T14:00:00Z', service_delivered_utc: '2026-10-03T10:00:00Z' },
      { referral_id: 103, created_at_utc: '2026-10-01T10:00:00Z', first_response_utc: '2026-10-01T16:00:00Z', service_delivered_utc: '2026-10-04T10:00:00Z' }
    ]
  };
  const timingRes = await getTimingMetrics(mockDb2, { startDate: '2026-10-01T00:00:00Z', endDate: '2026-10-14T23:59:59Z' });
  assert.strictEqual(timingRes.avgTimeToFirstResponseHours, 4);
  assert.strictEqual(timingRes.avgTimeToRecordedServiceHours, 48);
  assert.strictEqual(timingRes.medianTimeToRecordedServiceHours, 48);
  console.log('✔ Test 2 Passed: Timing Metrics Calculation');

  // Test 3: Reporting Breadth Metrics Known-Answer Verification
  const mockDb3 = {
    query: async () => [
      { referral_id: 1, current_status: 'Service Delivered', decline_reason: null, referring_program_id: 'PROG-A', receiving_program_id: 'PROG-B', has_accepted: 1, has_service: 1 },
      { referral_id: 2, current_status: 'Accepted', decline_reason: null, referring_program_id: 'PROG-A', receiving_program_id: 'PROG-B', has_accepted: 1, has_service: 0 },
      { referral_id: 3, current_status: 'Pending', decline_reason: null, referring_program_id: 'PROG-B', receiving_program_id: 'PROG-A', has_accepted: 0, has_service: 0 },
      { referral_id: 4, current_status: 'Declined', decline_reason: 'Not Appropriate', referring_program_id: 'PROG-A', receiving_program_id: 'PROG-B', has_accepted: 0, has_service: 0 }
    ]
  };
  const breadthRes = await getReportingBreadthMetrics(mockDb3, {
    startDate: '2026-10-01T00:00:00Z',
    endDate: '2026-10-14T23:59:59Z',
    programId: 'PROG-A'
  });

  assert.strictEqual(breadthRes.totalReferrals, 4);
  assert.strictEqual(breadthRes.acceptanceRatePct, 50);
  assert.strictEqual(breadthRes.resultedInServiceRatePct, 25);
  assert.strictEqual(breadthRes.awaitingResponseCount, 1);
  assert.strictEqual(breadthRes.notAppropriateCount, 1);
  assert.strictEqual(breadthRes.madeCount, 3);
  assert.strictEqual(breadthRes.receivedCount, 1);
  console.log('✔ Test 3 Passed: Reporting Breadth Metrics Calculation');

  console.log('All reporting unit tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});