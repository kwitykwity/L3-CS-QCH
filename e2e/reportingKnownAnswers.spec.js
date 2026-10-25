// Reporting Center known answers on screen (Task M; Trello "Testing:
// Reporting browser journeys"; Final Technical PRD 12.2 to 12.7, 14, 17.6).
// SYNTHETIC data only.
//
// The API journey (test/regression/reportingJourney.test.js) checks the
// reports against hand-worked answers. This file opens the real Reporting
// Center in a browser, over the SAME nine-referral world, and checks that
// what a signed-in person sees on screen says the same thing:
//
//   - every period type, organization-wide (KNOWN_ANSWERS)
//   - Program scope and Department scope with history (KNOWN_SCOPES)
//   - the Program and Department tables (KNOWN_BREAKDOWNS)
//   - zero vs No data vs Pending vs N/A stay different on screen
//   - partial periods show the "data as of" note
//   - a date after "today" is refused with a clear message
//   - an inactive or signed-out person sees no numbers at all
//
// "Unknown" (the server left a value out) cannot come from a working
// server, so it is checked with stubbed responses in
// test/reportingUi.test.js instead.
//
// Expected words come from two places on purpose:
//   1. KNOWN_ANSWERS passed through public/reporting/format.js, so every
//      number on screen is checked against the shared answers, and
//   2. a few spellings written out by hand ("85.71%", "5 h 51 min"), so a
//      mistake in format.js cannot hide by being checked against itself.
//
// The world is built on a private copy of the app (its own store, its own
// clock fixed at AS_OF, one person per browser context), closed with the
// same bounded teardown as card 51 (e2e/receivingLifecycle.spec.js).

import { test, expect } from '@playwright/test';
import {
  AS_OF, IDS, KNOWN_ANSWERS, KNOWN_BREAKDOWNS, KNOWN_SCOPES, USERS, buildReportingWorld,
} from '../test/regression/reportingFixture.js';
import { countView, formatRate, formatTiming } from '../public/reporting/format.js';
import { expectNoAxeViolations } from './helpers.js';

const CONTEXT_CLOSE_MS = 5_000;
const SERVER_CLOSE_GRACE_MS = 5_000;

let server;
let base;
const contexts = new Set();  // every context openAs() has opened and not closed
const sockets = new Set();   // open connections to the private server

test.beforeAll(async () => {
  const world = await buildReportingWorld();
  const { createApp } = await import('../src/app.js');
  const resolveIdentity = (req) => {
    const match = /(?:^|;\s*)qch-test-user=(\d+)/.exec(req.headers.cookie ?? '');
    return match ? { userId: Number(match[1]) } : null;
  };
  const app = createApp({
    affiliationStore: world.store,
    referralStore: world.store,
    resolveIdentity,
    nodeEnv: 'test',
    // "Today" for every report is the fixture's AS_OF, as in the API journey.
    now: () => new Date(AS_OF),
  });
  server = app.listen(0, '127.0.0.1');
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});

// Resolves to true if `promise` settles within `ms`, false otherwise.
// Never rejects, and never leaves its timer running.
async function settlesWithin(promise, ms) {
  let timer;
  const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  try {
    return await Promise.race([promise.then(() => true, () => true), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function closeContexts() {
  const open = [...contexts];
  contexts.clear();
  const closed = await Promise.all(open.map((context) => settlesWithin(context.close(), CONTEXT_CLOSE_MS)));
  const stuck = closed.filter((ok) => !ok).length;
  if (stuck) console.warn(`[task M] ${stuck} browser context(s) did not close within ${CONTEXT_CLOSE_MS} ms`);
}

async function stopServer() {
  if (!server) return;
  const closed = new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  server.closeIdleConnections();
  if (await settlesWithin(closed, SERVER_CLOSE_GRACE_MS)) {
    await closed;
    return;
  }
  console.warn(`[task M] ${sockets.size} connection(s) still open ${SERVER_CLOSE_GRACE_MS} ms after close; closing them`);
  server.closeAllConnections();
  await closed;
}

test.afterEach(async () => {
  await closeContexts();
});

test.afterAll(async () => {
  await closeContexts();
  await stopServer();
});

// Opens the Reporting Center as one synthetic person (or nobody).
async function openAs(browser, userId) {
  const context = await browser.newContext({ baseURL: base });
  contexts.add(context);
  if (userId) await context.addCookies([{ name: 'qch-test-user', value: String(userId), url: base }]);
  const page = await context.newPage();
  await page.goto('/reporting/');
  return page;
}

// Fills the filters like a person would and presses Show report, then
// waits until the screen shows THIS period's dates and THIS scope (no two
// reports in a row here share both).
async function showReport(page, { query, period }, scope = null) {
  await page.locator('#period').selectOption(query.period);
  await page.locator('#date').fill(query.date);
  await page.locator('#scope-type').selectOption(scope ? scope.type : 'ORGANIZATION');
  if (scope) await page.locator('#scope-target').selectOption({ label: scope.label });
  await page.getByRole('button', { name: 'Show report', exact: true }).click();
  await expect(page.locator('#ctx-range')).toHaveText(`${period.start} up to, but not including, ${period.endExclusive}`);
  const scopeText = scope ? `${scope.type === 'PROGRAM' ? 'Program' : 'Department'}: ${scope.label}` : 'All of QCH';
  await expect(page.locator('#ctx-scope')).toHaveText(scopeText);
  await expect(page.locator('#status')).toHaveText(/^Report loaded for /);
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#results')).toBeVisible();
}

// One metric card, found by its exact heading.
function card(page, section, title) {
  return page.locator(`#${section} .metric`).filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

// The card shows the view's value, badge and explanation.
async function expectCard(page, section, title, view) {
  const c = card(page, section, title);
  await expect(c, `${section}: ${title}`).toHaveCount(1);
  await expect(c.locator('.metric__value'), `${title} value`).toHaveText(view.label);
  if (view.badge) await expect(c.locator('.badge'), `${title} badge`).toHaveText(view.badge);
  if (view.detail) await expect(c, `${title} detail`).toContainText(view.detail);
}

async function expectSummary(page, expected) {
  const s = expected.summary;
  await expectCard(page, 'counts', 'Total referrals', countView(expected.total));
  await expectCard(page, 'counts', 'Awaiting response', countView(s.awaitingResponse));
  await expectCard(page, 'counts', 'Accepted', countView(s.accepted));
  await expectCard(page, 'counts', 'Not appropriate', countView(s.notAppropriate));
  await expectCard(page, 'counts', 'Resulted in service', countView(s.resultedInService));
  await expectCard(page, 'counts', 'Did not result in service', countView(s.didNotResultInService));
  await expectCard(page, 'rates', 'Acceptance rate', formatRate(s.acceptanceRate));
  await expectCard(page, 'rates', 'Not appropriate rate', formatRate(s.notAppropriateRate));
  await expectCard(page, 'rates', 'Resulted-in-service rate', formatRate(s.resultedInServiceRate));
  await expectTiming(page, expected);
}

async function expectTiming(page, expected) {
  await expectCard(page, 'timing', 'Average time to first response', formatTiming(expected.timeToFirstResponse, 'averageMs'));
  await expectCard(page, 'timing', 'Median time to first response', formatTiming(expected.timeToFirstResponse, 'medianMs'));
  await expectCard(page, 'timing', 'Average time to recorded service', formatTiming(expected.timeToRecordedService, 'averageMs'));
  await expectCard(page, 'timing', 'Median time to recorded service', formatTiming(expected.timeToRecordedService, 'medianMs'));
}

// One row of the Program or Department table.
async function expectRow(page, bodyId, row) {
  const tr = page.locator(`#${bodyId} tr`).filter({ has: page.getByRole('rowheader', { name: row.name, exact: true }) });
  await expect(tr, `${bodyId}: ${row.name}`).toHaveCount(1);
  const cells = tr.locator('td');
  const counts = [row.made, row.received, row.accepted, row.notAppropriate, row.awaitingResponse, row.resultedInService];
  for (const [i, n] of counts.entries()) await expect(cells.nth(i), `${row.name} column ${i + 1}`).toHaveText(String(n));
  for (const [i, rate] of [[6, row.acceptanceRate], [7, row.resultedInServiceRate]]) {
    const view = formatRate(rate);
    await expect(cells.nth(i).locator('.rate__value'), `${row.name} rate`).toHaveText(view.label);
    await expect(cells.nth(i).locator('.badge'), `${row.name} rate badge`).toHaveText(view.badge);
  }
}

test.describe('Reporting Center shows the known answers (Task M)', () => {
  test('every period type, organization-wide, matches the API known answers', async ({ browser }) => {
    const page = await openAs(browser, USERS.NO_GRANTS);
    await expect(page.locator('#status')).toHaveText(/^Report loaded for /);

    for (const [name, expected] of Object.entries(KNOWN_ANSWERS)) {
      await test.step(name, async () => {
        await showReport(page, expected);
        const { period } = expected;
        if (period.label) await expect(page.locator('#ctx-period')).toHaveText(`${period.label} (${period.type})`);
        else await expect(page.locator('#ctx-period')).toHaveText(new RegExp(`\\(${period.type}\\)$`));
        await expect(page.locator('#ctx-scope')).toHaveText('All of QCH');
        // Noon in New York on Oct 24 (the space before PM may be a narrow one).
        await expect(page.locator('#ctx-asof')).toHaveText(/^Oct 24, 2026, 12:00\sPM ET$/);
        if (expected.partial) await expect(page.locator('#partial-note')).toBeVisible();
        else await expect(page.locator('#partial-note')).toBeHidden();
        await expect(page.locator('#mismatch-note')).toBeHidden();
        await expectSummary(page, expected);
      });
    }
  });

  test('hand-written spellings: zero, No data, Pending and N/A never look alike', async ({ browser }) => {
    const page = await openAs(browser, USERS.NO_GRANTS);
    await expect(page.locator('#status')).toHaveText(/^Report loaded for /);
    const value = (section, title) => card(page, section, title).locator('.metric__value');

    // FY2027 so far: 6 of 7 decided were accepted; first response 41/7 h.
    await showReport(page, KNOWN_ANSWERS.YEAR);
    await expect(value('counts', 'Total referrals')).toHaveText('9');
    await expect(value('rates', 'Acceptance rate')).toHaveText('85.71%');
    await expect(card(page, 'rates', 'Acceptance rate')).toContainText('6 of 7');
    await expect(value('rates', 'Not appropriate rate')).toHaveText('14.29%');
    await expect(value('rates', 'Resulted-in-service rate')).toHaveText('50%');
    await expect(value('timing', 'Average time to first response')).toHaveText('5 h 51 min');
    await expect(value('timing', 'Median time to first response')).toHaveText('3 h');
    await expect(value('timing', 'Average time to recorded service')).toHaveText('2 d');
    await expect(card(page, 'timing', 'Average time to recorded service')).toContainText('From 3 referrals');
    await expect(page.locator('#partial-note')).toBeVisible();

    // Q1: a finished period, no partial note; 37/5 h = 7 h 24 min.
    await showReport(page, KNOWN_ANSWERS.Q1);
    await expect(page.locator('#ctx-period')).toHaveText('FY2027 Q1 (QUARTERLY)');
    await expect(value('timing', 'Average time to first response')).toHaveText('7 h 24 min');
    await expect(value('rates', 'Resulted-in-service rate')).toHaveText('33.33%');
    await expect(page.locator('#partial-note')).toBeHidden();

    // August: one referral, never answered. Pending, not 0%; N/A, not 0 h.
    await showReport(page, KNOWN_ANSWERS.AUGUST);
    await expect(value('counts', 'Total referrals')).toHaveText('1');
    await expect(value('rates', 'Acceptance rate')).toHaveText('Pending');
    await expect(value('rates', 'Resulted-in-service rate')).toHaveText('No data');
    await expect(value('timing', 'Average time to first response')).toHaveText('N/A');
    await expect(card(page, 'timing', 'Average time to first response')).toContainText('No completed referrals yet. 1 still pending.');

    // September: Resulted, then corrected to Did Not. A REAL 0%.
    await showReport(page, KNOWN_ANSWERS.SEPTEMBER);
    await expect(value('rates', 'Resulted-in-service rate')).toHaveText('0%');
    await expect(card(page, 'rates', 'Resulted-in-service rate')).toContainText('0 of 1');
    await expect(value('counts', 'Resulted in service')).toHaveText('0');
    await expect(value('counts', 'Did not result in service')).toHaveText('1');

    // This week: accepted, outcome not recorded yet -> Pending.
    await showReport(page, KNOWN_ANSWERS.THIS_WEEK);
    await expect(value('rates', 'Resulted-in-service rate')).toHaveText('Pending');
    await expect(value('timing', 'Median time to recorded service')).toHaveText('N/A');

    // June 2026: nothing at all. A real zero count; every rate is No data.
    await showReport(page, KNOWN_ANSWERS.EMPTY_JUNE);
    await expect(value('counts', 'Total referrals')).toHaveText('0');
    for (const title of ['Acceptance rate', 'Not appropriate rate', 'Resulted-in-service rate']) {
      await expect(value('rates', title)).toHaveText('No data');
    }
    await expect(card(page, 'timing', 'Average time to first response')).toContainText('No referrals qualify in this period and scope.');
    await expect(page.locator('#programs-body')).toHaveText('No referrals in this period and scope.');
    await expect(page.locator('#departments-body')).toHaveText('No referrals in this period and scope.');
  });

  test('the Program and Department tables match the known breakdowns, and nothing names a person', async ({ browser }) => {
    const page = await openAs(browser, USERS.NO_GRANTS);
    await expect(page.locator('#status')).toHaveText(/^Report loaded for /);
    await showReport(page, KNOWN_ANSWERS.YEAR);

    const programs = Object.values(KNOWN_BREAKDOWNS.programs);
    const departments = Object.values(KNOWN_BREAKDOWNS.departments);
    await expect(page.locator('#programs-body tr')).toHaveCount(programs.length);
    await expect(page.locator('#departments-body tr')).toHaveCount(departments.length);
    for (const row of programs) await expectRow(page, 'programs-body', row);
    for (const row of departments) await expectRow(page, 'departments-body', row);

    // By hand: P11 decided one and turned it down (a real 0%); nothing it
    // received was accepted, so no outcome can come (No data).
    const youth = page.locator('#programs-body tr').filter({ hasText: 'Synthetic Youth Jobs' });
    await expect(youth.locator('td').nth(6).locator('.rate__value')).toHaveText('0%');
    await expect(youth.locator('td').nth(7).locator('.rate__value')).toHaveText('No data');

    // Aggregate only (PRD 3.5, 12.1): no participant names or needs anywhere.
    await expect(page.locator('body')).not.toContainText('Synthetic Person');
    await expect(page.locator('body')).not.toContainText('Synthetic need');

    await expectNoAxeViolations(page, 'Reporting Center with the known-answer year');
  });

  test('Program scope and Department scope (with history) match the known answers', async ({ browser }) => {
    const page = await openAs(browser, USERS.NO_GRANTS);
    await expect(page.locator('#status')).toHaveText(/^Report loaded for /);
    const year = KNOWN_ANSWERS.YEAR;

    // Program 12: made OR received, each once.
    const p12 = KNOWN_SCOPES.P12_YEAR;
    await showReport(page, year, { type: 'PROGRAM', label: KNOWN_BREAKDOWNS.programs[IDS.P12].name });
    await expect(page.locator('#ctx-scope')).toHaveText('Program: Synthetic Adult Education');
    await expect(page.locator('#scope-note')).toBeVisible();
    await expect(card(page, 'counts', 'Total referrals').locator('.metric__value')).toHaveText(String(p12.total));
    await expectCard(page, 'rates', 'Acceptance rate', formatRate(p12.acceptanceRate));
    await expectCard(page, 'rates', 'Resulted-in-service rate', formatRate(p12.resultedInServiceRate));
    await expectTiming(page, p12);
    // By hand: 35/6 h = 5 h 50 min; median 2.5 h.
    await expect(card(page, 'timing', 'Average time to first response').locator('.metric__value')).toHaveText('5 h 50 min');
    await expect(card(page, 'timing', 'Median time to first response').locator('.metric__value')).toHaveText('2 h 30 min');
    await expect(page.locator('#mismatch-note')).toBeHidden();

    // Departments: counted by the Department at creation. Program 12 moved
    // to Family Services on Oct 23, yet Adult Services still shows 8, not 2.
    for (const [key, id] of [['D1_YEAR', IDS.D1], ['D2_YEAR', IDS.D2]]) {
      const expected = KNOWN_SCOPES[key];
      const name = KNOWN_BREAKDOWNS.departments[id].name;
      await showReport(page, year, { type: 'DEPARTMENT', label: name });
      await expect(page.locator('#ctx-scope')).toHaveText(`Department: ${name}`);
      await expect(card(page, 'counts', 'Total referrals').locator('.metric__value')).toHaveText(String(expected.total));
      await expect(page.locator('#mismatch-note')).toBeHidden();
    }
  });

  test('a date after "today" is refused with a clear message and no numbers', async ({ browser }) => {
    const page = await openAs(browser, USERS.NO_GRANTS);
    await expect(page.locator('#status')).toHaveText(/^Report loaded for /);
    // AS_OF is Oct 24 in New York, so Oct 25 is in the future for the server.
    await page.locator('#period').selectOption('MONTHLY');
    await page.locator('#date').fill('2026-10-25');
    await page.getByRole('button', { name: 'Show report', exact: true }).click();
    await expect(page.locator('#error')).toHaveText('That date is not allowed. Use a date from 2000-01-01 up to today.');
    await expect(page.locator('#results')).toBeHidden();

    // Fixing the date brings the known answers back.
    await showReport(page, KNOWN_ANSWERS.OCTOBER);
    await expect(card(page, 'counts', 'Total referrals').locator('.metric__value')).toHaveText(String(KNOWN_ANSWERS.OCTOBER.total));
  });

  test('an inactive person and a signed-out person see no numbers', async ({ browser }) => {
    for (const [userId, message] of [
      [USERS.INACTIVE, 'You do not have access to reporting.'],
      [null, 'You are not signed in. Sign in and try again.'],
    ]) {
      const page = await openAs(browser, userId);
      await expect(page.locator('#error')).toBeVisible();
      await expect(page.locator('#error')).toContainText(message);
      await expect(page.locator('#results')).toBeHidden();
    }
  });
});
