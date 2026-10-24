// Trello card 51: Testing: Receiving lifecycle browser journey.
//
// Done when: authorized staff can accept/reject, record outcomes, and make
// corrections; unauthorized access and stale updates are tested.
// (Final Technical PRD 2.3, 3.2, 3.3, 3.6, 3.7, 6.1, 6.2, 6.4, 6.5, 9.4,
// 9.6, 13.4, 17.2, 17.3.)
//
// The shared synthetic dev server has a single identity, so this spec runs
// its own copy of the app with several synthetic staff members. Each
// browser context is one person. Which person a request comes from is
// decided only by this test's resolveIdentity (from a test-only cookie),
// the same seam the real Entra sign-in will use; the app never reads an
// identity from the page, the body or the URL. SYNTHETIC data only.

import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './helpers.js';
import { syntheticSeed, NOT_APPROPRIATE_REASONS, RECEIVING_CAPABILITIES } from '../scripts/syntheticSeed.js';

const HOUSING = 4;  // receiving Program for everyone below except OUTSIDER
const JOBS = 5;     // OUTSIDER's receiving Program
const PEOPLE = {
  REFERRER: 10,     // sends referrals from Program 1; no receiving access
  RECEIVER_A: 20,   // every receiving capability for HOUSING
  RECEIVER_B: 21,   // every receiving capability for HOUSING
  VIEWER: 22,       // may only view HOUSING's received referrals
  RESPONDER: 23,    // may view and respond, nothing else
  REVOKED: 24,      // every capability, until a test revokes one
  OUTSIDER: 30,     // every receiving capability, but for JOBS
};
const COOKIE = 'qch-test-user';
const grant = (userId, permission, programId) => ({
  userId, permission, scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP',
});

let server;
let base;
let store;
let n = 0;
const RUN = Date.now().toString(36);

test.beforeAll(async () => {
  const { createApp } = await import('../src/app.js');
  const { createMemoryReferralStore } = await import('../src/referrals/memoryReferralStore.js');
  const seed = syntheticSeed();
  store = createMemoryReferralStore({
    ...seed,
    users: Object.values(PEOPLE).map((userId) => ({
      userId, isActive: true, currentProgramId: userId === PEOPLE.REFERRER ? 1 : null,
    })),
    grants: [
      ...[PEOPLE.RECEIVER_A, PEOPLE.RECEIVER_B, PEOPLE.REVOKED]
        .flatMap((u) => RECEIVING_CAPABILITIES.map((p) => grant(u, p, HOUSING))),
      ...RECEIVING_CAPABILITIES.map((p) => grant(PEOPLE.OUTSIDER, p, JOBS)),
      grant(PEOPLE.VIEWER, 'VIEW_RECEIVED_REFERRAL', HOUSING),
      grant(PEOPLE.RESPONDER, 'VIEW_RECEIVED_REFERRAL', HOUSING),
      grant(PEOPLE.RESPONDER, 'RESPOND_TO_REFERRAL', HOUSING),
    ],
    notAppropriateReasons: NOT_APPROPRIATE_REASONS.map((r) => ({ ...r })),
  });
  const resolveIdentity = (req) => {
    const match = /(?:^|;\s*)qch-test-user=(\d+)/.exec(req.headers.cookie ?? '');
    return match ? { userId: Number(match[1]) } : null;
  };
  const app = createApp({ affiliationStore: store, referralStore: store, resolveIdentity, nodeEnv: 'test' });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

// One browser context per person.
async function as(browser, person) {
  const context = await browser.newContext();
  await context.addCookies([{ name: COOKIE, value: String(person), url: base }]);
  return context.newPage();
}

// A request straight to the server as `person`, skipping every screen.
async function api(person, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: { cookie: `${COOKIE}=${person}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function send(programId = HOUSING) {
  n += 1;
  const result = await api(PEOPLE.REFERRER, 'POST', '/api/referrals', {
    submissionId: crypto.randomUUID(), receivingProgramId: programId,
    participantName: `Synthetic Lifecycle ${RUN}-${n}`, contactMethod: 'NOT_AVAILABLE',
    referralContext: `Synthetic need ${RUN}-${n}`,
  });
  expect(result.status).toBe(201);
  return result.body.referral.referralId;
}

// The authoritative row, read straight from the store.
const row = (id) => store.getReferralById(id);
const auditOf = (id) => store._referralAuditEvents
  .filter((e) => e.entityType === 'REFERRAL' && e.entityId === id)
  .map((e) => `${e.action} by ${e.actorUserId}`);

async function open(page, id) {
  await page.goto(`${base}/receiving/referral.html?id=${id}`);
  await expect(page.locator('#status .status__text')).toHaveText(/Referral loaded\.|not available/);
}
const status = (page) => page.locator('#status .status__text');
async function confirmAndClick(page, selector) {
  page.once('dialog', (d) => d.accept());
  await page.locator(selector).click();
}

// ---------------------------------------------------------------------
test.describe('authorized staff', () => {
  test('the whole loop in the browser across people: send, accept, record, correct, and the sender sees the result', async ({ browser }) => {
    // The referring worker sends through the New Referral page.
    const referrer = await as(browser, PEOPLE.REFERRER);
    await referrer.goto(`${base}/referral/`);
    await referrer.locator('#path-direct').click();
    await referrer.locator('#program-search').fill('Housing');
    await referrer.locator(`input[name="receivingProgram"][value="${HOUSING}"]`).check();
    await referrer.locator('#program-continue').click();
    await referrer.locator('#participantName').fill(`Synthetic Loop ${RUN}`);
    await referrer.locator('input[name="contactMethod"][value="NOT_AVAILABLE"]').check();
    await referrer.locator('#referralContext').fill('Synthetic need for the full loop');
    await referrer.locator('#send').click();
    await expect(referrer.locator('#status .status__text')).toContainText('Referral received !');
    const id = Number(/Referral ID: (\d+)/.exec(await referrer.locator('#status .status__text').textContent())[1]);

    // The receiving worker finds it in the list and works it through.
    const receiver = await as(browser, PEOPLE.RECEIVER_A);
    await receiver.goto(`${base}/receiving/`);
    const item = receiver.locator('.queue-item').filter({ hasText: `Synthetic Loop ${RUN}` });
    await expect(item.locator('dd')).toHaveText(['Awaiting response', 'No decision yet', 'Not recorded (no decision yet)']);
    await item.getByRole('link').click();
    await receiver.locator('#respond-accept').check();
    await confirmAndClick(receiver, '#respond-submit');
    await expect(status(receiver)).toHaveText('Response sent: Accepted. The service outcome is not recorded yet.');
    await receiver.locator('#outcome-resulted').check();
    await confirmAndClick(receiver, '#outcome-submit');
    await expect(status(receiver)).toHaveText('Service outcome recorded: Resulted in service.');
    await receiver.locator('#co-not-resulted').check();
    await confirmAndClick(receiver, '#correct-outcome-submit');
    await expect(status(receiver)).toHaveText('Service outcome corrected to: Did not result in service.');

    // The sender sees where it stands, read-only.
    await open(referrer, id);
    await expect(referrer.locator('#decision-value')).toHaveText('Accepted');
    await expect(referrer.locator('#outcome-value')).toContainText('Did not result in service');
    await expect(referrer.locator('#readonly-note')).toContainText('You sent this referral.');
    for (const panel of ['respond', 'outcome', 'correct-outcome', 'correct-decision']) {
      await expect(referrer.locator(`#${panel}-panel`)).toBeHidden();
    }

    // Each step was audited once, as the person who did it.
    expect(auditOf(id)).toEqual([
      `CREATED by ${PEOPLE.REFERRER}`,
      `ACCEPTED by ${PEOPLE.RECEIVER_A}`,
      `SERVICE_OUTCOME_RECORDED by ${PEOPLE.RECEIVER_A}`,
      `CORRECTED by ${PEOPLE.RECEIVER_A}`,
    ]);
    expect(await row(id)).toMatchObject({ decision: 'ACCEPTED', serviceOutcome: 'DID_NOT_RESULT_IN_SERVICE' });
  });

  test('reject with a reason; the sender sees it; correcting to Accepted lets the outcome be recorded', async ({ browser }) => {
    const id = await send();
    const receiver = await as(browser, PEOPLE.RECEIVER_A);
    await open(receiver, id);
    await receiver.locator('#respond-na').check();
    await receiver.locator('#respond-reason').selectOption({ label: 'Program currently unavailable' });
    await confirmAndClick(receiver, '#respond-submit');
    await expect(status(receiver)).toHaveText('Response sent: Not appropriate.');
    await expect(receiver.locator('#outcome-panel')).toBeHidden();

    const referrer = await as(browser, PEOPLE.REFERRER);
    await open(referrer, id);
    await expect(referrer.locator('#decision-value')).toHaveText('Not appropriate');
    await expect(referrer.locator('#reason-value')).toHaveText('Reason: Program currently unavailable');
    await expect(referrer.locator('#outcome-value')).toHaveText('Not applicable (the decision is Not appropriate)');

    await receiver.locator('#cd-accept').check();
    await confirmAndClick(receiver, '#correct-decision-submit');
    await expect(status(receiver)).toHaveText('Decision corrected to: Accepted.');
    await receiver.locator('#outcome-not-resulted').check();
    await confirmAndClick(receiver, '#outcome-submit');
    await expect(status(receiver)).toHaveText('Service outcome recorded: Did not result in service.');

    expect(auditOf(id)).toEqual([
      `CREATED by ${PEOPLE.REFERRER}`,
      `NOT_APPROPRIATE by ${PEOPLE.RECEIVER_A}`,
      `CORRECTED by ${PEOPLE.RECEIVER_A}`,
      `SERVICE_OUTCOME_RECORDED by ${PEOPLE.RECEIVER_A}`,
    ]);
  });
});

// ---------------------------------------------------------------------
test.describe('unauthorized access', () => {
  const tryEverything = async (person, id, version) => [
    (await api(person, 'POST', `/api/referrals/${id}/response`, { decision: 'ACCEPTED' })).status,
    (await api(person, 'POST', `/api/referrals/${id}/outcome`, { outcome: 'RESULTED_IN_SERVICE' })).status,
    (await api(person, 'POST', `/api/referrals/${id}/outcome/correction`, { outcome: 'NOT_RECORDED', version })).status,
    (await api(person, 'POST', `/api/referrals/${id}/response/correction`, { decision: 'ACCEPTED', version })).status,
  ];

  test('staff of another Program cannot find, open or change it: it answers like it does not exist', async ({ browser }) => {
    const id = await send();
    const before = JSON.stringify(await row(id));
    const outsider = await as(browser, PEOPLE.OUTSIDER);

    await outsider.goto(`${base}/receiving/`);
    await expect(outsider.locator('#results')).toBeVisible();
    await expect(outsider.locator('.queue-item').filter({ hasText: `${RUN}-` })).toHaveCount(0);
    await expect(outsider.locator('#program-filter option')).toHaveText(['All my Programs', 'Job Readiness Workshop (sample)']);
    expect((await api(PEOPLE.OUTSIDER, 'GET', `/api/referrals/received?programId=${HOUSING}`)).status).toBe(403);

    await open(outsider, id);
    await expect(status(outsider)).toHaveText('This referral is not available. It may not exist, or you may not have access to it.');
    await expect(outsider.locator('#info')).toBeHidden();
    await expectNoAxeViolations(outsider, 'not available');

    expect(await tryEverything(PEOPLE.OUTSIDER, id, (await row(id)).version)).toEqual([404, 404, 404, 404]);
    expect(JSON.stringify(await row(id))).toBe(before);
  });

  test('view-only staff see the referral but no actions, and the server refuses every change', async ({ browser }) => {
    const id = await send();
    const viewer = await as(browser, PEOPLE.VIEWER);
    await open(viewer, id);
    await expect(viewer.locator('#readonly-note')).toHaveText('You can view this referral, but there is nothing you have permission to change on it right now.');
    for (const panel of ['respond', 'outcome', 'correct-outcome', 'correct-decision']) {
      await expect(viewer.locator(`#${panel}-panel`)).toBeHidden();
    }
    await expectNoAxeViolations(viewer, 'view only');

    // Awaiting a response, then accepted with an outcome: refused both times.
    expect((await tryEverything(PEOPLE.VIEWER, id, (await row(id)).version))[0]).toBe(403);
    await api(PEOPLE.RECEIVER_A, 'POST', `/api/referrals/${id}/response`, { decision: 'ACCEPTED' });
    await api(PEOPLE.RECEIVER_A, 'POST', `/api/referrals/${id}/outcome`, { outcome: 'RESULTED_IN_SERVICE' });
    const before = JSON.stringify(await row(id));
    expect(await tryEverything(PEOPLE.VIEWER, id, (await row(id)).version)).toEqual([403, 403, 403, 403]);
    expect(JSON.stringify(await row(id))).toBe(before);
  });

  test('staff who may only respond can accept, but cannot record or correct anything', async ({ browser }) => {
    const id = await send();
    const responder = await as(browser, PEOPLE.RESPONDER);
    await open(responder, id);
    await responder.locator('#respond-accept').check();
    await confirmAndClick(responder, '#respond-submit');
    await expect(status(responder)).toHaveText('Response sent: Accepted. The service outcome is not recorded yet.');
    for (const panel of ['respond', 'outcome', 'correct-outcome', 'correct-decision']) {
      await expect(responder.locator(`#${panel}-panel`)).toBeHidden();
    }
    const before = JSON.stringify(await row(id));
    const [, outcome, correctOutcome, correctDecision] = await tryEverything(PEOPLE.RESPONDER, id, (await row(id)).version);
    expect([outcome, correctOutcome, correctDecision]).toEqual([403, 403, 403]);
    expect(JSON.stringify(await row(id))).toBe(before);
  });

  test('a permission removed while the page is open: the action is refused and nothing changes', async ({ browser }) => {
    const id = await send();
    const page = await as(browser, PEOPLE.REVOKED);
    await open(page, id);
    await expect(page.locator('#respond-panel')).toBeVisible();
    await store._revokeGrants(PEOPLE.REVOKED, 'RESPOND_TO_REFERRAL');

    await page.locator('#respond-accept').check();
    await confirmAndClick(page, '#respond-submit');
    await expect(status(page)).toHaveText('You do not have permission to make this change. Nothing was changed.');
    expect((await row(id)).responseStatus).toBe('AWAITING_RESPONSE');
    await page.locator('#reload').click();
    await expect(page.locator('#respond-panel')).toBeHidden();
  });

  test('the browser cannot say who it is: identity fields in the body or URL are refused', async () => {
    const id = await send();
    const asSomeoneElse = await api(PEOPLE.OUTSIDER, 'POST', `/api/referrals/${id}/response`,
      { decision: 'ACCEPTED', userId: PEOPLE.RECEIVER_A });
    expect(asSomeoneElse.status).toBe(400);
    expect(asSomeoneElse.body.code).toBe('UNEXPECTED_FIELD');
    expect((await api(PEOPLE.OUTSIDER, 'GET', `/api/referrals/received?userId=${PEOPLE.RECEIVER_A}`)).status).toBe(400);
    expect((await api('', 'GET', `/api/referrals/${id}`)).status).toBe(401);
    expect((await row(id)).responseStatus).toBe('AWAITING_RESPONSE');
  });
});

// ---------------------------------------------------------------------
test.describe('two people at once (stale updates)', () => {
  test('someone else responded first: my response is not sent over theirs', async ({ browser }) => {
    const id = await send();
    const a = await as(browser, PEOPLE.RECEIVER_A);
    const b = await as(browser, PEOPLE.RECEIVER_B);
    await open(a, id);
    await open(b, id);

    await a.locator('#respond-accept').check();
    await confirmAndClick(a, '#respond-submit');
    await expect(status(a)).toHaveText('Response sent: Accepted. The service outcome is not recorded yet.');

    await b.locator('#respond-na').check();
    await b.locator('#respond-reason').selectOption({ index: 1 });
    await confirmAndClick(b, '#respond-submit');
    await expect(b.locator('#conflict-message')).toContainText('already has a response');
    await expect(b.locator('#respond-na'), 'my choice stays on screen').toBeChecked();
    await expect(b.locator('#respond-submit')).toBeDisabled();
    expect((await row(id)).decision).toBe('ACCEPTED');

    await b.locator('#load-latest').click();
    await expect(b.locator('#decision-value')).toHaveText('Accepted');
    await expect(b.locator('#respond-panel')).toBeHidden();
    expect(auditOf(id)).toEqual([`CREATED by ${PEOPLE.REFERRER}`, `ACCEPTED by ${PEOPLE.RECEIVER_A}`]);
  });

  test('two corrections to the same outcome: the second sees what is saved now, reviews, and only then saves', async ({ browser }) => {
    const id = await send();
    await api(PEOPLE.RECEIVER_A, 'POST', `/api/referrals/${id}/response`, { decision: 'ACCEPTED' });
    await api(PEOPLE.RECEIVER_A, 'POST', `/api/referrals/${id}/outcome`, { outcome: 'RESULTED_IN_SERVICE' });
    const a = await as(browser, PEOPLE.RECEIVER_A);
    const b = await as(browser, PEOPLE.RECEIVER_B);
    await open(a, id);
    await open(b, id);

    await a.locator('#co-not-resulted').check();
    await confirmAndClick(a, '#correct-outcome-submit');
    await expect(status(a)).toHaveText('Service outcome corrected to: Did not result in service.');

    await b.locator('#co-not-recorded').check();
    await confirmAndClick(b, '#correct-outcome-submit');
    await expect(b.locator('#conflict-heading')).toBeFocused();
    await expect(b.locator('#conflict-current dd')).toHaveText(['Responded', 'Accepted', 'Did not result in service']);
    await expect(b.locator('#co-not-recorded')).toBeChecked();
    await expect(b.locator('#correct-outcome-submit')).toBeDisabled();
    expect((await row(id)).serviceOutcome).toBe('DID_NOT_RESULT_IN_SERVICE');

    // After reviewing the latest, the same choice goes through on purpose.
    await b.locator('#load-latest').click();
    await expect(b.locator('#co-not-resulted')).toBeChecked();
    await b.locator('#co-not-recorded').check();
    await confirmAndClick(b, '#correct-outcome-submit');
    await expect(status(b)).toHaveText('Service outcome corrected to: Not recorded.');
    expect((await row(id)).serviceOutcome).toBe('NOT_RECORDED');
    expect(auditOf(id).slice(-2)).toEqual([`CORRECTED by ${PEOPLE.RECEIVER_A}`, `CORRECTED by ${PEOPLE.RECEIVER_B}`]);
  });

  test('two corrections to the same decision: a stale reason change is refused and shows the current decision', async ({ browser }) => {
    const id = await send();
    await api(PEOPLE.RECEIVER_A, 'POST', `/api/referrals/${id}/response`, { decision: 'NOT_APPROPRIATE', reasonId: 1 });
    const a = await as(browser, PEOPLE.RECEIVER_A);
    const b = await as(browser, PEOPLE.RECEIVER_B);
    await open(a, id);
    await open(b, id);

    await a.locator('#cd-accept').check();
    await confirmAndClick(a, '#correct-decision-submit');
    await expect(status(a)).toHaveText('Decision corrected to: Accepted.');

    await b.locator('#cd-reason').selectOption({ label: 'Other' });
    await confirmAndClick(b, '#correct-decision-submit');
    await expect(b.locator('#conflict-current dd')).toHaveText(['Responded', 'Accepted', 'Not recorded']);
    await expect(b.locator('#cd-reason')).toHaveValue('5');
    await expect(b.locator('#correct-decision-submit')).toBeDisabled();
    expect(await row(id)).toMatchObject({ decision: 'ACCEPTED', notAppropriateReasonId: null });
    await expectNoAxeViolations(b, 'two people: review before you continue');
  });
});
