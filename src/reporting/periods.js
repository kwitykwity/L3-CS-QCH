// Reporting periods (PRD 12.2). All boundaries are midnight in the QCH
// reporting time zone, America/New_York (IANA rules, so the EDT -> EST
// change is handled; never a fixed offset). Periods are half-open:
// [start, end). A referral at exactly `end` belongs to the next period.
//
//   WEEKLY     Sunday to Saturday, whole weeks
//   MONTHLY    calendar month
//   QUARTERLY  fiscal quarter: Q1 Jul-Sep, Q2 Oct-Dec, Q3 Jan-Mar, Q4 Apr-Jun
//   YEARLY     fiscal year, July 1 to June 30. Named for the year it ENDS
//              (FY2027 = Jul 1, 2026 to Jun 30, 2027).
//
// Source: PRD 12.2; fiscal naming confirmed by the Team Lead (Oct 18, 2026).

export const REPORTING_TIME_ZONE = 'America/New_York';
export const PERIOD_TYPES = Object.freeze(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']);

const zoneFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: REPORTING_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric',
});

function zoneParts(instantMs) {
  const p = Object.fromEntries(zoneFormat.formatToParts(new Date(instantMs)).map((x) => [x.type, Number(x.value)]));
  return p;
}

// Offset (ms) of the reporting zone from UTC at an instant.
function offsetAt(instantMs) {
  const p = zoneParts(instantMs);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instantMs / 1000) * 1000;
}

// The UTC instant of local midnight on a calendar date. Midnight is never
// skipped or repeated in this zone (changes happen at 2 AM).
export function localMidnightUtc(year, month, day) {
  const wall = Date.UTC(year, month - 1, day);
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return new Date(guess);
}

// The calendar date (in the reporting zone) of an instant.
export function localDateOf(instant) {
  const p = zoneParts(instant.getTime());
  return { year: p.year, month: p.month, day: p.day };
}

// Calendar arithmetic on {year, month, day}; month may overflow.
function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
const monthStart = (year, month) => {
  const d = new Date(Date.UTC(year, month - 1, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: 1 };
};

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = ({ year, month, day }) => `${year}-${pad(month)}-${pad(day)}`;

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;

// Strict YYYY-MM-DD -> {year, month, day}, or null if malformed / not a real date.
export function parseDateText(text) {
  const m = typeof text === 'string' ? DATE_TEXT.exec(text) : null;
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (check.getUTCFullYear() !== date.year || check.getUTCMonth() + 1 !== date.month || check.getUTCDate() !== date.day) {
    return null;
  }
  return date;
}

// The period of `periodType` that contains the local calendar date `date`.
// Returns { periodType, label, startDate, endDate (exclusive, as local dates),
//           start, end (UTC Date instants) }.
export function periodContaining(periodType, date) {
  let first;   // local start date
  let next;    // local exclusive end date
  let label;

  if (periodType === 'WEEKLY') {
    const dow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay(); // 0 = Sunday
    first = addDays(date, -dow);
    next = addDays(first, 7);
    label = `Week of ${isoDate(first)}`;
  } else if (periodType === 'MONTHLY') {
    first = monthStart(date.year, date.month);
    next = monthStart(date.year, date.month + 1);
    label = `${date.year}-${pad(date.month)}`;
  } else if (periodType === 'QUARTERLY' || periodType === 'YEARLY') {
    // Fiscal year starts July 1 and is named for the year it ends.
    const fyStartYear = date.month >= 7 ? date.year : date.year - 1;
    const fy = fyStartYear + 1;
    if (periodType === 'YEARLY') {
      first = { year: fyStartYear, month: 7, day: 1 };
      next = { year: fyStartYear + 1, month: 7, day: 1 };
      label = `FY${fy}`;
    } else {
      const monthsIntoFy = (date.month - 7 + 12) % 12;      // 0..11
      const q = Math.floor(monthsIntoFy / 3);               // 0..3
      first = monthStart(fyStartYear, 7 + q * 3);
      next = monthStart(fyStartYear, 7 + q * 3 + 3);
      label = `FY${fy} Q${q + 1}`;
    }
  } else {
    throw new Error('unknown period type');
  }

  return {
    periodType,
    label,
    startDate: isoDate(first),
    endDate: isoDate(next),
    start: localMidnightUtc(first.year, first.month, first.day),
    end: localMidnightUtc(next.year, next.month, next.day),
  };
}
