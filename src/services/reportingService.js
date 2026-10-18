/**
 * Reporting Service - Server-Side Canonical Reporting Metrics
 * Source of Truth: QCH_Connect_Final_Tech_PRD_Oct14_2026.docx (Section 12.4)
 */

export async function getTotalReferrals(db, { startDate, endDate, departmentId, programId }) {
  let query = "SELECT COUNT(referral_id) AS total_referrals FROM referral WHERE created_at_utc >= @startDate AND created_at_utc <= @endDate";
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
  let baseQuery = `
    SELECT 
      AVG(JULIANDAY(first_response_at_utc) - JULIANDAY(created_at_utc)) * 24.0 AS avg_hours_to_first_response,
      AVG(JULIANDAY(service_delivered_at_utc) - JULIANDAY(created_at_utc)) * 24.0 AS avg_hours_to_service_delivery,
      COUNT(referral_id) AS cohort_size
    FROM referral
    WHERE created_at_utc >= @startDate AND created_at_utc <= @endDate
  `;
  const params = { startDate, endDate };

  if (programId) {
    baseQuery += " AND (referring_program_id = @programId OR receiving_program_id = @programId)";
    params.programId = programId;
  } else if (departmentId) {
    baseQuery += " AND (referring_department_id = @departmentId OR receiving_department_id = @departmentId)";
    params.departmentId = departmentId;
  }

  const result = await db.query(baseQuery, params);
  const row = result && result[0] ? result[0] : {};

  return {
    cohortSize: Number(row.cohort_size || 0),
    avgHoursToFirstResponse: row.avg_hours_to_first_response !== null && row.avg_hours_to_first_response !== undefined ? Number(Number(row.avg_hours_to_first_response).toFixed(2)) : null,
    avgHoursToServiceDelivery: row.avg_hours_to_service_delivery !== null && row.avg_hours_to_service_delivery !== undefined ? Number(Number(row.avg_hours_to_service_delivery).toFixed(2)) : null
  };
}

export async function getReportingBreadthMetrics(db, { startDate, endDate, departmentId, programId }) {
  let query = "SELECT status, referring_program_id, receiving_program_id, referring_department_id, receiving_department_id FROM referral WHERE created_at_utc >= @startDate AND created_at_utc <= @endDate";
  const params = { startDate, endDate };

  if (programId) {
    query += " AND (referring_program_id = @programId OR receiving_program_id = @programId)";
    params.programId = programId;
  } else if (departmentId) {
    query += " AND (referring_department_id = @departmentId OR receiving_department_id = @departmentId)";
    params.departmentId = departmentId;
  }

  const rows = await db.query(query, params);

  let totalCount = rows.length;
  let acceptedCount = 0;
  let serviceCount = 0;
  let awaitingResponseCount = 0;
  let notAppropriateCount = 0;
  let madeCount = 0;
  let receivedCount = 0;

  for (const row of rows) {
    if (row.status === 'ACCEPTED' || row.status === 'Accepted') acceptedCount++;
    if (row.status === 'FULFILLED' || row.status === 'Service Delivered') serviceCount++;
    if (row.status === 'PENDING' || row.status === 'In Review') awaitingResponseCount++;
    if (row.status === 'DECLINED' || row.status === 'Not Appropriate') notAppropriateCount++;

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
    acceptanceRatePct: totalCount > 0 ? Number(((acceptedCount / totalCount) * 100).toFixed(2)) : 0,
    resultedInServiceRatePct: totalCount > 0 ? Number(((serviceCount / totalCount) * 100).toFixed(2)) : 0,
    awaitingResponseCount,
    notAppropriateCount,
    madeCount,
    receivedCount
  };
}
