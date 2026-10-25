// Calls to the reporting API for the Reporting Center page.
//
//   GET /api/reports/referral-activity?period=&date=&programId|departmentId=
//   GET /api/reports/total-referrals?...      (same query)
//   GET /api/reports/timing-metrics?...       (same query)
//   GET /api/programs                         (names for the Program picker)
//   GET /api/reports/departments              (every Department, for the Department picker)
//
// - GET only, aggregate only. The reporting routes allowlist their query
//   parameters, so only period, date, programId and departmentId are sent.
// - Nothing is logged to the console (PRD 5.5, 15.3).
// - Every call returns { status, body } or { networkError: true }; it never
//   throws, so the page always reaches a defined state.
// - The page only knows this API boundary, not how the data is stored.

const TIMEOUT_MS = 15000;

async function get(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = query ? `${path}?${query}` : path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch {
    return { networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

export const api = Object.freeze({
  listPrograms: () => get('/api/programs'),
  listDepartments: () => get('/api/reports/departments'),
  activity: (params) => get('/api/reports/referral-activity', params),
  total: (params) => get('/api/reports/total-referrals', params),
  timing: (params) => get('/api/reports/timing-metrics', params),
});
