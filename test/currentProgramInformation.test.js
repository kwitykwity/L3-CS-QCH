import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createFieldService } from '../src/programs/fieldService.js';
import { readCurrentProgramInformation } from '../src/programs/currentProgramInformation.js';

function setup() {
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Department', lifecycleStatus: 'ACTIVE' }],
    programs: [3, 7].map((programId) => ({
      programId, departmentId: 1, name: `Synthetic Program ${programId}`,
      lifecycleStatus: 'ACTIVE', description: 'Synthetic description',
      notificationEmail: 'synthetic-routing@example.invalid',
    })),
    users: [{ userId: 1, isActive: true }],
    grants: [3, 7].map((programId) => ({
      userId: 1, permission: 'MANAGE_PROGRAM', scopeType: 'PROGRAM',
      programId, departmentId: null, grantSource: 'IN_APP',
    })),
  });
  const service = createFieldService({ store });
  const read = (programId) => store.withTransaction(async (tx) =>
    readCurrentProgramInformation(tx, await tx.getProgram(programId)));
  const save = async (programId, fieldId, value) => {
    const current = (await service.listProgramFields(1, programId)).fields
      .find((field) => field.fieldId === fieldId);
    return service.setFieldValue(1, programId, fieldId, {
      version: current.applicability.version, value,
    });
  };
  return { store, service, read, save };
}

test('current information follows real edits and preserves independent values for a shared field', async () => {
  const { service, read, save } = setup();
  const { field } = await service.createField(1, 3, {
    label: 'Synthetic availability notes', dataType: 'TEXT',
  });
  await service.applyField(1, 7, field.fieldId, { isRequired: false, displayOrder: 0 });
  await save(3, field.fieldId, 'Synthetic openings available');
  await save(7, field.fieldId, 'Synthetic wait time: two weeks');

  const first = await read(3);
  const second = await read(7);
  assert.equal(first.fields[0].fieldId, second.fields[0].fieldId);
  assert.equal(first.fields[0].value, 'Synthetic openings available');
  assert.equal(second.fields[0].value, 'Synthetic wait time: two weeks');
  assert.equal(first.description, 'Synthetic description');
  assert.equal(Object.hasOwn(first, 'notificationEmail'), false);
  assert.equal(Object.hasOwn(first, 'permissions'), false);
  assert.doesNotMatch(JSON.stringify(first), /synthetic-routing/);

  const renamed = await service.renameField(1, field.fieldId, {
    version: field.version, label: 'Synthetic current availability notes',
  });
  const current = await read(3);
  assert.equal(current.fields[0].fieldId, field.fieldId);
  assert.equal(current.fields[0].label, renamed.field.label);
  assert.equal(current.fields[0].value, 'Synthetic openings available');

  await service.discontinueField(1, field.fieldId, { version: renamed.field.version });
  assert.deepEqual((await read(3)).fields, []);
  assert.deepEqual((await read(7)).fields, []);
  const history = (await service.listProgramFields(1, 3)).fields
    .find((item) => item.fieldId === field.fieldId);
  assert.equal(history.value, 'Synthetic openings available');
  assert.equal(history.lifecycleStatus, 'DISCONTINUED');
});

test('a saved discontinued choice keeps its identity and lifecycle while unselected history is omitted', async () => {
  const { service, read, save } = setup();
  const { field } = await service.createField(1, 3, {
    label: 'Synthetic enrollment cycle', dataType: 'SINGLE_SELECT',
    options: ['Synthetic current cycle', 'Synthetic next cycle', 'Synthetic old cycle'],
  });
  const [selected, active, unused] = field.options;
  await save(3, field.fieldId, selected.optionId);
  await service.discontinueOption(1, field.fieldId, selected.optionId, { version: selected.version });
  await service.discontinueOption(1, field.fieldId, unused.optionId, { version: unused.version });

  const information = await read(3);
  const current = information.fields[0];
  assert.equal(current.value, selected.optionId);
  assert.deepEqual(current.options.map((option) => option.optionId), [selected.optionId, active.optionId]);
  assert.equal(current.options[0].lifecycleStatus, 'DISCONTINUED');
  assert.equal(current.options[1].lifecycleStatus, 'ACTIVE');
});

test('matching service reads current information after edits without changing match rules', async () => {
  const { createGpmeService } = await import('../src/gpme/gpmeService.js');
  const { store, service, save } = setup();
  const gpme = createGpmeService({ store });
  const { field } = await service.createField(1, 3, {
    label: 'Synthetic current schedule', dataType: 'TEXT',
  });
  await service.applyField(1, 7, field.fieldId, { isRequired: false, displayOrder: 0 });
  await save(3, field.fieldId, 'Synthetic Tuesday evenings');
  await save(7, field.fieldId, 'Synthetic Saturday mornings');

  const initial = await gpme.listCurrentProgramInformation(1);
  assert.deepEqual(initial.map((program) => program.programId), [3, 7]);
  assert.equal(initial[0].fields[0].value, 'Synthetic Tuesday evenings');
  assert.equal(initial[1].fields[0].value, 'Synthetic Saturday mornings');
  assert.equal(initial[0].matchingFacts.ageLimitState, 'NOT_ON_FILE');
  assert.equal(initial[0].matchingFacts.serviceAreaState, 'NOT_ON_FILE');
  assert.doesNotMatch(JSON.stringify(initial), /notificationEmail|synthetic-routing|actorUserId|grantSource/);

  await save(3, field.fieldId, 'Synthetic Wednesday evenings');
  const updated = await gpme.listCurrentProgramInformation(1);
  assert.equal(updated[0].fields[0].value, 'Synthetic Wednesday evenings');
  assert.equal(updated[1].fields[0].value, 'Synthetic Saturday mornings');
  assert.deepEqual(updated[0].matchingFacts, initial[0].matchingFacts);
  assert.notEqual(updated[0].fields[0].applicabilityVersion,
    initial[0].fields[0].applicabilityVersion);
  assert.equal(initial[0].fields[0].value, 'Synthetic Tuesday evenings');
});

test('matching information requires an active identity and excludes inactive Programs and Departments', async () => {
  const { createGpmeService } = await import('../src/gpme/gpmeService.js');
  const { store } = setup();
  const gpme = createGpmeService({ store });

  await assert.rejects(gpme.listCurrentProgramInformation(0),
    (error) => error.code === 'NOT_AUTHENTICATED');
  await assert.rejects(gpme.listCurrentProgramInformation(999),
    (error) => error.code === 'USER_NOT_ACTIVE');

  await store._setProgramStatus(7, 'DISCONTINUED');
  assert.deepEqual((await gpme.listCurrentProgramInformation(1))
    .map((program) => program.programId), [3]);
  await store._setDepartmentStatus(1, 'DISCONTINUED');
  assert.deepEqual(await gpme.listCurrentProgramInformation(1), []);
});
