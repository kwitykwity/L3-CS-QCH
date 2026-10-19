// Derived referral stage (PRD 6.1, 6.5: completion is derived from
// Response + Decision + Service Outcome; there is no CLOSED state).
//
//   AWAITING_RESPONSE         response_status = 'AWAITING_RESPONSE'
//   ACCEPTED_OUTCOME_PENDING  decision = 'ACCEPTED' AND service_outcome = 'NOT_RECORDED'
//   COMPLETE                  everything else: NOT_APPROPRIATE, or ACCEPTED
//                             with a recorded service outcome
//
// The Azure SQL store must apply exactly these conditions in its WHERE
// clause when asked for a stage.

export const STAGES = Object.freeze(['AWAITING_RESPONSE', 'ACCEPTED_OUTCOME_PENDING', 'COMPLETE']);

export function stageOf(referral) {
  if (referral.responseStatus === 'AWAITING_RESPONSE') return 'AWAITING_RESPONSE';
  if (referral.decision === 'ACCEPTED' && referral.serviceOutcome === 'NOT_RECORDED') return 'ACCEPTED_OUTCOME_PENDING';
  return 'COMPLETE';
}
