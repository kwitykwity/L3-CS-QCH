/**
 * Reporting Service - P0 Reporting Breadth
 *
 * Contract:
 * - Dates are 'YYYY-MM-DD', inclusive on both ends, interpreted in REPORTING_TIME_ZONE.
 * - Cohort is anchored on referral created_at (half-open [start, endExclusive) in UTC).
 * - Decision and outcome metrics are receiving-side. Made counts are referring-side.
 * - Ratios return { numerator, denominator, value, state } with state in
 *   CALCULATED | PENDING | NO_DATA. value is null unless CALCULATED.
 */

export const REPORTING_TIME_ZONE = 'America/New_York';
const REPORTING_CAPABILITY = 'VIEW_AGGREGATE_REPORTING';

const COUNT_KEYS = [
  'madeCount',
  'receivedCount',
  'acceptedCount',
  'notAppropriateCount',
  'serviceDeliveredCount',
  'noServiceCount',
  'awaitingCount'
];

const num = (v) => Number(v ?? 0);

function domainError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.isTrustedDomainError = true;
  return err;
}
const badRequest = (m) => domainError(400, `Bad Request: ${m}`);
const forbidden = (m) => domainError(403, `Forbidden: ${m}`);

/* ---------- Dates ---------- */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value, label) {
  if (typeof value !== 'string' || value === '') {
    throw badRequest(`${label} is required (YYYY-MM-DD).`);
  }
  const m = DATE_ONLY.exec(value);
  if (!m) throw badRequest(`${label} must use the YYYY-MM-DD format.`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw badRequest(`${label} is not a valid calendar date.`);
  }
  return { y, mo, d };
}

function tzOffsetMs(instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORTING_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(instant);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function localMidnightToUtc(y, mo, d) {
  const guess = Date.UTC(y, mo - 1, d, 0, 0, 0);
  let utc = guess - tzOffsetMs(new Date(guess));
  utc = guess - tzOffsetMs(new Date(utc));
  return new Date(utc);
}

export function normalizeDateRange(startDate, endDate) {
  const s = parseDateOnly(startDate, 'startDate');
  const e = parseDateOnly(endDate, 'endDate');
  if (Date.UTC(s.y, s.mo - 1, s.d) > Date.UTC(e.y, e.mo - 1, e.d)) {
    throw badRequest('startDate cannot be after endDate.');
  }
  return {
    startDate,
    endDate,
    timeZone: REPORTING_TIME_ZONE,
    startUtc: localMidnightToUtc(s.y, s.mo, s.d).toISOString(),
    endUtcExclusive: localMidnightToUtc(e.y, e.mo, e.d + 1).toISOString()
  };
}

/* ---------- Authorization and input validation ---------- */

function parseOptionalId(value, label) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw badRequest(`${label} must be a positive integer.`);
  }
  return value;
}

function reportingGrants(userGrants) {
  return (Array.isArray(userGrants) ? userGrants : []).filter(
    (g) => g && g.permission === REPORTING_CAPABILITY
  );
}

function assertScopeAllowed(grants, programId, departmentId) {
  const allowed = grants.some((g) => {
    const scope = g.scope ?? { type: 'ORGANIZATION' };
    if (scope.type === 'ORGANIZATION') return true;
    if (programId !== null) return scope.type === 'PROGRAM' && scope.id === programId;
    if (departmentId !== null) return scope.type === 'DEPARTMENT' && scope.id === departmentId;
    return false;
  });
  if (!allowed) {
    throw forbidden('Your reporting permission does not cover the requested scope.');
  }
}

/* ---------- Pure calculations ---------- */

export function calculateRatio(numerator, denominator, pendingCount = 0) {
  if (denominator > 0) {
    return {
      numerator,
      denominator,
      value: Number(((numerator / denominator) * 100).toFixed(2)),
      state: 'CALCULATED'
    };
  }
  return {
    numerator,
    denominator,
    value: null,
    state: pendingCount > 0 ? 'PENDING' : 'NO_DATA'
  };
}

function emptyCounts(programId, departmentId) {
  const counts = { programId, departmentId };
  for (const k of COUNT_KEYS) counts[k] = 0;
  return counts;
}

export function sumCounts(list, programId = null, departmentId = null) {
  const total = emptyCounts(programId, departmentId);
  for (const item of list) for (const k of COUNT_KEYS) total[k] += item[k];
  return total;
}

export function buildMetrics(c) {
  const decidedCount = c.acceptedCount + c.notAppropriateCount;
  const recordedOutcomeCount = c.serviceDeliveredCount + c.noServiceCount;
  const acceptedWithoutOutcome = Math.max(c.acceptedCount - recordedOutcomeCount, 0);
  return {
    ...c,
    decidedCount,
    recordedOutcomeCount,
    acceptanceRate: calculateRatio(c.acceptedCount, decidedCount, c.awaitingCount),
    notAppropriateRate: calculateRatio(c.notAppropriateCount, decidedCount, c.awaitingCount),
    resultedInServiceRate: calculateRatio(c.serviceDeliveredCount, recordedOutcomeCount, acceptedWithoutOutcome)
  };
}

export function mergeBreakdownRows(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const key = `${r.program_id}|${r.department_id}`;
    if (!map.has(key)) map.set(key, emptyCounts(r.program_id ?? null, r.department_id ?? null));
    const entry = map.get(key);
    if (r.role === 'MADE') {
      entry.madeCount += num(r.referral_count);
    } else if (r.role === 'RECEIVED') {
      entry.receivedCount += num(r.referral_count);
      entry.acceptedCount += num(r.accepted_count);
      entry.notAppropriateCount += num(r.not_appropriate_count);
      entry.serviceDeliveredCount += num(r.service_delivered_count);
      entry.noServiceCount += num(r.no_service_count);
      entry.awaitingCount += num(r.awaiting_count);
    } else {
      throw new Error('Unexpected reporting row role.');
    }
  }
  return [...map.values()].sort(
    (a, b) => (a.programId ?? 0) - (b.programId ?? 0) || (a.departmentId ?? 0) - (b.departmentId ?? 0)
  );
}

export function rollupByDepartment(entries) {
  const byDept = new Map();
  for (const e of entries) {
    if (e.departmentId === null) continue;
    if (!byDept.has(e.departmentId)) byDept.set(e.departmentId, []);
    byDept.get(e.departmentId).push(e);
  }
  return [...byDept.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([deptId, list]) => buildMetrics(sumCounts(list, null, deptId)));
}

/* ---------- Service ---------- */

function scopeClause(side, programId, departmentId) {
  if (programId !== null) return ` AND ${side}_program_id = @programId`;
  if (departmentId !== null) return ` AND ${side}_department_id = @departmentId`;
  return '';
}

function involvingClause(programId, departmentId) {
  if (programId !== null) return ' AND (referring_program_id = @programId OR receiving_program_id = @programId)';
  if (departmentId !== null) return ' AND (referring_department_id = @departmentId OR receiving_department_id = @departmentId)';
  return '';
}

export async function getReportingBreadthMetrics(
  db,
  { startDate, endDate, programId = null, departmentId = null, userGrants = [] } = {}
) {
  const grants = reportingGrants(userGrants);
  if (grants.length === 0) {
    throw forbidden(`Requires ${REPORTING_CAPABILITY} capability.`);
  }

  const range = normalizeDateRange(startDate, endDate);
  const pId = parseOptionalId(programId, 'programId');
  const dId = parseOptionalId(departmentId, 'departmentId');
  if (pId !== null && dId !== null) {
    throw badRequest('Provide either programId or departmentId, not both.');
  }
  assertScopeAllowed(grants, pId, dId);

  const params = { startUtc: range.startUtc, endUtc: range.endUtcExclusive };
  if (pId !== null) params.programId = pId;
  if (dId !== null) params.departmentId = dId;

  const window = 'created_at >= @startUtc AND created_at < @endUtc';

  const breakdownSql = `
    SELECT 'RECEIVED' AS role,
           receiving_program_id AS program_id,
           receiving_department_id AS department_id,
           COUNT(*) AS referral_count,
           SUM(CASE WHEN decision = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted_count,
           SUM(CASE WHEN decision = 'NOT_APPROPRIATE' THEN 1 ELSE 0 END) AS not_appropriate_count,
           SUM(CASE WHEN decision = 'ACCEPTED' AND service_outcome = 'RESULTED_IN_SERVICE' THEN 1 ELSE 0 END) AS service_delivered_count,
           SUM(CASE WHEN decision = 'ACCEPTED' AND service_outcome = 'DID_NOT_RESULT_IN_SERVICE' THEN 1 ELSE 0 END) AS no_service_count,
           SUM(CASE WHEN response_status = 'AWAITING_RESPONSE' THEN 1 ELSE 0 END) AS awaiting_count
    FROM dbo.referrals
    WHERE ${window}${scopeClause('receiving', pId, dId)}
    GROUP BY receiving_program_id, receiving_department_id
    UNION ALL
    SELECT 'MADE' AS role,
           referring_program_id AS program_id,
           referring_department_id AS department_id,
           COUNT(*) AS referral_count,
           0 AS accepted_count,
           0 AS not_appropriate_count,
           0 AS service_delivered_count,
           0 AS no_service_count,
           0 AS awaiting_count
    FROM dbo.referrals
    WHERE ${window}${scopeClause('referring', pId, dId)}
    GROUP BY referring_program_id, referring_department_id
  `;

  const totalSql = `
    SELECT COUNT(*) AS total_count
    FROM dbo.referrals
    WHERE ${window}${involvingClause(pId, dId)}
  `;

  const breakdownRows = await db.query(breakdownSql, params);
  const totalRows = await db.query(totalSql, params);

  const entries = mergeBreakdownRows(breakdownRows);
  const programBreakdowns = entries.map(buildMetrics);
  const departmentBreakdowns = rollupByDepartment(entries);
  const summary = {
    totalReferrals: num(totalRows && totalRows[0] ? totalRows[0].total_count : 0),
    ...buildMetrics(sumCounts(entries))
  };

  return {
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      timeZone: range.timeZone,
      startUtc: range.startUtc,
      endUtcExclusive: range.endUtcExclusive
    },
    scope: { programId: pId, departmentId: dId },
    summary,
    programBreakdowns,
    departmentBreakdowns
  };
}
