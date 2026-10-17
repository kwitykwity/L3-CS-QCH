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

module.exports = {
  getTotalReferrals
};
