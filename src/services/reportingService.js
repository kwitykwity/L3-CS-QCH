/**
 * Reporting Service - PRD Canonical Reporting Metrics (§12.4)
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
    WITH Durations AS (
      SELECT 
        referral_id,
        CAST(DATEDIFF(SECOND, created_at, first_responded_at) AS FLOAT) / 3600.0 AS response_hours,
        CAST(DATEDIFF(SECOND, created_at, first_resulted_in_service_at) AS FLOAT) / 3600.0 AS service_hours
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

  query += `
    ),
    Medians AS (
      SELECT DISTINCT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY service_hours) OVER () AS median_hours_to_service_delivery
      FROM Durations
      WHERE service_hours IS NOT NULL
    )
    SELECT 
      (SELECT COUNT(referral_id) FROM Durations) AS cohort_size,
      (SELECT AVG(response_hours) FROM Durations) AS avg_hours_to_first_response,
      (SELECT AVG(service_hours) FROM Durations) AS avg_hours_to_service_delivery,
      (SELECT median_hours_to_service_delivery FROM Medians) AS median_hours_to_service_delivery
  `;

  const result = await db.query(query, params);
  const row = result && result[0] ? result[0] : {};
  const cohortSize = Number(row.cohort_size || 0);

  if (cohortSize === 0) {
    return { cohortSize: 0, avgHoursToFirstResponse: null, avgHoursToServiceDelivery: null, medianHoursToServiceDelivery: null };
  }

  return {
    cohortSize,
    avgHoursToFirstResponse: row.avg_hours_to_first_response != null ? Number(Number(row.avg_hours_to_first_response).toFixed(2)) : null,
    avgHoursToServiceDelivery: row.avg_hours_to_service_delivery != null ? Number(Number(row.avg_hours_to_service_delivery).toFixed(2)) : null,
    medianHoursToServiceDelivery: row.median_hours_to_service_delivery != null ? Number(Number(row.median_hours_to_service_delivery).toFixed(2)) : null
  };
}

export async function getReportingBreadthMetrics(db, { startDate, endDate, departmentId, programId }) {
  let query = `
    SELECT 
      COUNT(referral_id) AS total_count,
      SUM(CASE WHEN decision = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted_count,
      SUM(CASE WHEN decision = 'NOT_APPROPRIATE' THEN 1 ELSE 0 END) AS not_appropriate_count,
      SUM(CASE WHEN service_outcome = 'RESULTED_IN_SERVICE' THEN 1 ELSE 0 END) AS service_delivered_count,
      SUM(CASE WHEN service_outcome = 'DID_NOT_RESULT_IN_SERVICE' THEN 1 ELSE 0 END) AS no_service_count,
      SUM(CASE WHEN response_status = 'AWAITING_RESPONSE' THEN 1 ELSE 0 END) AS awaiting_count,
      SUM(CASE WHEN referring_program_id = @programId OR (@departmentId IS NOT NULL AND referring_department_id = @departmentId) THEN 1 ELSE 0 END) AS made_scoped_count,
      SUM(CASE WHEN receiving_program_id = @programId OR (@departmentId IS NOT NULL AND receiving_department_id = @departmentId) THEN 1 ELSE 0 END) AS received_scoped_count
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

  const acceptedCount = Number(row.accepted_count || 0);
  const notAppropriateCount = Number(row.not_appropriate_count || 0);
  const decisionDenominator = acceptedCount + notAppropriateCount;
  const acceptanceRatePct = decisionDenominator > 0 
    ? Number(((acceptedCount / decisionDenominator) * 100).toFixed(2)) 
    : 'N/A';

  const serviceDeliveredCount = Number(row.service_delivered_count || 0);
  const noServiceCount = Number(row.no_service_count || 0);
  const outcomeDenominator = serviceDeliveredCount + noServiceCount;
  const resultedInServiceRatePct = outcomeDenominator > 0 
    ? Number(((serviceDeliveredCount / outcomeDenominator) * 100).toFixed(2)) 
    : 'N/A';

  const isOrgWide = !programId && !departmentId;

  return {
    totalReferrals: totalCount,
    acceptanceRatePct,
    resultedInServiceRatePct,
    awaitingResponseCount: Number(row.awaiting_count || 0),
    notAppropriateCount,
    madeCount: isOrgWide ? totalCount : Number(row.made_scoped_count || 0),
    receivedCount: isOrgWide ? totalCount : Number(row.received_scoped_count || 0)
  };
}
