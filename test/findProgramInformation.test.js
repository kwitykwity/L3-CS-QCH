// Task X: current Program information in Find a Program results.
// QCH (Kyle) confirmed that limited/wait-listed Programs still appear with
// that information visible, and that the primary Program contact may be
// shown while the referral is still sent through QCH Connect first.
// All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createFieldService } from '../src/programs/fieldService.js';
import { createGpmeService } from '../src/gpme/gpmeService.js';
import { attachProgramInformation, displayValue } from '../src/gpme/programInformationForResults.js';
import { GUIDED_MESSAGES, programInformationOf } from '../public/referral/guided.js';

const FOOD = 1;
const PM = 201; // MANAGE_PROGRAM for Programs 11 and 12

function setup() {
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Dept', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: 11, departmentId: 1, name: 'Synthetic Pantry', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [FOOD], ageLimitState: 'NO_RESTRICTION', serviceAreaState: 'NO_RESTRICTION',
        notificationEmail: 'synthetic-routing@example.invalid' },
      { programId: 12, departmentId: 1, name: 'Synthetic Meals', site: null, lifecycleStatus: 'ACTIVE',
        needCategoryIds: [FOOD], ageLimitState: 'NO_RESTRICTION', serviceAreaState: 'NO_RESTRICTION' },
    ],
    needCategories: [{ needCategoryId: FOOD, name: 'Food' }],
    users: [{ userId: PM, isActive: true }],
    grants: [11, 12].map((programId) => ({
      userId: PM, permission: 'MANAGE_PROGRAM', scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP',
    })),
  });
  const fields = createFieldService({ store });
  const app = createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: PM }), nodeEnv: 'test' });
  const addField = async (programId, label, dataType = 'TEXT', options) =>
    (await fields.createField(PM, programId, { label, dataType, isRequired: false, displayOrder: 0, ...(options ? { options } : {}) })).field;
  const save = async (programId, fieldId, value) => {
    const current = (await fields.listProgramFields(PM, programId)).fields.find((f) => f.fieldId === fieldId);
    await fields.setFieldValue(PM, programId, fieldId, { version: current.applicability.version, value });
  };
  return { store, fields, app, addField, save };
}

const match = (app) => request(app).post('/api/gpme/match').send({ needCategoryIds: [FOOD] });
const allItems = (body) => [...body.plausible, ...body.possible];
const item = (body, programId) => allItems(body).find((p) => p.programId === programId);
const withoutInfo = (body) => allItems(body).map(({ programInformation, ...rest }) => rest);

describe('Find a Program shows current Program information', () => {
  test('a wait-listed or full Program still appears, with its information and primary contact', async () => {
    const { app, addField, save } = setup();
    const before = (await match(app)).body;

    const waitList = await addField(11, 'Wait-list information');
    const contact = await addField(11, 'Primary Program contact');
    await save(11, waitList.fieldId, 'Synthetic: currently full; wait list open, about four weeks.');
    await save(11, contact.fieldId, 'Synthetic Program desk: program-demo@example.invalid');

    const res = await match(app);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'RESULTS');
    const pantry = item(res.body, 11);
    assert.ok(pantry, 'the wait-listed Program is not excluded');
    const byLabel = (a, b) => a.label.localeCompare(b.label);
    assert.deepEqual([...pantry.programInformation].sort(byLabel), [
      { label: 'Primary Program contact', value: 'Synthetic Program desk: program-demo@example.invalid' },
      { label: 'Wait-list information', value: 'Synthetic: currently full; wait list open, about four weeks.' },
    ]);

    // Availability is descriptive only: same Programs, same order, same explanations.
    assert.deepEqual(withoutInfo(res.body), withoutInfo(before));
    assert.equal(res.body.ruleVersion, before.ruleVersion);
  });

  test('missing information stays unknown and never breaks a result', async () => {
    const { app, addField } = setup();
    await addField(11, 'Current availability'); // applied, but no value saved

    const res = await match(app);
    assert.equal(res.status, 200);
    assert.deepEqual(item(res.body, 11).programInformation, [{ label: 'Current availability', value: null }]);
    assert.deepEqual(item(res.body, 12).programInformation, [], 'no fields on file: an empty list, not "available"');
    assert.doesNotMatch(JSON.stringify(res.body), /"available"|Available/);
  });

  test('only label and display value leave the server; no routing, IDs, or versions', async () => {
    const { app, addField, save } = setup();
    const field = await addField(11, 'Primary Program contact');
    await save(11, field.fieldId, 'Synthetic desk');
    const res = await match(app);
    for (const entry of item(res.body, 11).programInformation) {
      assert.deepEqual(Object.keys(entry).sort(), ['label', 'value']);
    }
    assert.doesNotMatch(JSON.stringify(res.body), /synthetic-routing|notificationEmail|fieldId|optionId|applicabilityVersion/);
  });

  test('choice, yes/no, number and date values are shown as readable text', async () => {
    const { app, addField, save } = setup();
    const status = await addField(11, 'Availability status', 'SINGLE_SELECT', ['Synthetic open', 'Synthetic wait list']);
    const sites = await addField(11, 'Sites', 'MULTI_SELECT', ['Synthetic North', 'Synthetic South']);
    const walkIns = await addField(11, 'Walk-ins accepted', 'BOOLEAN');
    await save(11, status.fieldId, status.options[1].optionId);
    await save(11, sites.fieldId, sites.options.map((o) => o.optionId));
    await save(11, walkIns.fieldId, false);

    const info = item((await match(app)).body, 11).programInformation;
    const valueOf = (label) => info.find((f) => f.label === label).value;
    assert.equal(valueOf('Availability status'), 'Synthetic wait list');
    assert.equal(valueOf('Sites'), 'Synthetic North, Synthetic South');
    assert.equal(valueOf('Walk-ins accepted'), 'No');
    assert.ok(item((await match(app)).body, 11), 'a "wait list" choice does not remove the Program');

    assert.equal(displayValue({ dataType: 'NUMBER', value: 3 }), '3');
    assert.equal(displayValue({ dataType: 'DATE', value: '2026-11-02' }), '2026-11-02');
    assert.equal(displayValue({ dataType: 'TEXT', value: '   ' }), null);
    assert.equal(displayValue({ dataType: 'MULTI_SELECT', value: [], options: [] }), null);
  });

  test('a discontinued field leaves the results but keeps its history', async () => {
    const { app, fields, addField, save } = setup();
    const field = await addField(11, 'Current availability');
    await save(11, field.fieldId, 'Synthetic openings');
    await fields.discontinueField(PM, field.fieldId, { version: field.version });

    assert.deepEqual(item((await match(app)).body, 11).programInformation, []);
    const history = (await fields.listProgramFields(PM, 11)).fields.find((f) => f.fieldId === field.fieldId);
    assert.equal(history.value, 'Synthetic openings');
    assert.equal(history.lifecycleStatus, 'DISCONTINUED');
  });

  test('if the information cannot be read, matching still returns every result', async () => {
    const { store } = setup();
    const failing = { ...store, withTransaction: async () => { throw new Error('synthetic read failure'); } };
    const logged = [];
    const gpme = createGpmeService({ store: failing, logFailure: (err) => logged.push(err.name) });
    const result = await gpme.match(PM, { needCategoryIds: [FOOD] });
    assert.equal(result.status, 'RESULTS');
    assert.deepEqual(allItems(result).map((p) => p.programId).sort(), [11, 12]);
    for (const p of allItems(result)) assert.equal(p.programInformation, null);
    assert.deepEqual(logged, ['Error']);
  });

  test('no results means no information read', async () => {
    let reads = 0;
    const result = { plausible: [], possible: [], status: 'NO_PLAUSIBLE_MATCH' };
    const out = await attachProgramInformation({ withTransaction: async () => { reads += 1; } }, result);
    assert.equal(reads, 0);
    assert.equal(out, result);
  });
});

describe('Find a Program screen', () => {
  test('the browser accepts only well-formed information and treats anything else as not loaded', () => {
    assert.deepEqual(programInformationOf({ programInformation: [{ label: 'Contact', value: 'Desk' }, { label: 'Wait list', value: null }] }),
      [{ label: 'Contact', value: 'Desk' }, { label: 'Wait list', value: null }]);
    assert.deepEqual(programInformationOf({ programInformation: [] }), []);
    for (const bad of [undefined, null, 'text', [{ label: '', value: 'x' }], [{ label: 'A', value: 5 }], [null]]) {
      assert.equal(programInformationOf({ programInformation: bad }), null, JSON.stringify(bad));
    }
  });

  test('information is shown as text, choosing the Program stays the referral action, nothing is stored', () => {
    const app = readFileSync(new URL('../public/referral/app.js', import.meta.url), 'utf8');
    const render = app.slice(app.indexOf('function renderProgramInformation'), app.indexOf('function renderResults'));
    assert.match(render, /textContent/);
    assert.doesNotMatch(render, /innerHTML|insertAdjacentHTML|localStorage|sessionStorage|indexedDB|location|history\.|href/);
    assert.match(app, /li\.append\(head, whyLabel, why, renderProgramInformation\(item\), choose\)/);
    assert.match(GUIDED_MESSAGES.PROGRAM_INFO_REFER_FIRST, /through QCH Connect first/);
    assert.match(GUIDED_MESSAGES.PROGRAM_INFO_NONE, /Confirm with the Program/);
    // The chosen Program carries no Program information into the referral.
    const choose = app.slice(app.indexOf('function chooseMatch'), app.indexOf('function chooseMatch') + 300);
    assert.doesNotMatch(choose, /programInformation/);
  });
});
