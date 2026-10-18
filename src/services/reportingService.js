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

/**
 * Calculates timing metrics per PRD Section 12.4:
 *  - Time to First Response (hours)
 *  - Average Time to Recorded Service (hours)
 *  - Median Time to Recorded Service (hours)
 */
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

module.exports = {
  getTotalReferrals,
  getTimingMetrics
};