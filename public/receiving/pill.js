// Status pill for the referral lists (Task 252, wireframes 4 and 6). The
// words are the stage label already used on these pages; the color only
// repeats them (never color alone). A Complete referral is green only when
// it resulted in service; Not appropriate is orange and Did not result in
// service is gray, so a closed referral never looks like a success it was
// not. Built with textContent only.
export function pillTone(referral) {
  if (referral.stage === 'ACCEPTED_OUTCOME_PENDING') return 'info';
  if (referral.stage !== 'COMPLETE') return 'neutral';
  if (referral.decision === 'NOT_APPROPRIATE') return 'warning';
  return referral.serviceOutcome === 'RESULTED_IN_SERVICE' ? 'success' : 'neutral';
}
