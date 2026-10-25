// Display-only helpers for the Reporting Center (PRD 12.5, 12.6).
// No report formulas live here: every count, rate and duration comes from
// the server. These functions only choose WORDS for what the server sent,
// so zero, no data, unknown, pending and N/A stay visibly different.

const MINUTE_MS = 60000;

export function formatCount(n) {
  return Number.isSafeInteger(n) && n >= 0 ? String(n) : 'Unknown';
}

// A count view for a metric card. A real zero shows "0".
export function countView(n) {
  const label = formatCount(n);
  return label === 'Unknown' ? { label, badge: 'Unknown', kind: 'unknown' } : { label };
}

const UNKNOWN = Object.freeze({ kind: 'unknown', badge: 'Unknown', label: 'Unknown', detail: 'The server did not send this value.' });

// rate: { numerator, denominator, value, state } from the server.
export function formatRate(rate) {
  if (!rate || typeof rate !== 'object') return UNKNOWN;
  if (rate.state === 'CALCULATED' && Number.isFinite(rate.value)) {
    const detail = Number.isSafeInteger(rate.numerator) && Number.isSafeInteger(rate.denominator)
      ? `${rate.numerator} of ${rate.denominator}`
      : '';
    return { kind: 'calculated', badge: 'Calculated', label: `${rate.value}%`, detail };
  }
  if (rate.state === 'PENDING') {
    return { kind: 'pending', badge: 'Pending', label: 'Pending', detail: 'Nothing counted yet. Some referrals could still count.' };
  }
  if (rate.state === 'NO_DATA') {
    return { kind: 'no-data', badge: 'No data', label: 'No data', detail: 'Nothing to calculate from.' };
  }
  return UNKNOWN;
}

// Exact milliseconds from the server -> words (D4: the screen chooses units).
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'Unknown';
  const totalMinutes = Math.round(ms / MINUTE_MS);
  if (totalMinutes < 1) return 'Under 1 minute';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days > 0) {
    parts.push(`${days} d`);
    if (hours > 0) parts.push(`${hours} h`);
  } else {
    if (hours > 0) parts.push(`${hours} h`);
    if (minutes > 0) parts.push(`${minutes} min`);
  }
  return parts.join(' ');
}

// stat: { status: 'OK' | 'N/A', qualifyingCount, pendingCount, averageMs, medianMs }
// field: 'averageMs' or 'medianMs'
export function formatTiming(stat, field) {
  if (!stat || typeof stat !== 'object') return UNKNOWN;
  if (stat.status === 'OK' && Number.isFinite(stat[field])) {
    const n = stat.qualifyingCount;
    const detail = Number.isSafeInteger(n) ? `From ${n} ${n === 1 ? 'referral' : 'referrals'}` : '';
    return { kind: 'calculated', badge: 'Calculated', label: formatDuration(stat[field]), detail };
  }
  if (stat.status === 'N/A') {
    const pending = Number.isSafeInteger(stat.pendingCount) ? stat.pendingCount : 0;
    const detail = pending > 0
      ? `No completed referrals yet. ${pending} still pending.`
      : 'No referrals qualify in this period and scope.';
    return { kind: 'na', badge: 'N/A', label: 'N/A', detail };
  }
  return UNKNOWN;
}

// "Data as of" is shown in the QCH reporting time zone (PRD 9.7, 12.6).
export function formatAsOf(iso) {
  const d = new Date(iso);
  if (typeof iso !== 'string' || Number.isNaN(d.getTime())) return 'Unknown';
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
  return `${text} ET`;
}
