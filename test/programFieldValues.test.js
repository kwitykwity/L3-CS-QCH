// Program field values, slice 14B-2 (Trello card 14).
// Final Technical PRD 4.2, 4.3, 9.3, 9.4, 9.6, 10.3, 10.4, 13.4.
// All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createFieldService } from '../src/programs/fieldService.js';
import { parseFieldValue, validateSetValue, VALUE_TEXT_MAX } from '../src/programs/validateFieldChange.js';

const MANAGER_11 = 100;  // MANAGE_PROGRAM for Program 11 only
const SECOND_11 = 101;   // MANAGE_PROGRAM for Program 11
const MANAGER_12 = 102;  // MANAGE_PROGRAM for Program 12 only
const NOBODY = 103;
const INACTIVE = 104;    // MANAGE_PROGRAM for 11, inactive
const ORG_ADMIN = 105;   // MANAGE_ORGANIZATION only (not MANAGE_PROGRAM)
const MARKER = 'SyntheticMarkerTau';

const g = (userId, permission, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId: 11, departmentId: null, grantSource: 'IN_APP', ...extra,
});

// Field IDs by type.
const TEXT = 1; const NUMBER = 2; const DATE = 3; const BOOL = 4; const SINGLE = 5; const MULTI = 6;
const OLD = 7;          // discontinued TEXT field, still used by Program 11
const NOT_USED = 8;     // ACTIVE, not used by Program 11
const OTHER_SINGLE = 9; // another choice field (owns option 20)
const REFERRAL_Q = 10;  // REFERRAL_FORM field (not supported in this slice), used by Program 11

function seed() {
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Dept', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: 11, departmentId: 1, name: 'Synthetic Program 11', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 12, departmentId: 1, name: 'Synthetic Program 12', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 14, departmentId: 1, name: 'Synthetic Retired', site: null, lifecycleStatus: 'RETIRED' },
    ],
    users: [MANAGER_11, SECOND_11, MANAGER_12, NOBODY, ORG_ADMIN]
      .map((userId) => ({ userId, isActive: true }))
      .concat([{ userId: INACTIVE, isActive: false }]),
    grants: [
      g(MANAGER_11, 'MANAGE_PROGRAM'), g(MANAGER_11, 'MANAGE_PROGRAM', { programId: 14 }),
      g(SECOND_11, 'MANAGE_PROGRAM'),
      g(MANAGER_12, 'MANAGE_PROGRAM', { programId: 12 }),
      g(INACTIVE, 'MANAGE_PROGRAM'),
      g(ORG_ADMIN, 'MANAGE_ORGANIZATION', { scopeType: 'ORG', programId: null }),
    ],
    fields: [
      { fieldId: TEXT, label: 'Synthetic intake hours', dataType: 'TEXT' },
      { fieldId: NUMBER, label: 'Synthetic capacity', dataType: 'NUMBER' },
      { fieldId: DATE, label: 'Synthetic next cohort', dataType: 'DATE' },
      { fieldId: BOOL, label: 'Synthetic walk-ins', dataType: 'BOOLEAN' },
      { fieldId: SINGLE, label: 'Synthetic format', dataType: 'SINGLE_SELECT' },
      { fieldId: MULTI, label: 'Synthetic languages', dataType: 'MULTI_SELECT' },
      { fieldId: OLD, label: 'Synthetic old', dataType: 'TEXT', lifecycleStatus: 'DISCONTINUED', discontinuedAt: '2026-09-01T00:00:00.000Z' },
      { fieldId: NOT_USED, label: 'Synthetic unused', dataType: 'TEXT' },
      { fieldId: OTHER_SINGLE, label: 'Synthetic other', dataType: 'SINGLE_SELECT' },
      { fieldId: REFERRAL_Q, label: 'Synthetic referral question', dataType: 'TEXT', appliesTo: 'REFERRAL_FORM' },
    ].map((f) => ({ fieldKey: `field_${f.fieldId}`, appliesTo: 'PROGRAM_INFO', ...f })),
    fieldOptions: [
      { optionId: 1, fieldId: SINGLE, label: 'Synthetic in person' },
      { optionId: 2, fieldId: SINGLE, label: 'Synthetic remote' },
      { optionId: 3, fieldId: SINGLE, label: 'Synthetic old format', lifecycleStatus: 'DISCONTINUED' },
      { optionId: 10, fieldId: MULTI, label: 'Synthetic A' },
      { optionId: 11, fieldId: MULTI, label: 'Synthetic B' },
      { optionId: 12, fieldId: MULTI, label: 'Synthetic C', lifecycleStatus: 'DISCONTINUED' },
      { optionId: 20, fieldId: OTHER_SINGLE, label: 'Synthetic elsewhere' },
    ],
    fieldApplicability: [
      { programId: 11, fieldId: TEXT, isRequired: true, displayOrder: 1 },
      { programId: 11, fieldId: NUMBER, displayOrder: 2 },
      { programId: 11, fieldId: DATE, displayOrder: 3 },
      { programId: 11, fieldId: BOOL, displayOrder: 4 },
      { programId: 11, fieldId: SINGLE, displayOrder: 5 },
      { programId: 11, fieldId: MULTI, displayOrder: 6 },
      { programId: 11, fieldId: OLD, displayOrder: 7 },
      { programId: 11, fieldId: REFERRAL_Q, displayOrder: 8 },
      { programId: 12, fieldId: TEXT, displayOrder: 1 },
      { programId: 12, fieldId: NOT_USED, displayOrder: 2 },
      { programId: 14, fieldId: TEXT, displayOrder: 1 },
    ],
    fieldValues: [
      { programId: 11, fieldId: TEXT, valueText: 'Synthetic Mon-Fri' },
      { programId: 11, fieldId: SINGLE, optionId: 3 },        // a now-discontinued option, still selected
      { programId: 11, fieldId: MULTI, optionId: 12 },        // same, for multi
      { programId: 11, fieldId: OLD, valueText: 'Synthetic history' },
      { programId: 11, fieldId: REFERRAL_Q, valueText: 'Synthetic referral answer' },
      { programId: 12, fieldId: TEXT, valueText: 'Synthetic Program 12 hours' },
    ],
  });
  return { store, fields: createFieldService({ store }) };
}

async function rejectsWith(promise, code) {
  let caught;
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    caught = err;
    return true;
  });
  return caught;
}

const useVersion = (store, programId, fieldId) =>
  store._applicabilityRows().find((a) => a.programId === programId && a.fieldId === fieldId).version;
const valuesOf = (store, programId, fieldId) =>
  store._valueRows().filter((v) => v.programId === programId && v.fieldId === fieldId);
const audit = (store) => store._referralAuditEvents.filter((e) => e.entityType === 'PROGRAM_FIELD');
const set = (fields, store, fieldId, value, userId = MANAGER_11, programId = 11) =>
  fields.setFieldValue(userId, programId, fieldId, { version: useVersion(store, programId, fieldId), value });

// ---------------------------------------------------------------------------

describe('setting values by data type', () => {
  const ok = [
    [TEXT, '  Synthetic Tue and Thu\n9 to 5  ', 'Synthetic Tue and Thu\n9 to 5'],
    [NUMBER, 25, 25],
    [NUMBER, -3.1415, -3.1415],
    [DATE, '2027-02-28', '2027-02-28'],
    [DATE, '2028-02-29', '2028-02-29'],
    [BOOL, false, false],
    [SINGLE, 2, 2],
    [MULTI, [11, 10], [10, 11]],
  ];
  for (const [fieldId, value, expected] of ok) {
    test(`field ${fieldId}: ${JSON.stringify(value)} is stored and read back`, async () => {
      const { store, fields } = seed();
      const result = await set(fields, store, fieldId, value);
      assert.equal(result.status, 'UPDATED');
      assert.deepEqual(result.value, expected);
      const { fields: list } = await fields.listProgramFields(MANAGER_11, 11);
      assert.deepEqual(list.find((f) => f.fieldId === fieldId).value, expected);
    });
  }

  const bad = [
    [TEXT, 42], [TEXT, 'x'.repeat(VALUE_TEXT_MAX + 1)], [TEXT, 'a\u0000b'], [TEXT, 'a\u001bb'],
    [NUMBER, '25'], [NUMBER, Number.NaN], [NUMBER, Infinity], [NUMBER, 1e14], [NUMBER, 1.23456], [NUMBER, true],
    [DATE, '2027-02-30'], [DATE, '2027-2-3'], [DATE, '2027-02-03T00:00:00Z'], [DATE, '1899-12-31'], [DATE, 20270203],
    [BOOL, 'true'], [BOOL, 0],
    [SINGLE, '1'], [SINGLE, 0], [SINGLE, 1.5], [SINGLE, [1]],
    [MULTI, 10], [MULTI, [10, 10]], [MULTI, ['10']], [MULTI, [-1]],
  ];
  for (const [fieldId, value] of bad) {
    test(`field ${fieldId}: ${JSON.stringify(value)?.slice(0, 30)} is refused as INVALID_REQUEST`, async () => {
      const { store, fields } = seed();
      const before = JSON.stringify(store._valueRows());
      const err = await rejectsWith(set(fields, store, fieldId, value), 'INVALID_REQUEST');
      assert.deepEqual(err.fields, ['value']);
      assert.equal(JSON.stringify(store._valueRows()), before);
    });
  }

  test('a value is checked against the field type, never echoed', async () => {
    const { store, fields } = seed();
    const err = await rejectsWith(set(fields, store, NUMBER, MARKER), 'INVALID_REQUEST');
    assert.doesNotMatch(JSON.stringify({ m: err.message, f: err.fields }), new RegExp(MARKER));
  });

  test('every stored row has exactly one value column set', async () => {
    const { store, fields } = seed();
    await set(fields, store, NUMBER, 0);
    await set(fields, store, BOOL, false);
    await set(fields, store, MULTI, [10, 11]);
    for (const row of store._valueRows()) {
      const filled = ['optionId', 'valueText', 'valueNumber', 'valueDate', 'valueBool'].filter((k) => row[k] !== null);
      assert.equal(filled.length, 1, JSON.stringify(row));
    }
  });
});

describe('clearing and required fields', () => {
  test('null clears an optional value; empty text and empty multi-select also clear', async () => {
    const { store, fields } = seed();
    await set(fields, store, NUMBER, 7);
    await set(fields, store, NUMBER, null);
    assert.equal(valuesOf(store, 11, NUMBER).length, 0);
    await set(fields, store, MULTI, []);
    assert.equal(valuesOf(store, 11, MULTI).length, 0);
    const { fields: list } = await fields.listProgramFields(MANAGER_11, 11);
    assert.deepEqual(list.find((f) => f.fieldId === MULTI).value, []);
    assert.equal(list.find((f) => f.fieldId === NUMBER).value, null);
  });

  test('a required field cannot be cleared', async () => {
    const { store, fields } = seed();
    for (const value of [null, '', '   ']) {
      await rejectsWith(set(fields, store, TEXT, value), 'VALUE_REQUIRED');
    }
    assert.equal(valuesOf(store, 11, TEXT)[0].valueText, 'Synthetic Mon-Fri');
  });

  test('the same field can be optional in another Program and cleared there', async () => {
    const { store, fields } = seed();
    await set(fields, store, TEXT, null, MANAGER_12, 12);
    assert.equal(valuesOf(store, 12, TEXT).length, 0);
    assert.equal(valuesOf(store, 11, TEXT).length, 1, 'Program 11 value untouched');
  });

  test('setting the same value again is NO_CHANGE and writes nothing', async () => {
    const { store, fields } = seed();
    const n = audit(store).length;
    await rejectsWith(set(fields, store, TEXT, ' Synthetic Mon-Fri '), 'NO_CHANGE');
    await rejectsWith(set(fields, store, NUMBER, null), 'NO_CHANGE');
    await rejectsWith(set(fields, store, MULTI, [12]), 'NO_CHANGE');
    assert.equal(audit(store).length, n);
  });
});

describe('options', () => {
  test('an option from another field is refused', async () => {
    const { store, fields } = seed();
    await rejectsWith(set(fields, store, SINGLE, 20), 'OPTION_NOT_SELECTABLE');
    await rejectsWith(set(fields, store, MULTI, [10, 1]), 'OPTION_NOT_SELECTABLE');
    await rejectsWith(set(fields, store, SINGLE, 999), 'OPTION_NOT_SELECTABLE');
  });

  test('a discontinued option cannot be newly picked', async () => {
    const { store, fields } = seed();
    await set(fields, store, SINGLE, 1);
    await rejectsWith(set(fields, store, SINGLE, 3), 'OPTION_NOT_SELECTABLE');
    assert.equal(valuesOf(store, 11, SINGLE)[0].optionId, 1);
  });

  test('a discontinued option that is already selected may stay selected', async () => {
    const { store, fields } = seed();
    const result = await set(fields, store, MULTI, [10, 12]);
    assert.deepEqual(result.value, [10, 12]);
    await set(fields, store, MULTI, [10]);
    await rejectsWith(set(fields, store, MULTI, [10, 12]), 'OPTION_NOT_SELECTABLE');
  });
});

describe('which fields and Programs (PRD 4.3)', () => {
  test('a discontinued field keeps its value as history but takes no new value', async () => {
    const { store, fields } = seed();
    await rejectsWith(set(fields, store, OLD, 'Synthetic new'), 'FIELD_NOT_ACTIVE');
    const { fields: list } = await fields.listProgramFields(MANAGER_11, 11);
    assert.equal(list.find((f) => f.fieldId === OLD).value, 'Synthetic history');
  });

  test('a field the Program does not use is FIELD_NOT_APPLIED; unknown field is FIELD_NOT_FOUND', async () => {
    const { fields } = seed();
    await rejectsWith(fields.setFieldValue(MANAGER_11, 11, NOT_USED, { version: 'v1', value: 'x' }), 'FIELD_NOT_APPLIED');
    await rejectsWith(fields.setFieldValue(MANAGER_11, 11, 999, { version: 'v1', value: 'x' }), 'FIELD_NOT_FOUND');
  });

  test('a REFERRAL_FORM field is refused and left out of the list; nothing changes', async () => {
    const { store, fields } = seed();
    const before = JSON.stringify([store._valueRows(), store._applicabilityRows(), audit(store)]);
    await rejectsWith(set(fields, store, REFERRAL_Q, 'Synthetic new answer'), 'FIELD_NOT_SUPPORTED');
    await rejectsWith(set(fields, store, REFERRAL_Q, null), 'FIELD_NOT_SUPPORTED');
    assert.equal(JSON.stringify([store._valueRows(), store._applicabilityRows(), audit(store)]), before);
    const { fields: list } = await fields.listProgramFields(MANAGER_11, 11);
    assert.ok(list.every((f) => f.fieldId !== REFERRAL_Q));
  });

  test('a retired Program takes no new values', async () => {
    const { store, fields } = seed();
    await rejectsWith(set(fields, store, TEXT, 'Synthetic x', MANAGER_11, 14), 'PROGRAM_RETIRED');
  });
});

describe('who may set values (PRD 3.6)', () => {
  test('MANAGE_PROGRAM for that Program is required', async () => {
    const { store, fields } = seed();
    await rejectsWith(set(fields, store, TEXT, 'Synthetic x', MANAGER_12), 'NOT_AUTHORIZED');
    await rejectsWith(set(fields, store, TEXT, 'Synthetic x', NOBODY), 'NOT_AUTHORIZED');
    await rejectsWith(set(fields, store, TEXT, 'Synthetic x', ORG_ADMIN), 'NOT_AUTHORIZED');
    await rejectsWith(set(fields, store, TEXT, 'Synthetic x', INACTIVE), 'USER_NOT_ACTIVE');
    assert.equal(valuesOf(store, 11, TEXT)[0].valueText, 'Synthetic Mon-Fri');
  });

  test('a manager of Program 12 can set the shared field for 12 only', async () => {
    const { store, fields } = seed();
    await set(fields, store, TEXT, 'Synthetic 12 new', MANAGER_12, 12);
    assert.equal(valuesOf(store, 12, TEXT)[0].valueText, 'Synthetic 12 new');
    assert.equal(valuesOf(store, 11, TEXT)[0].valueText, 'Synthetic Mon-Fri');
  });
});

describe('audit, stale versions, concurrency (PRD 9.3, 9.4, 9.6, 13.4)', () => {
  test('each change is audited with old and new values and bumps the version', async () => {
    const { store, fields } = seed();
    const v0 = useVersion(store, 11, SINGLE);
    const result = await fields.setFieldValue(MANAGER_11, 11, SINGLE, { version: v0, value: 1 }, { correlationId: 'c-val' });
    assert.notEqual(result.applicability.version, v0);
    assert.equal(result.applicability.version, useVersion(store, 11, SINGLE));
    const event = audit(store).at(-1);
    assert.deepEqual(
      [event.entityId, event.action, event.actorUserId, event.correlationId, event.before, event.after],
      [11, 'UPDATED', MANAGER_11, 'c-val', { field_id: SINGLE, value: 3 }, { field_id: SINGLE, value: 1 }],
    );
  });

  test('stale version -> PROGRAM_CHANGED with the current applicability; nothing written', async () => {
    const { store, fields } = seed();
    const seen = useVersion(store, 11, NUMBER);
    await fields.setFieldValue(MANAGER_11, 11, NUMBER, { version: seen, value: 1 });
    const n = audit(store).length;
    const err = await rejectsWith(fields.setFieldValue(SECOND_11, 11, NUMBER, { version: seen, value: 2 }), 'PROGRAM_CHANGED');
    assert.equal(err.current.version, useVersion(store, 11, NUMBER));
    assert.equal(valuesOf(store, 11, NUMBER)[0].valueNumber, 1);
    assert.equal(audit(store).length, n);
  });

  test('changing required/order also changes the version a value write needs', async () => {
    const { store, fields } = seed();
    const seen = useVersion(store, 11, NUMBER);
    await fields.updateApplicability(MANAGER_11, 11, NUMBER, { version: seen, displayOrder: 9 });
    await rejectsWith(fields.setFieldValue(SECOND_11, 11, NUMBER, { version: seen, value: 2 }), 'PROGRAM_CHANGED');
  });

  test('two writes at once with the same version: exactly one wins, one row stored', async () => {
    const { store, fields } = seed();
    const version = useVersion(store, 11, NUMBER);
    const results = await Promise.allSettled([
      fields.setFieldValue(MANAGER_11, 11, NUMBER, { version, value: 1 }),
      fields.setFieldValue(SECOND_11, 11, NUMBER, { version, value: 2 }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'PROGRAM_CHANGED');
    assert.equal(valuesOf(store, 11, NUMBER).length, 1);
    assert.equal(audit(store).length, 1);
  });

  test('a value write racing a field discontinue: one wins, no value on a discontinued field after', async () => {
    const { store, fields } = seed();
    const fieldVersion = store._fieldRows().find((f) => f.fieldId === NUMBER).version;
    // NUMBER is used only by Program 11, so MANAGER_11 may discontinue it.
    const results = await Promise.allSettled([
      fields.discontinueField(SECOND_11, NUMBER, { version: fieldVersion }),
      set(fields, store, NUMBER, 5),
    ]);
    const discontinued = results[0].status === 'fulfilled';
    const valueSet = results[1].status === 'fulfilled';
    assert.ok(discontinued);
    if (!valueSet) assert.equal(results[1].reason.code, 'FIELD_NOT_ACTIVE');
    // Field lock order is field, then applicability: the value either went in
    // before the discontinue or was refused after it.
    assert.equal(valuesOf(store, 11, NUMBER).length, valueSet ? 1 : 0);
  });

  test('a field cannot be discontinued in the middle of a value save (field is held first)', async () => {
    const { store, fields } = seed();
    let reached; let release;
    const reachedP = new Promise((r) => { reached = r; });
    const gate = new Promise((r) => { release = r; });
    let paused = false;
    store._afterLockingRead(async (kind, key) => {
      // Pause the value save after it holds the field, as it reaches the applicability row.
      if (!paused && kind === 'hold' && key === `applicability:11:${NUMBER}`) { paused = true; reached(); await gate; }
    });
    const saving = set(fields, store, NUMBER, 5);
    await reachedP;
    let discontinued = false;
    const fieldVersion = store._fieldRows().find((f) => f.fieldId === NUMBER).version;
    const discontinuing = fields.discontinueField(SECOND_11, NUMBER, { version: fieldVersion }).then(() => { discontinued = true; });
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(discontinued, false, 'discontinue waits for the value save');
    assert.equal(store._fieldRows().find((f) => f.fieldId === NUMBER).lifecycleStatus, 'ACTIVE');
    release();
    assert.equal((await saving).status, 'UPDATED');
    await discontinuing;
    // Then the discontinue goes through; the saved value stays as history.
    assert.equal(store._fieldRows().find((f) => f.fieldId === NUMBER).lifecycleStatus, 'DISCONTINUED');
    assert.equal(valuesOf(store, 11, NUMBER)[0].valueNumber, 5);
  });

  test('if the audit write fails, the old value stays and the version does not move', async () => {
    const { store, fields } = seed();
    const before = JSON.stringify([store._valueRows(), store._applicabilityRows()]);
    store._failNextAudit();
    await assert.rejects(set(fields, store, MULTI, [10, 11]));
    assert.equal(JSON.stringify([store._valueRows(), store._applicabilityRows()]), before);
  });
});

describe('validation (PRD 10.3, 10.4)', () => {
  test('body shape', () => {
    assert.deepEqual(validateSetValue({ version: 'v1' }).fields, ['value']);
    assert.deepEqual(validateSetValue({ value: 1 }).fields, ['version']);
    assert.equal(validateSetValue({ version: 'v1', value: 1, programId: 12 }).unexpectedField, true);
    assert.equal(validateSetValue({ version: 'v1', value: 1, [MARKER]: 1 }).unexpectedField, true);
    assert.equal(validateSetValue([1]).ok, false);
    assert.equal(validateSetValue({ version: 'v1', value: null }).ok, true);
  });

  test('parse helpers', () => {
    assert.deepEqual(parseFieldValue('TEXT', '\t'), { ok: true, rows: [], optionIds: [] });
    assert.equal(parseFieldValue('TEXT', 'a\tb').ok, true, 'tab is allowed inside text');
    assert.equal(parseFieldValue('NUMBER', 12345678901234.5).ok, true);
    assert.equal(parseFieldValue('NUMBER', 0.0001).ok, true);
    assert.equal(parseFieldValue('NUMBER', 1e-7).ok, false, 'too many decimal places');
    assert.equal(parseFieldValue('NUMBER', -0.12345).ok, false);
    assert.equal(parseFieldValue('UNKNOWN', 'x').ok, false, 'unknown type fails closed');
    assert.equal(parseFieldValue('MULTI_SELECT', Array.from({ length: 51 }, (_, i) => i + 1)).ok, false);
  });
});

describe('HTTP: PUT /programs/:programId/field-values/:fieldId', () => {
  const appFor = (store, userId = MANAGER_11) => createApp({
    affiliationStore: store, referralStore: store, resolveIdentity: () => (userId === null ? null : { userId }), nodeEnv: 'test',
  });
  const url = (programId, fieldId) => `/api/program-management/programs/${programId}/field-values/${fieldId}`;

  test('set, read back in the field list, never cached', async () => {
    const { store } = seed();
    const app = appFor(store);
    const res = await request(app).put(url(11, DATE)).send({ version: useVersion(store, 11, DATE), value: '2027-01-15' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body.value, '2027-01-15');
    const list = await request(app).get('/api/program-management/programs/11/fields');
    assert.equal(list.body.fields.find((f) => f.fieldId === DATE).value, '2027-01-15');
  });

  test('errors map to status codes, without echoing input', async () => {
    const { store } = seed();
    const app = appFor(store);
    assert.equal((await request(appFor(store, null)).put(url(11, TEXT)).send({ version: 'v1', value: 'x' })).status, 401);
    assert.equal((await request(appFor(store, NOBODY)).put(url(11, TEXT)).send({ version: 'v1', value: 'x' })).status, 403);
    assert.equal((await request(app).put(url(11, 999)).send({ version: 'v1', value: 'x' })).status, 404);
    assert.equal((await request(app).put(url(11, 'abc')).send({ version: 'v1', value: 'x' })).status, 404);
    assert.equal((await request(app).put(url(11, NOT_USED)).send({ version: 'v1', value: 'x' })).status, 404);
    const required = await request(app).put(url(11, TEXT)).send({ version: useVersion(store, 11, TEXT), value: null });
    assert.deepEqual([required.status, required.body.code], [422, 'VALUE_REQUIRED']);
    const stale = await request(app).put(url(11, NUMBER)).send({ version: 'v999', value: 1 });
    assert.deepEqual([stale.status, stale.body.code], [409, 'PROGRAM_CHANGED']);
    assert.ok(stale.body.current);
    const bad = await request(app).put(url(11, NUMBER)).send({ version: useVersion(store, 11, NUMBER), value: MARKER });
    assert.equal(bad.status, 400);
    assert.doesNotMatch(JSON.stringify(bad.body), new RegExp(MARKER));
    const extra = await request(app).put(url(11, NUMBER)).send({ version: 'v1', value: 1, [MARKER]: 1 });
    assert.deepEqual([extra.status, extra.body.code], [400, 'UNEXPECTED_FIELD']);
    assert.doesNotMatch(JSON.stringify(extra.body), new RegExp(MARKER));
    const q = await request(app).put(`${url(11, NUMBER)}?${MARKER}=1`).send({ version: 'v1', value: 1 });
    assert.equal(q.status, 400);
    assert.doesNotMatch(JSON.stringify(q.body), new RegExp(MARKER));
  });
});

describe('store contract: field values', () => {
  test('replacing values requires holding the applicability row', async () => {
    const { store } = seed();
    await assert.rejects(
      store.withTransaction((tx) => tx.replaceFieldValues({ programId: 11, fieldId: NUMBER, rows: [{ valueNumber: 1 }] })),
      /holding the applicability row/,
    );
    assert.equal(valuesOf(store, 11, NUMBER).length, 0);
  });

  test('a row with zero or two value columns is refused (ck_pfv_one_value)', async () => {
    const { store } = seed();
    for (const row of [{}, { valueText: 'a', valueNumber: 1 }]) {
      await assert.rejects(store.withTransaction(async (tx) => {
        await tx.lockApplicabilityForUpdate(11, NUMBER);
        await tx.replaceFieldValues({ programId: 11, fieldId: NUMBER, rows: [row] });
      }), /ck_pfv_one_value/);
    }
    assert.equal(valuesOf(store, 11, NUMBER).length, 0);
  });

  test('a rolled-back replace leaves the old rows in place', async () => {
    const { store } = seed();
    const before = JSON.stringify(store._valueRows());
    await assert.rejects(store.withTransaction(async (tx) => {
      await tx.lockApplicabilityForUpdate(11, TEXT);
      await tx.replaceFieldValues({ programId: 11, fieldId: TEXT, rows: [{ valueText: 'Synthetic gone' }] });
      assert.equal((await tx.listFieldValues(11, TEXT))[0].valueText, 'Synthetic gone', 'visible inside the transaction');
      throw new Error('synthetic rollback');
    }), /synthetic rollback/);
    assert.equal(JSON.stringify(store._valueRows()), before);
  });
});
