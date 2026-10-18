/**
 * Reporting Service - Server-Side Canonical Reporting Metrics
 * Source of Truth: QCH_Connect_Final_Tech_PRD_Oct14_2026.docx (Section 12.4)
 */

export async function getTotalReferrals(db, { startDate, endDate, departmentId, programId }) {
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

export async function getTimingMetrics(db, { startDate, endDate, departmentId, programId }) {
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
  return rows;
}

export async function getReportingBreadthMetrics(db, { startDate, endDate, departmentId, programId }) {
  const query = "SELECT * FROM referrals WHERE created_at_utc >= @startDate AND created_at_utc <= @endDate";
  const rows = await db.query(query, { startDate, endDate });

  let totalCount = rows.length;
  let acceptedCount = 0;
  let serviceCount = 0;
  let awaitingResponseCount = 0;
  let notAppropriateCount = 0;
  let madeCount = 0;
  let receivedCount = 0;

  for (const row of rows) {
    if (row.status === 'Accepted') acceptedCount++;
    if (row.status === 'Service Delivered') serviceCount++;
    if (row.status === 'Pending') awaitingResponseCount++;
    if (row.status === 'Declined') notAppropriateCount++;

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
    acceptanceRatePct: totalCount ? Number(((acceptedCount / totalCount) * 100).toFixed(2)) : 0,
    resultedInServiceRatePct: totalCount ? Number(((serviceCount / totalCount) * 100).toFixed(2)) : 0,
    awaitingResponseCount,
    notAppropriateCount,
    madeCount,
    receivedCount
  };
}
