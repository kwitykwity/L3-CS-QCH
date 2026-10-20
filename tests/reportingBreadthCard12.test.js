import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getReportingBreadthMetrics,
  calculateRatio,
  normalizeDateRange,
  mergeBreakdownRows,
  buildMetrics
} from '../src/services/reportingService.js';

const ORG_GRANTS = [{ permission: 'VIEW_AGGREGATE_REPORTING' }];
const BASE = { startDate: '2026-01-01', endDate: '2026-01-31' };

const SEED_ROWS = [
  { role: 'RECEIVED', program_id: 101, department_id: 10, referral_count: 4, accepted_count: 3, not_appropriate_count: 1, service_delivered_count: 2, no_service_count: 0, awaiting_count: 0 },
  { role: 'RECEIVED', program_id: 102, department_id: 10, referral_count: 3, accepted_count: 1, not_appropriate_count: 0, service_delivered_count: 0, no_service_count: 1, awaiting_count: 2 },
  { role: 'RECEIVED', program_id: 201, department_id: 20, referral_count: 2, accepted_count: 0, not_appropriate_count: 2, service_delivered_count: 0, no_service_count: 0, awaiting_count: 0 },
  { role: 'MADE', program_id: 101, department_id: 10, referral_count: 3 },
  { role: 'MADE', program_id: 102, department_id: 10, referral_count: 2 },
  { role: 'MADE', program_id: 201, department_id: 20, referral_count: 4 }
];

function makeDb(rows = SEED_ROWS, total = 9) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return sql.includes('UNION ALL') ? rows : [{ total_count: total }];
    }
  };
}

const rejects400 = (fn) => assert.rejects(fn, (e) => e.statusCode === 400);
const rejects403 = (fn) => assert.rejects(fn, (e) => e.statusCode === 403);

test('authorization', async (t) => {
  await t.test('no grants is denied', () =>
    rejects403(() => getReportingBreadthMetrics(makeDb(), { ...BASE, userGrants: [] })));

  await t.test('MANAGE_ORGANIZATION alone is denied', () =>
    rejects403(() => getReportingBreadthMetrics(makeDb(), { ...BASE, userGrants: [{ permission: 'MANAGE_ORGANIZATION' }] })));

  await t.test('program-scoped grant cannot request org-wide or another program', async () => {
    const grants = [{ permission: 'VIEW_AGGREGATE_REPORTING', scope: { type: 'PROGRAM', id: 101 } }];
    await rejects403(() => getReportingBreadthMetrics(makeDb(), { ...BASE, userGrants: grants }));
    await rejects403(() => getReportingBreadthMetrics(makeDb(), { ...BASE, programId: 102, userGrants: grants }));
    const ok = await getReportingBreadthMetrics(makeDb(), { ...BASE, programId: 101, userGrants: grants });
    assert.equal(ok.scope.programId, 101);
  });

  await t.test('denied requests never touch the database', async () => {
    const db = makeDb();
    await rejects403(() => getReportingBreadthMetrics(db, { ...BASE, userGrants: [] }));
    assert.equal(db.calls.length, 0);
  });
});

test('input validation', async (t) => {
  const call = (over) => getReportingBreadthMetrics(makeDb(), { ...BASE, userGrants: ORG_GRANTS, ...over });

  await t.test('missing dates', () => rejects400(() => call({ startDate: undefined })));
  await t.test('timestamps are rejected (date-only contract)', () => rejects400(() => call({ endDate: '2026-01-31T23:59:59Z' })));
  await t.test('impossible calendar date', () => rejects400(() => call({ endDate: '2026-02-30' })));
  await t.test('start after end', () => rejects400(() => call({ startDate: '2026-02-01', endDate: '2026-01-01' })));
  await t.test('program and department together', () => rejects400(() => call({ programId: 101, departmentId: 10 })));
  await t.test('non-integer id', () => rejects400(() => call({ programId: '101' })));
});

test('date normalization (America/New_York)', async (t) => {
  await t.test('January (EST, UTC-5)', () => {
    const r = normalizeDateRange('2026-01-01', '2026-01-31');
    assert.equal(r.startUtc, '2026-01-01T05:00:00.000Z');
    assert.equal(r.endUtcExclusive, '2026-02-01T05:00:00.000Z');
  });

  await t.test('spring-forward day', () => {
    const r = normalizeDateRange('2026-03-08', '2026-03-08');
    assert.equal(r.startUtc, '2026-03-08T05:00:00.000Z');
    assert.equal(r.endUtcExclusive, '2026-03-09T04:00:00.000Z');
  });

  await t.test('9pm Eastern on Jan 31 falls inside January, not February', () => {
    const r = normalizeDateRange('2026-01-01', '2026-01-31');
    const instant = '2026-02-01T02:00:00.000Z';
    assert.ok(instant >= r.startUtc && instant < r.endUtcExclusive);
  });
});

test('calculateRatio states', async (t) => {
  await t.test('calculated, including a real zero', () => {
    assert.deepEqual(calculateRatio(3, 4, 0), { numerator: 3, denominator: 4, value: 75, state: 'CALCULATED' });
    assert.equal(calculateRatio(0, 2, 0).value, 0);
    assert.equal(calculateRatio(0, 2, 0).state, 'CALCULATED');
  });
  await t.test('pending vs no data', () => {
    assert.equal(calculateRatio(0, 0, 3).state, 'PENDING');
    assert.equal(calculateRatio(0, 0, 0).state, 'NO_DATA');
    assert.equal(calculateRatio(0, 0, 3).value, null);
  });
});

test('known-answer breadth metrics from seeded rows', async (t) => {
  const res = await getReportingBreadthMetrics(makeDb(), { ...BASE, userGrants: ORG_GRANTS });

  await t.test('summary', () => {
    const s = res.summary;
    assert.equal(s.totalReferrals, 9);
    assert.equal(s.madeCount, 9);
    assert.equal(s.receivedCount, 9);
    assert.equal(s.acceptedCount, 4);
    assert.equal(s.notAppropriateCount, 3);
    assert.equal(s.awaitingCount, 2);
    assert.equal(s.acceptanceRate.value, 57.14);
    assert.equal(s.notAppropriateRate.value, 42.86);
    assert.equal(s.resultedInServiceRate.value, 66.67);
  });

  await t.test('program rows', () => {
    const byId = Object.fromEntries(res.programBreakdowns.map((p) => [p.programId, p]));
    assert.equal(byId[101].madeCount, 3);
    assert.equal(byId[101].receivedCount, 4);
    assert.equal(byId[101].acceptanceRate.value, 75);
    assert.equal(byId[102].awaitingCount, 2);
    assert.equal(byId[201].acceptanceRate.value, 0);
    assert.equal(byId[201].acceptanceRate.state, 'CALCULATED');
    assert.equal(byId[201].resultedInServiceRate.state, 'NO_DATA');
  });

  await t.test('department rollup is computed from counts, not averaged rates', () => {
    const d10 = res.departmentBreakdowns.find((d) => d.departmentId === 10);
    assert.equal(d10.madeCount, 5);
    assert.equal(d10.receivedCount, 7);
    assert.equal(d10.acceptedCount, 4);
    assert.equal(d10.notAppropriateCount, 1);
    assert.equal(d10.acceptanceRate.value, 80);
    assert.equal(d10.resultedInServiceRate.value, 66.67);
  });
});

test('pending state: accepted but no outcome recorded yet', () => {
  const m = buildMetrics(mergeBreakdownRows([
    { role: 'RECEIVED', program_id: 1, department_id: 1, referral_count: 2, accepted_count: 2, not_appropriate_count: 0, service_delivered_count: 0, no_service_count: 0, awaiting_count: 0 }
  ])[0]);
  assert.equal(m.acceptanceRate.value, 100);
  assert.equal(m.resultedInServiceRate.state, 'PENDING');
});

test('query construction', async (t) => {
  await t.test('unfiltered query has no scope parameters and uses the half-open window', async () => {
    const db = makeDb();
    await getReportingBreadthMetrics(db, { ...BASE, userGrants: ORG_GRANTS });
    const { sql, params } = db.calls[0];
    assert.equal(params.startUtc, '2026-01-01T05:00:00.000Z');
    assert.equal(params.endUtc, '2026-02-01T05:00:00.000Z');
    assert.ok(sql.includes('created_at >= @startUtc AND created_at < @endUtc'));
    assert.ok(!('programId' in params) && !('departmentId' in params));
    assert.ok(!sql.includes('@programId') && !sql.includes('@departmentId'));
  });

  await t.test('program filter is applied per side', async () => {
    const db = makeDb();
    await getReportingBreadthMetrics(db, { ...BASE, programId: 101, userGrants: ORG_GRANTS });
    const { sql, params } = db.calls[0];
    assert.equal(params.programId, 101);
    assert.ok(sql.includes('receiving_program_id = @programId'));
    assert.ok(sql.includes('referring_program_id = @programId'));
  });

  await t.test('department filter is applied per side', async () => {
    const db = makeDb();
    await getReportingBreadthMetrics(db, { ...BASE, departmentId: 10, userGrants: ORG_GRANTS });
    assert.equal(db.calls[0].params.departmentId, 10);
    assert.ok(db.calls[0].sql.includes('receiving_department_id = @departmentId'));
  });
});
