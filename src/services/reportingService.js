/**
 * Reporting Service - Server-Side Canonical Reporting Metrics
 * Source of Truth: QCH_Connect_Final_Tech_PRD_Oct14_2026.docx (Section 12.4)
 */

async function getTotalReferrals(db, { startDate, endDate, departmentId, programId }) {
  let query = "SELECT COUNT(referral_id) AS total_referrals FROM referrals WHERE created_at_utc >= @startDate AND created_at_utc <= @endDate";
  const params = { startDate, endDate };

  if (programId) {
    query += " AND (referring_program_id = @programId OR receiving_program_id = @programId)";
    params.programId = programId;
  } else if (departmentId) {
    query += " AND (referring_department_id = @departmentId OR receiving_department_id = @departmentId)";
    params.departmentId = departmentId;
  }

  const result = await db.query(query, params);
  const count = result && result[0] ? Number(result[0].total_referrals) : 0;

  return { totalReferrals: count };
}

async function getTimingMetrics(db, { startDate, endDate, departmentId, programId }) {
  let baseQuery = [
    "SELECT",
    "  r.referral_id,",
    "  r.created_at_utc,",
    "  MIN(CASE WHEN h.new_status IN ('Acknowledged', 'Accepted', 'In Review', 'Declined') THEN h.changed_at_utc END) AS first_response_utc,",
    "  MIN(CASE WHEN h.new_status IN ('Service Delivered', 'Completed') THEN h.changed_at_utc END) AS service_delivered_utc",
    "FROM referrals r",
    "LEFT JOIN referral_status_history h ON r.referral_id = h.referral_id",
    "WHERE r.created_at_utc >= @startDate AND r.created_at_utc <= @endDate"
  ].join(" ");

  const params = { startDate, endDate };

  if (programId) {
    baseQuery += " AND (r.referring_program_id = @programId OR r.receiving_program_id = @programId)";
    params.programId = programId;
  } else if (departmentId) {
    baseQuery += " AND (r.referring_department_id = @departmentId OR r.receiving_department_id = @departmentId)";
    params.departmentId = departmentId;
  }

  baseQuery += " GROUP BY r.referral_id, r.created_at_utc";

  const rows = await db.query(baseQuery, params);

  if (!rows || rows.length === 0) {
    return {
      avgTimeToFirstResponseHours: null,
      avgTimeToRecordedServiceHours: null,
      medianTimeToRecordedServiceHours: null
    };
  }

  const responseDurations = [];
  const serviceDurations = [];

  for (const row of rows) {
    const createdTime = new Date(row.created_at_utc).getTime();

    if (row.first_response_utc) {
      const respTime = new Date(row.first_response_utc).getTime();
      const hours = (respTime - createdTime) / (1000 * 60 * 60);
      if (hours >= 0) responseDurations.push(hours);
    }

    if (row.service_delivered_utc) {
      const svcTime = new Date(row.service_delivered_utc).getTime();
      const hours = (svcTime - createdTime) / (1000 * 60 * 60);
      if (hours >= 0) serviceDurations.push(hours);
    }
  }

  const calcAvg = (arr) => arr.length > 0 ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null;

  const calcMedian = (arr) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return Number(median.toFixed(2));
  };

  return {
    avgTimeToFirstResponseHours: calcAvg(responseDurations),
    avgTimeToRecordedServiceHours: calcAvg(serviceDurations),
    medianTimeToRecordedServiceHours: calcMedian(serviceDurations)
  };
}

/**
 * Calculates P0 Reporting Breadth Metrics per PRD Section 12.4:
 *  - Acceptance %
 *  - Resulted-in-Service %
 *  - Awaiting Response count
 *  - Not Appropriate count
 *  - Made / Received counts by Program and Department
 */
async function getReportingBreadthMetrics(db, { startDate, endDate, departmentId, programId }) {
  let baseQuery = [
    "SELECT",
    "  r.referral_id,",
    "  r.status AS current_status,",
    "  r.decline_reason,",
    "  r.referring_program_id,",
    "  r.receiving_program_id,",
    "  r.referring_department_id,",
    "  r.receiving_department_id,",
    "  COUNT(CASE WHEN h.new_status IN ('Accepted', 'Service Delivered', 'Completed') THEN 1 END) AS has_accepted,",
    "  COUNT(CASE WHEN h.new_status IN ('Service Delivered', 'Completed') THEN 1 END) AS has_service",
    "FROM referrals r",
    "LEFT JOIN referral_status_history h ON r.referral_id = h.referral_id",
    "WHERE r.created_at_utc >= @startDate AND r.created_at_utc <= @endDate"
  ].join(" ");

  const params = { startDate, endDate };

  if (programId) {
    baseQuery += " AND (r.referring_program_id = @programId OR r.receiving_program_id = @programId)";
    params.programId = programId;
  } else if (departmentId) {
    baseQuery += " AND (r.referring_department_id = @departmentId OR r.receiving_department_id = @departmentId)";
    params.departmentId = departmentId;
  }

  baseQuery += " GROUP BY r.referral_id, r.status, r.decline_reason, r.referring_program_id, r.receiving_program_id, r.referring_department_id, r.receiving_department_id";

  const rows = await db.query(baseQuery, params);

  const totalCount = rows ? rows.length : 0;
  if (totalCount === 0) {
    return {
      totalReferrals: 0,
      acceptanceRatePct: 0,
      resultedInServiceRatePct: 0,
      awaitingResponseCount: 0,
      notAppropriateCount: 0,
      madeCount: 0,
      receivedCount: 0
    };
  }

  let acceptedCount = 0;
  let serviceCount = 0;
  let awaitingResponseCount = 0;
  let notAppropriateCount = 0;
  let madeCount = 0;
  let receivedCount = 0;

  for (const row of rows) {
    if (row.has_accepted > 0 || ['Accepted', 'Service Delivered', 'Completed'].includes(row.current_status)) {
      acceptedCount++;
    }
    if (row.has_service > 0 || ['Service Delivered', 'Completed'].includes(row.current_status)) {
      serviceCount++;
    }
    if (['Pending', 'In Review'].includes(row.current_status)) {
      awaitingResponseCount++;
    }
    if (row.current_status === 'Declined' && row.decline_reason === 'Not Appropriate') {
      notAppropriateCount++;
    }

    if (programId) {
      if (row.referring_program_id === programId) madeCount++;
      if (row.receiving_program_id === programId) receivedCount++;
    } else if (departmentId) {
      if (row.referring_department_id === departmentId) madeCount++;
      if (row.receiving_department_id === departmentId) receivedCount++;
    } else {
      madeCount++;
      receivedCount++;
    }
  }

  return {
    totalReferrals: totalCount,
    acceptanceRatePct: Number(((acceptedCount / totalCount) * 100).toFixed(2)),
    resultedInServiceRatePct: Number(((serviceCount / totalCount) * 100).toFixed(2)),
    awaitingResponseCount,
    notAppropriateCount,
    madeCount,
    receivedCount
  };
}

module.exports = {
  getTotalReferrals,
  getTimingMetrics,
  getReportingBreadthMetrics
};