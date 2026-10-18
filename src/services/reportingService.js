/**
 * Reporting Service - Azure SQL DB (T-SQL) Canonical Reporting Metrics
 * Source of Truth: db/migrations/001_core_schema.sql & Final Technical PRD Section 12.4
 */

export async function getTotalReferrals(db, { startDate, endDate, departmentId, programId }) {
  let query = "SELECT COUNT(referral_id) AS total_referrals FROM dbo.referrals WHERE created_at >= @startDate AND created_at <= @endDate";
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
  let query = `
    SELECT 
      COUNT(referral_id) AS cohort_size,
      AVG(CAST(DATEDIFF(SECOND, created_at, first_responded_at) AS FLOAT) / 3600.0) AS avg_hours_to_first_response,
      AVG(CAST(DATEDIFF(SECOND, created_at, first_resulted_in_service_at) AS FLOAT) / 3600.0) AS avg_hours_to_service_delivery
    FROM dbo.referrals
    WHERE created_at >= @startDate AND created_at <= @endDate
  `;
  const params = { startDate, endDate };

  if (programId) {
    query += " AND (referring_program_id = @programId OR receiving_program_id = @programId)";
    params.programId = programId;
  } else if (departmentId) {
    query += " AND (referring_department_id = @departmentId OR receiving_department_id = @departmentId)";
    params.departmentId = departmentId;
  }

  const result = await db.query(query, params);
  const row = result && result[0] ? result[0] : {};
  const cohortSize = Number(row.cohort_size || 0);

  if (cohortSize === 0) {
    return { cohortSize: 0, avgHoursToFirstResponse: null, avgHoursToServiceDelivery: null };
  }

  return {
    cohortSize,
    avgHoursToFirstResponse: row.avg_hours_to_first_response != null ? Number(Number(row.avg_hours_to_first_response).toFixed(2)) : null,
    avgHoursToServiceDelivery: row.avg_hours_to_service_delivery != null ? Number(Number(row.avg_hours_to_service_delivery).toFixed(2)) : null
  };
}

export async function getReportingBreadthMetrics(db, { startDate, endDate, departmentId, programId }) {
  let query = `
    SELECT 
      COUNT(referral_id) AS total_count,
      SUM(CASE WHEN decision = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted_count,
      SUM(CASE WHEN service_outcome = 'RESULTED_IN_SERVICE' THEN 1 ELSE 0 END) AS service_count,
      SUM(CASE WHEN response_status = 'AWAITING_RESPONSE' THEN 1 ELSE 0 END) AS awaiting_count,
      SUM(CASE WHEN decision = 'NOT_APPROPRIATE' THEN 1 ELSE 0 END) AS not_appropriate_count,
      SUM(CASE WHEN referring_program_id = @programId OR referring_department_id = @departmentId THEN 1 ELSE 0 END) AS made_count,
      SUM(CASE WHEN receiving_program_id = @programId OR receiving_department_id = @departmentId THEN 1 ELSE 0 END) AS received_count
    FROM dbo.referrals
    WHERE created_at >= @startDate AND created_at <= @endDate
  `;
  const params = { startDate, endDate, programId: programId || null, departmentId: departmentId || null };

  if (programId) {
    query += " AND (referring_program_id = @programId OR receiving_program_id = @programId)";
  } else if (departmentId) {
    query += " AND (referring_department_id = @departmentId OR receiving_department_id = @departmentId)";
  }

  const result = await db.query(query, params);
  const row = result && result[0] ? result[0] : {};
  const totalCount = Number(row.total_count || 0);

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

  const acceptedCount = Number(row.accepted_count || 0);
  const serviceCount = Number(row.service_count || 0);

  return {
    totalReferrals: totalCount,
    acceptanceRatePct: Number(((acceptedCount / totalCount) * 100).toFixed(2)),
    resultedInServiceRatePct: Number(((serviceCount / totalCount) * 100).toFixed(2)),
    awaitingResponseCount: Number(row.awaiting_count || 0),
    notAppropriateCount: Number(row.not_appropriate_count || 0),
    madeCount: Number(row.made_count || 0),
    receivedCount: Number(row.received_count || 0)
  };
}
