// Configurable Program fields, slice 14B (Trello card 14).
// Final Technical PRD 3.6, 4.2, 4.3, 9.3, 9.4, 9.6, 10.3, 10.4, 13.4.
// All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createFieldService, RETIRE_AFTER_DAYS } from '../src/programs/fieldService.js';
import { validateCreateField } from '../src/programs/validateFieldChange.js';

const MANAGER_11 = 100;   // MANAGE_PROGRAM for Program 11 only
const MANAGER_BOTH = 101; // MANAGE_PROGRAM for 11 and 12
const ORG_ADMIN = 102;    // MANAGE_ORGANIZATION at ORG scope only
const NARROW_ADMIN = 103; // MANAGE_ORGANIZATION at PROGRAM scope (doesn't count)
const NOBODY = 104;       // no grants
const INACTIVE = 105;     // MANAGE_PROGRAM for 11 and 12, inactive
const REVOKED = 106;      // MANAGE_PROGRAM for 11, revoked
const SECOND_11 = 107;    // another MANAGE_PROGRAM holder for 11 and 12

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-19T12:00:00.000Z');
const MARKER = 'SyntheticMarkerSigma';

const g = (userId, permission, extra = {}) => ({
  userId, permission, scopeType: 'PROGRAM', programId: 11, departmentId: null, grantSource: 'IN_APP', ...extra,
});

function seed() {
  let t = T0;
  const clock = { now: () => new Date(t), advanceDays: (d) => { t += d * DAY; } };
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Dept', lifecycleStatus: 'ACTIVE' }],
    programs: [
      { programId: 11, departmentId: 1, name: 'Synthetic Program 11', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 12, departmentId: 1, name: 'Synthetic Program 12', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 14, departmentId: 1, name: 'Synthetic Retired Program', site: null, lifecycleStatus: 'RETIRED' },
    ],
    users: [MANAGER_11, MANAGER_BOTH, ORG_ADMIN, NARROW_ADMIN, NOBODY, REVOKED, SECOND_11]
      .map((userId) => ({ userId, isActive: true, displayName: `Synthetic ${userId}` }))
      .concat([{ userId: INACTIVE, isActive: false }]),
    grants: [
      g(MANAGER_11, 'MANAGE_PROGRAM'),
      g(MANAGER_11, 'MANAGE_PROGRAM', { programId: 14 }),
      g(MANAGER_BOTH, 'MANAGE_PROGRAM'), g(MANAGER_BOTH, 'MANAGE_PROGRAM', { programId: 12 }),
      g(SECOND_11, 'MANAGE_PROGRAM'), g(SECOND_11, 'MANAGE_PROGRAM', { programId: 12 }),
      g(ORG_ADMIN, 'MANAGE_ORGANIZATION', { scopeType: 'ORG', programId: null }),
      g(NARROW_ADMIN, 'MANAGE_ORGANIZATION'),
      g(INACTIVE, 'MANAGE_PROGRAM'), g(INACTIVE, 'MANAGE_PROGRAM', { programId: 12 }),
      g(REVOKED, 'MANAGE_PROGRAM', { revokedAt: '2026-10-01T00:00:00.000Z' }),
    ],
    fields: [
      // Field 1: shared by Programs 11 and 12.
      { fieldId: 1, fieldKey: 'field_1', label: 'Synthetic intake hours', appliesTo: 'PROGRAM_INFO', dataType: 'TEXT' },
      // Field 2: a choice field used by Program 11 only.
      { fieldId: 2, fieldKey: 'field_2', label: 'Synthetic session format', appliesTo: 'PROGRAM_INFO', dataType: 'SINGLE_SELECT' },
      // Field 3: discontinued 100 days ago, used by Program 11.
      { fieldId: 3, fieldKey: 'field_3', label: 'Synthetic old field', appliesTo: 'PROGRAM_INFO', dataType: 'TEXT',
        lifecycleStatus: 'DISCONTINUED', discontinuedAt: new Date(T0 - 100 * DAY).toISOString() },
      // Field 4: used by no Program.
      { fieldId: 4, fieldKey: 'field_4', label: 'Synthetic orphan field', appliesTo: 'PROGRAM_INFO', dataType: 'TEXT' },
    ],
    fieldOptions: [
      { optionId: 1, fieldId: 2, label: 'Synthetic in person', displayOrder: 0 },
      { optionId: 2, fieldId: 2, label: 'Synthetic remote', displayOrder: 1 },
    ],
    fieldApplicability: [
      { programId: 11, fieldId: 1, isRequired: true, displayOrder: 1 },
      { programId: 12, fieldId: 1, isRequired: false, displayOrder: 3 },
      { programId: 11, fieldId: 2, displayOrder: 2 },
      { programId: 11, fieldId: 3, displayOrder: 4 },
    ],
  }, { now: clock.now });
  return { store, clock, fields: createFieldService({ store }) };
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

const fieldRow = (store, id) => store._fieldRows().find((f) => f.fieldId === id);
const optionRow = (store, id) => store._optionRows().find((o) => o.optionId === id);
const audit = (store, type) => store._referralAuditEvents.filter((e) => !type || e.entityType === type);

// ---------------------------------------------------------------------------

describe('listing and creating fields for a Program', () => {
  test('lists the fields a Program uses, in its display order, with versions', async () => {
    const { fields } = seed();
    const { fields: list } = await fields.listProgramFields(MANAGER_11, 11);
    assert.deepEqual(list.map((f) => f.fieldId), [1, 2, 3]);
    const choice = list.find((f) => f.fieldId === 2);
    assert.deepEqual(choice.options.map((o) => o.label), ['Synthetic in person', 'Synthetic remote']);
    assert.equal(list[0].applicability.isRequired, true);
    assert.match(list[0].version, /^v\d+$/);
  });

  test('create: new field, its options, and its use by the Program, all audited together', async () => {
    const { store, fields } = seed();
    const result = await fields.createField(MANAGER_11, 11, {
      label: '  Synthetic languages offered ', dataType: 'MULTI_SELECT', options: ['Synthetic A', 'Synthetic B'], isRequired: true, displayOrder: 5,
    }, { correlationId: 'c-14b' });
    assert.equal(result.status, 'CREATED');
    const f = result.field;
    assert.equal(f.label, 'Synthetic languages offered');
    assert.equal(f.appliesTo, 'PROGRAM_INFO');
    assert.deepEqual(f.options.map((o) => o.label), ['Synthetic A', 'Synthetic B']);
    assert.deepEqual([f.applicability.isRequired, f.applicability.displayOrder], [true, 5]);
    assert.equal(fieldRow(store, f.fieldId).fieldKey, `field_${f.fieldId}`);
    assert.deepEqual(audit(store).map((e) => `${e.entityType}:${e.action}`),
      ['FIELD:CREATED', 'FIELD_OPTION:CREATED', 'FIELD_OPTION:CREATED', 'PROGRAM_FIELD:CREATED']);
    assert.ok(audit(store).every((e) => e.actorUserId === MANAGER_11 && e.correlationId === 'c-14b'));
  });

  test('use an existing ACTIVE field in another Program you manage', async () => {
    const { store, fields } = seed();
    const result = await fields.applyField(MANAGER_BOTH, 12, 2, { isRequired: true });
    assert.equal(result.status, 'APPLIED');
    assert.ok(store._applicabilityRows().some((a) => a.programId === 12 && a.fieldId === 2 && a.isRequired));
    await rejectsWith(fields.applyField(MANAGER_BOTH, 12, 2, {}), 'ALREADY_APPLIED');
    await rejectsWith(fields.applyField(MANAGER_BOTH, 12, 3, {}), 'FIELD_NOT_ACTIVE');
  });

  test('required/optional and display order per Program', async () => {
    const { store, fields } = seed();
    const { fields: [first] } = await fields.listProgramFields(MANAGER_11, 11);
    const res = await fields.updateApplicability(MANAGER_11, 11, 1, { version: first.applicability.version, isRequired: false });
    assert.equal(res.applicability.isRequired, false);
    assert.equal(store._applicabilityRows().find((a) => a.programId === 12 && a.fieldId === 1).isRequired, false, 'other Program unchanged');
    const event = audit(store, 'PROGRAM_FIELD').at(-1);
    assert.deepEqual([event.action, event.before, event.after],
      ['UPDATED', { field_id: 1, is_required: true }, { field_id: 1, is_required: false }]);
    await rejectsWith(fields.updateApplicability(MANAGER_11, 11, 1, { version: res.applicability.version, isRequired: false }), 'NO_CHANGE');
    await rejectsWith(fields.updateApplicability(MANAGER_11, 11, 1, { version: first.applicability.version, displayOrder: 9 }), 'PROGRAM_CHANGED');
    await rejectsWith(fields.updateApplicability(MANAGER_11, 11, 4, { version: 'v1', displayOrder: 9 }), 'FIELD_NOT_APPLIED');
  });

  test('a retired Program cannot get new fields', async () => {
    const { fields } = seed();
    await rejectsWith(fields.createField(MANAGER_11, 14, { label: 'Synthetic x', dataType: 'TEXT' }), 'PROGRAM_RETIRED');
  });
});

describe('field identity follows meaning (PRD 4.3)', () => {
  test('rename: same fieldId, wording changed, audited as RENAMED', async () => {
    const { store, fields } = seed();
    const result = await fields.renameField(MANAGER_11, 2, { version: fieldRow(store, 2).version, label: 'Synthetic session type' });
    assert.equal(result.field.fieldId, 2);
    assert.equal(fieldRow(store, 2).label, 'Synthetic session type');
    const event = audit(store, 'FIELD').at(-1);
    assert.deepEqual([event.action, event.before, event.after],
      ['RENAMED', { label: 'Synthetic session format' }, { label: 'Synthetic session type' }]);
  });

  test('replace: old field discontinued and linked to a new field used by the same Programs', async () => {
    const { store, fields } = seed();
    const result = await fields.replaceField(MANAGER_BOTH, 1, {
      version: fieldRow(store, 1).version, label: 'Synthetic intake days', dataType: 'MULTI_SELECT', options: ['Synthetic Mon', 'Synthetic Tue'],
    });
    const newId = result.replacement.fieldId;
    assert.notEqual(newId, 1);
    const old = fieldRow(store, 1);
    assert.deepEqual([old.lifecycleStatus, old.replacedByFieldId, old.label], ['DISCONTINUED', newId, 'Synthetic intake hours']);
    assert.match(old.discontinuedAt, /Z$/);
    const uses = store._applicabilityRows().filter((a) => a.fieldId === newId).map((a) => [a.programId, a.isRequired, a.displayOrder]);
    assert.deepEqual(uses, [[11, true, 1], [12, false, 3]], 'same Programs, same settings');
    assert.equal(store._applicabilityRows().filter((a) => a.fieldId === 1).length, 2, 'old use rows kept for history');
    const created = audit(store, 'FIELD').find((e) => e.entityId === newId && e.action === 'CREATED');
    assert.equal(created.after.replaces_field_id, 1);
    const replaced = audit(store, 'FIELD').find((e) => e.entityId === 1);
    assert.deepEqual([replaced.action, replaced.after.replaced_by_field_id], ['REPLACED', newId]);
  });

  test('a replaced field cannot be reactivated', async () => {
    const { store, fields } = seed();
    await fields.replaceField(MANAGER_BOTH, 1, { version: fieldRow(store, 1).version, label: 'Synthetic new meaning', dataType: 'TEXT' });
    await rejectsWith(fields.reactivateField(MANAGER_BOTH, 1, { version: fieldRow(store, 1).version }), 'FIELD_REPLACED');
  });

  test('only an ACTIVE field can be replaced; a retired field cannot be renamed', async () => {
    const { store, fields } = seed();
    await rejectsWith(fields.replaceField(MANAGER_11, 3, { version: fieldRow(store, 3).version, label: 'x', dataType: 'TEXT' }), 'FIELD_NOT_ACTIVE');
    await fields.retireField(ORG_ADMIN, 3, { version: fieldRow(store, 3).version });
    await rejectsWith(fields.renameField(MANAGER_11, 3, { version: fieldRow(store, 3).version, label: 'Synthetic y' }), 'FIELD_RETIRED');
  });
});

describe('field lifecycle (PRD 4.3)', () => {
  test('discontinue and reactivate, audited', async () => {
    const { store, fields } = seed();
    const off = await fields.discontinueField(MANAGER_11, 2, { version: fieldRow(store, 2).version });
    assert.equal(off.field.lifecycleStatus, 'DISCONTINUED');
    assert.match(fieldRow(store, 2).discontinuedAt, /Z$/);
    const on = await fields.reactivateField(MANAGER_11, 2, { version: off.field.version });
    assert.equal(on.field.lifecycleStatus, 'ACTIVE');
    assert.equal(fieldRow(store, 2).discontinuedAt, null);
    assert.deepEqual(audit(store, 'FIELD').map((e) => e.action), ['DISCONTINUED', 'REACTIVATED']);
    await rejectsWith(fields.reactivateField(MANAGER_11, 2, { version: on.field.version }), 'ALREADY_IN_STATUS');
  });

  test(`retire: MANAGE_ORGANIZATION at ORG scope, only after ${RETIRE_AFTER_DAYS} days discontinued`, async () => {
    const { store, fields, clock } = seed();
    const off = await fields.discontinueField(MANAGER_11, 2, { version: fieldRow(store, 2).version });
    await rejectsWith(fields.retireField(ORG_ADMIN, 2, { version: off.field.version }), 'RETIRE_NOT_YET');
    clock.advanceDays(RETIRE_AFTER_DAYS - 1);
    await rejectsWith(fields.retireField(ORG_ADMIN, 2, { version: off.field.version }), 'RETIRE_NOT_YET');
    clock.advanceDays(1);
    const retired = await fields.retireField(ORG_ADMIN, 2, { version: off.field.version });
    assert.equal(retired.field.lifecycleStatus, 'RETIRED');
    assert.match(fieldRow(store, 2).retiredAt, /Z$/);
    assert.equal(store._optionRows().filter((o) => o.fieldId === 2).length, 2, 'nothing deleted');
    assert.equal(store._applicabilityRows().filter((a) => a.fieldId === 2).length, 1, 'nothing deleted');
    await rejectsWith(fields.reactivateField(MANAGER_11, 2, { version: retired.field.version }), 'FIELD_RETIRED');
  });

  test('retire refused for an active field, for Program managers, and for PROGRAM-scope MANAGE_ORGANIZATION', async () => {
    const { store, fields } = seed();
    await rejectsWith(fields.retireField(ORG_ADMIN, 2, { version: fieldRow(store, 2).version }), 'NOT_DISCONTINUED');
    for (const userId of [MANAGER_11, MANAGER_BOTH, NARROW_ADMIN]) {
      await rejectsWith(fields.retireField(userId, 3, { version: fieldRow(store, 3).version }), 'NOT_AUTHORIZED');
    }
    assert.equal(fieldRow(store, 3).lifecycleStatus, 'DISCONTINUED');
  });
});

describe('who may change a field (PRD 3.6, capability + resource + scope)', () => {
  test('a shared field needs MANAGE_PROGRAM for EVERY Program that uses it', async () => {
    const { store, fields } = seed();
    const version = fieldRow(store, 1).version;
    await rejectsWith(fields.renameField(MANAGER_11, 1, { version, label: 'Synthetic z' }), 'NOT_AUTHORIZED');
    await rejectsWith(fields.discontinueField(MANAGER_11, 1, { version }), 'NOT_AUTHORIZED');
    await rejectsWith(fields.replaceField(MANAGER_11, 1, { version, label: 'z', dataType: 'TEXT' }), 'NOT_AUTHORIZED');
    assert.equal((await fields.renameField(MANAGER_BOTH, 1, { version, label: 'Synthetic z' })).status, 'RENAMED');
  });

  test('a field used by no Program cannot be changed here (fail closed)', async () => {
    const { store, fields } = seed();
    await rejectsWith(fields.renameField(MANAGER_BOTH, 4, { version: fieldRow(store, 4).version, label: 'Synthetic q' }), 'NOT_AUTHORIZED');
  });

  for (const [label, userId, code] of [
    ['no grants', NOBODY, 'NOT_AUTHORIZED'],
    ['revoked grant', REVOKED, 'NOT_AUTHORIZED'],
    ['MANAGE_ORGANIZATION only', ORG_ADMIN, 'NOT_AUTHORIZED'],
    ['inactive account', INACTIVE, 'USER_NOT_ACTIVE'],
  ]) {
    test(`refused everywhere: ${label}`, async () => {
      const { store, fields } = seed();
      const before = JSON.stringify([store._fieldRows(), store._optionRows(), store._applicabilityRows()]);
      await rejectsWith(fields.listProgramFields(userId, 11), code);
      await rejectsWith(fields.createField(userId, 11, { label: 'Synthetic x', dataType: 'TEXT' }), code);
      await rejectsWith(fields.renameField(userId, 2, { version: fieldRow(store, 2).version, label: 'Synthetic x' }), code);
      await rejectsWith(fields.addOption(userId, 2, { label: 'Synthetic x' }), code);
      assert.equal(JSON.stringify([store._fieldRows(), store._optionRows(), store._applicabilityRows()]), before);
      assert.equal(audit(store).length, 0);
    });
  }

  test('Program-level actions need MANAGE_PROGRAM for that Program only', async () => {
    const { fields } = seed();
    await rejectsWith(fields.listProgramFields(MANAGER_11, 12), 'NOT_AUTHORIZED');
    await rejectsWith(fields.applyField(MANAGER_11, 12, 2, {}), 'NOT_AUTHORIZED');
    await rejectsWith(fields.listProgramFields(MANAGER_11, 999), 'PROGRAM_NOT_FOUND');
  });
});

describe('options', () => {
  test('add, rename, discontinue, reactivate; audited', async () => {
    const { store, fields } = seed();
    const added = await fields.addOption(MANAGER_11, 2, { label: 'Synthetic hybrid' });
    const opt = added.field.options.find((o) => o.label === 'Synthetic hybrid');
    assert.equal(opt.displayOrder, 2);
    const renamed = await fields.renameOption(MANAGER_11, 2, opt.optionId, { version: opt.version, label: 'Synthetic mixed' });
    const now = renamed.field.options.find((o) => o.optionId === opt.optionId);
    const off = await fields.discontinueOption(MANAGER_11, 2, opt.optionId, { version: now.version });
    assert.equal(optionRow(store, opt.optionId).lifecycleStatus, 'DISCONTINUED');
    const offRow = off.field.options.find((o) => o.optionId === opt.optionId);
    await fields.reactivateOption(MANAGER_11, 2, opt.optionId, { version: offRow.version });
    assert.deepEqual(audit(store, 'FIELD_OPTION').map((e) => e.action), ['CREATED', 'RENAMED', 'DISCONTINUED', 'REACTIVATED']);
  });

  test('option rules', async () => {
    const { store, fields } = seed();
    await rejectsWith(fields.addOption(MANAGER_11, 2, { label: 'synthetic REMOTE' }), 'DUPLICATE_OPTION');
    await rejectsWith(fields.addOption(MANAGER_BOTH, 1, { label: 'Synthetic x' }), 'OPTIONS_NOT_ALLOWED');
    await rejectsWith(fields.addOption(MANAGER_11, 3, { label: 'Synthetic x' }), 'FIELD_NOT_ACTIVE');
    await rejectsWith(fields.renameOption(MANAGER_11, 2, 1, { version: optionRow(store, 1).version, label: 'Synthetic remote' }), 'DUPLICATE_OPTION');
    await rejectsWith(fields.renameOption(MANAGER_11, 1, 1, { version: 'v1', label: 'x' }), 'NOT_AUTHORIZED');
    await rejectsWith(fields.renameOption(MANAGER_11, 2, 999, { version: 'v1', label: 'x' }), 'OPTION_NOT_FOUND');
    await fields.discontinueOption(MANAGER_11, 2, 1, { version: optionRow(store, 1).version });
    await rejectsWith(fields.discontinueOption(MANAGER_11, 2, 2, { version: optionRow(store, 2).version }), 'LAST_ACTIVE_OPTION');
  });

  test('an option belongs to its own field only', async () => {
    const { store, fields } = seed();
    const created = await fields.createField(MANAGER_11, 11, { label: 'Synthetic other', dataType: 'SINGLE_SELECT', options: ['Synthetic one', 'Synthetic two'] });
    await rejectsWith(fields.renameOption(MANAGER_11, created.field.fieldId, 1, { version: optionRow(store, 1).version, label: 'Synthetic moved' }), 'OPTION_NOT_FOUND');
  });
});

describe('stale versions, concurrency, rollback (PRD 9.3, 9.4, 9.6)', () => {
  test('stale version -> FIELD_CHANGED with the current field; nothing written', async () => {
    const { store, fields } = seed();
    const seen = fieldRow(store, 2).version;
    await fields.renameField(MANAGER_11, 2, { version: seen, label: 'Synthetic first' });
    const n = audit(store).length;
    const err = await rejectsWith(fields.renameField(SECOND_11, 2, { version: seen, label: 'Synthetic second' }), 'FIELD_CHANGED');
    assert.equal(err.current.label, 'Synthetic first');
    assert.equal(err.current.version, fieldRow(store, 2).version);
    assert.equal(audit(store).length, n);
  });

  test('two renames at once with the same version: exactly one wins', async () => {
    const { store, fields } = seed();
    const version = fieldRow(store, 2).version;
    const results = await Promise.allSettled([
      fields.renameField(MANAGER_11, 2, { version, label: 'Synthetic A' }),
      fields.renameField(SECOND_11, 2, { version, label: 'Synthetic B' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'FIELD_CHANGED');
    assert.equal(audit(store, 'FIELD').length, 1);
  });

  test('replace racing a discontinue: one wins, no half state', async () => {
    const { store, fields } = seed();
    const version = fieldRow(store, 1).version;
    const results = await Promise.allSettled([
      fields.replaceField(MANAGER_BOTH, 1, { version, label: 'Synthetic n', dataType: 'TEXT' }),
      fields.discontinueField(SECOND_11, 1, { version }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(store._fieldRows().length, results[0].status === 'fulfilled' ? 5 : 4);
  });

  test('if any audit write fails, the whole change rolls back (create)', async () => {
    const { store, fields } = seed();
    const before = JSON.stringify([store._fieldRows(), store._optionRows(), store._applicabilityRows()]);
    store._failNextAudit();
    await assert.rejects(fields.createField(MANAGER_11, 11, { label: 'Synthetic x', dataType: 'SINGLE_SELECT', options: ['Synthetic a'] }));
    assert.equal(JSON.stringify([store._fieldRows(), store._optionRows(), store._applicabilityRows()]), before);
    assert.equal(audit(store).length, 0);
  });

  test('if the audit write fails during replace, nothing changes', async () => {
    const { store, fields } = seed();
    const before = JSON.stringify([store._fieldRows(), store._optionRows(), store._applicabilityRows()]);
    store._failNextAudit();
    await assert.rejects(fields.replaceField(MANAGER_BOTH, 1, { version: fieldRow(store, 1).version, label: 'Synthetic n', dataType: 'TEXT' }));
    assert.equal(JSON.stringify([store._fieldRows(), store._optionRows(), store._applicabilityRows()]), before);
  });

  test('a revocation during a field change waits for it', async () => {
    const { store, fields } = seed();
    let reached; let release;
    const reachedP = new Promise((r) => { reached = r; });
    const gate = new Promise((r) => { release = r; });
    let paused = false;
    store._afterLockingRead(async (kind, id) => {
      if (!paused && kind === 'grants' && id === MANAGER_11) { paused = true; reached(); await gate; }
    });
    const renaming = fields.renameField(MANAGER_11, 2, { version: fieldRow(store, 2).version, label: 'Synthetic during' });
    await reachedP;
    let revoked = false;
    const revoking = store._revokeGrants(MANAGER_11, 'MANAGE_PROGRAM').then(() => { revoked = true; });
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(revoked, false);
    release();
    assert.equal((await renaming).status, 'RENAMED');
    await revoking;
    await rejectsWith(fields.renameField(MANAGER_11, 2, { version: fieldRow(store, 2).version, label: 'Synthetic after' }), 'NOT_AUTHORIZED');
  });
});

describe('validation (PRD 10.3, 10.4)', () => {
  test('create rules', () => {
    assert.deepEqual(validateCreateField({ label: 'x', dataType: 'SINGLE_SELECT' }).fields, ['options']);
    assert.deepEqual(validateCreateField({ label: 'x', dataType: 'TEXT', options: ['a'] }).fields, ['options']);
    assert.deepEqual(validateCreateField({ label: 'x', dataType: 'MULTI_SELECT', options: ['a', ' A '] }).fields, ['options']);
    assert.deepEqual(validateCreateField({ label: 'x', dataType: 'PHOTO' }).fields, ['dataType']);
    assert.deepEqual(validateCreateField({ label: '', dataType: 'TEXT' }).fields, ['label']);
    assert.deepEqual(validateCreateField({ label: 'x'.repeat(201), dataType: 'TEXT' }).fields, ['label']);
    assert.deepEqual(validateCreateField({ label: 'a\nb', dataType: 'TEXT' }).fields, ['label']);
    assert.deepEqual(validateCreateField({ label: 'x', dataType: 'TEXT', isRequired: 'yes' }).fields, ['isRequired']);
    assert.equal(validateCreateField({ label: 'x', dataType: 'TEXT', appliesTo: 'REFERRAL_FORM' }).unexpectedField, true, 'REFERRAL_FORM not in this slice');
  });

  for (const extra of [{ fieldId: 9 }, { fieldKey: 'k' }, { lifecycleStatus: 'RETIRED' }, { replacedByFieldId: 1 }, { [MARKER]: 1 }]) {
    test(`rename refuses ${Object.keys(extra)[0]} without echo`, async () => {
      const { store, fields } = seed();
      const err = await rejectsWith(fields.renameField(MANAGER_11, 2, { version: fieldRow(store, 2).version, label: 'Synthetic', ...extra }), 'UNEXPECTED_FIELD');
      assert.doesNotMatch(JSON.stringify({ m: err.message, f: err.fields }), new RegExp(Object.keys(extra)[0]));
    });
  }
});

describe('HTTP routes', () => {
  const appFor = (store, userId = MANAGER_11) => createApp({
    affiliationStore: store, referralStore: store, resolveIdentity: () => (userId === null ? null : { userId }), nodeEnv: 'test',
  });
  const base = '/api/program-management';

  test('full flow over HTTP, never cached', async () => {
    const { store } = seed();
    const app = appFor(store);
    const list = await request(app).get(`${base}/programs/11/fields`);
    assert.equal(list.status, 200);
    assert.equal(list.headers['cache-control'], 'no-store');
    const created = await request(app).post(`${base}/programs/11/fields`).send({ label: 'Synthetic hours', dataType: 'TEXT' });
    assert.equal(created.status, 201);
    const id = created.body.field.fieldId;
    const renamed = await request(app).patch(`${base}/fields/${id}`).send({ version: created.body.field.version, label: 'Synthetic open hours' });
    assert.equal(renamed.body.status, 'RENAMED');
    const off = await request(app).post(`${base}/fields/${id}/discontinue`).send({ version: renamed.body.field.version });
    assert.equal(off.body.status, 'DISCONTINUED');
    const option = await request(app).post(`${base}/fields/2/options`).send({ label: 'Synthetic phone' });
    assert.equal(option.status, 201);
    const stale = await request(app).patch(`${base}/fields/${id}`).send({ version: created.body.field.version, label: 'Late' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'FIELD_CHANGED');
    assert.ok(stale.body.current);
  });

  test('errors: 401, 403, 404, query refused without echo', async () => {
    const { store } = seed();
    assert.equal((await request(appFor(store, null)).get(`${base}/programs/11/fields`)).status, 401);
    assert.equal((await request(appFor(store, NOBODY)).get(`${base}/programs/11/fields`)).status, 403);
    assert.equal((await request(appFor(store)).patch(`${base}/fields/999`).send({ version: 'v1', label: 'x' })).status, 404);
    assert.equal((await request(appFor(store)).patch(`${base}/fields/abc`).send({ version: 'v1', label: 'x' })).status, 404);
    const q = await request(appFor(store)).get(`${base}/programs/11/fields?${MARKER}=1`);
    assert.equal(q.status, 400);
    assert.doesNotMatch(JSON.stringify(q.body), new RegExp(MARKER));
  });
});

describe('store contract: field tables', () => {
  test('conditional updates write nothing on a stale version', async () => {
    const { store } = seed();
    const before = JSON.stringify([store._fieldRows(), store._optionRows(), store._applicabilityRows()]);
    const results = await store.withTransaction(async (tx) => {
      await tx.lockFieldForUpdate(2);
      await tx.lockOptionForUpdate(1);
      await tx.lockApplicabilityForUpdate(11, 2);
      return [
        await tx.updateField({ fieldId: 2, expectedVersion: 'v999', set: { label: 'x' } }),
        await tx.updateOption({ optionId: 1, expectedVersion: 'v999', set: { label: 'x' } }),
        await tx.updateApplicability({ programId: 11, fieldId: 2, expectedVersion: 'v999', set: { isRequired: true } }),
      ];
    });
    assert.deepEqual(results, [null, null, null]);
    assert.equal(JSON.stringify([store._fieldRows(), store._optionRows(), store._applicabilityRows()]), before);
  });

  test('updates require holding the row for update', async () => {
    const { store } = seed();
    await assert.rejects(store.withTransaction((tx) => tx.updateField({ fieldId: 2, expectedVersion: 'v1', set: { label: 'x' } })), /holding it for update/);
  });
});
