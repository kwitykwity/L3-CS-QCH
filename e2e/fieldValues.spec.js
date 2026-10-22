import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './helpers.js';

async function createField(request, dataType, suffix) {
  const body = { label: `Synthetic ${suffix}`, dataType };
  if (dataType.includes('SELECT')) body.options = ['First', 'Second'];
  const response = await request.post('/api/program-management/programs/3/fields', { data: body });
  expect(response.status()).toBe(201);
  return (await response.json()).field;
}
async function stored(request, fieldId) {
  const response = await request.get('/api/program-management/programs/3/fields');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).fields.find((field) => field.fieldId === fieldId);
}
function panel(page, field) {
  return page.locator('section.panel').filter({
    has: page.getByRole('heading', { name: field.label, exact: true }),
  });
}

test('all six field types save and reload; generated controls pass axe in both themes', async ({ page, request }) => {
  const fields = [];
  for (const type of ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SINGLE_SELECT', 'MULTI_SELECT']) {
    fields.push(await createField(request, type, `value ${type}`));
  }
  await page.goto('/program-management/fields.html?programId=3');
  await expect(page.locator('#field-status')).toContainText('Saved fields loaded.');

  for (const field of fields) {
    const control = page.locator(`#value-${field.fieldId}`);
    let expected;
    if (field.dataType === 'MULTI_SELECT') {
      await page.locator(`#value-${field.fieldId}-${field.options[0].optionId}`).check();
      expected = [field.options[0].optionId];
    } else if (field.dataType === 'BOOLEAN') {
      await control.selectOption('false');
      expected = false;
    } else if (field.dataType === 'SINGLE_SELECT') {
      expected = field.options[1].optionId;
      await control.selectOption(String(expected));
    } else {
      expected = { TEXT: 'Synthetic field value', NUMBER: 12.3456, DATE: '2026-10-21' }[field.dataType];
      await control.fill(String(expected));
    }
    await panel(page, field).getByRole('button', { name: 'Save field value' }).click();
    await expect(page.locator('#field-status')).toHaveText('Field value saved.');
    expect((await stored(request, field.fieldId)).value).toEqual(expected);
  }

  await page.reload();
  await expect(page.locator('#field-status')).toContainText('Saved fields loaded.');
  await expect(page.locator(`#value-${fields[0].fieldId}`)).toHaveValue('Synthetic field value');
  await expect(page.locator(`#value-${fields[3].fieldId}`)).toHaveValue('false');
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await expectNoAxeViolations(page, `generated field controls, ${colorScheme}`);
  }
});

test('stale field value preserves entered work and blocks another save', async ({ page, request }) => {
  const field = await createField(request, 'TEXT', 'stale value');
  await page.goto('/program-management/fields.html?programId=3');
  const control = page.locator(`#value-${field.fieldId}`);
  await control.fill('Synthetic stale work');
  const current = await stored(request, field.fieldId);
  const changed = await request.put(`/api/program-management/programs/3/field-values/${field.fieldId}`, {
    data: { version: current.applicability.version, value: 'Synthetic authoritative value' },
  });
  expect(changed.ok()).toBeTruthy();
  await panel(page, field).getByRole('button', { name: 'Save field value' }).click();
  await expect(page.locator('#field-status')).toContainText('This field changed.');
  await expect(control).toHaveValue('Synthetic stale work');
  await expect(panel(page, field).getByRole('button', { name: 'Save field value' })).toBeDisabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#reload-fields').click();
  await expect(control).toHaveValue('Synthetic authoritative value');
});

test('uncertain field save preserves work until an explicit reload', async ({ page, request }) => {
  const field = await createField(request, 'TEXT', 'uncertain value');
  await page.goto('/program-management/fields.html?programId=3');
  const control = page.locator(`#value-${field.fieldId}`);
  await control.fill('Synthetic unsaved value');
  const url = `**/api/program-management/programs/3/field-values/${field.fieldId}`;
  await page.route(url, (route) => route.abort());
  await panel(page, field).getByRole('button', { name: 'Save field value' }).click();
  await expect(page.locator('#field-status')).toContainText('Save outcome is not confirmed.');
  await expect(control).toHaveValue('Synthetic unsaved value');
  await expect(panel(page, field).getByRole('button', { name: 'Save field value' })).toBeDisabled();
  await page.unroute(url);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#reload-fields').click();
  await expect(control).toHaveValue('');
  await expect(panel(page, field).getByRole('button', { name: 'Save field value' })).toBeEnabled();
});

test('creates a multi-select field through the screen and preserves its saved selection', async ({ page, request }) => {
  await page.goto('/program-management/fields.html?programId=3');
  await expect(page.locator('#create-field-panel')).toBeVisible();
  await page.locator('#new-field-label').fill('Synthetic transport options');
  await page.locator('#new-field-type').selectOption('MULTI_SELECT');
  await page.locator('#new-field-options').fill('Bus\nTrain');
  await page.getByRole('button', { name: 'Create field', exact: true }).click();
  await expect(page.locator('#field-status')).toHaveText('Field created. You can now enter its value.');

  const response = await request.get('/api/program-management/programs/3/fields');
  expect(response.ok()).toBeTruthy();
  const field = (await response.json()).fields.find((item) => item.label === 'Synthetic transport options');
  expect(field).toBeTruthy();
  const bus = field.options.find((option) => option.label === 'Bus');
  await page.locator(`#value-${field.fieldId}-${bus.optionId}`).check();
  await panel(page, field).getByRole('button', { name: 'Save field value' }).click();
  await expect(page.locator('#field-status')).toHaveText('Field value saved.');
  await page.reload();
  await expect(page.locator(`#value-${field.fieldId}-${bus.optionId}`)).toBeChecked();
});

test('uncertain creation preserves the form and prevents duplicate submission until reload', async ({ page }) => {
  await page.goto('/program-management/fields.html?programId=3');
  await expect(page.locator('#create-field-panel')).toBeVisible();
  await page.locator('#new-field-label').fill('Synthetic uncertain creation');
  const url = '**/api/program-management/programs/3/fields';
  await page.route(url, (route) => {
    return route.request().method() === 'POST' ? route.abort() : route.continue();
  });
  await page.getByRole('button', { name: 'Create field', exact: true }).click();
  await expect(page.locator('#field-status')).toContainText('Creation outcome is not confirmed.');
  await expect(page.locator('#new-field-label')).toHaveValue('Synthetic uncertain creation');
  await expect(page.getByRole('button', { name: 'Create field', exact: true })).toBeDisabled();
  await page.unroute(url);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#reload-fields').click();
  await expect(page.locator('#new-field-label')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Create field', exact: true })).toBeEnabled();
});

test('option maintenance preserves a saved selection', async ({ page, request }) => {
  const field = await createField(request, 'MULTI_SELECT', 'option maintenance');
  const first = field.options[0];
  await page.goto('/program-management/fields.html?programId=3');
  const selected = page.locator(`#value-${field.fieldId}-${first.optionId}`);
  await selected.check();
  await panel(page, field).getByRole('button', { name: 'Save field value' }).click();
  await expect(page.locator('#field-status')).toHaveText('Field value saved.');

  await page.locator(`#new-option-${field.fieldId}`).fill('Third');
  page.once('dialog', (dialog) => dialog.accept());
  await panel(page, field).getByRole('button', { name: 'Add option', exact: true }).click();
  await expect(page.locator('#field-status')).toHaveText('Field options saved.');
  expect((await stored(request, field.fieldId)).options.some((item) => item.label === 'Third')).toBeTruthy();

  const wording = page.locator(`#option-wording-${field.fieldId}-${first.optionId}`);
  await wording.fill('Renamed first');
  page.once('dialog', (dialog) => dialog.accept());
  await wording.locator('..').getByRole('button', { name: 'Rename option', exact: true }).click();
  await expect(wording).toHaveValue('Renamed first');
  expect((await stored(request, field.fieldId)).options.find((item) => item.optionId === first.optionId).label)
    .toBe('Renamed first');
  await expect(selected).toBeChecked();

  page.once('dialog', (dialog) => dialog.accept());
  await wording.locator('..').getByRole('button', { name: 'Discontinue option', exact: true }).click();
  await expect(wording.locator('..').getByRole('button', { name: 'Reactivate option', exact: true })).toBeVisible();
  await expect(selected).toBeChecked();
  expect((await stored(request, field.fieldId)).options.find((item) => item.optionId === first.optionId).lifecycleStatus)
    .toBe('DISCONTINUED');

  page.once('dialog', (dialog) => dialog.accept());
  await wording.locator('..').getByRole('button', { name: 'Reactivate option', exact: true }).click();
  await expect(wording.locator('..').getByRole('button', { name: 'Discontinue option', exact: true })).toBeVisible();
  await expect(selected).toBeChecked();
  await page.reload();
  await expect(selected).toBeChecked();
  expect((await stored(request, field.fieldId)).options.find((item) => item.optionId === first.optionId).lifecycleStatus)
    .toBe('ACTIVE');
});

test('replacement preserves historical values and creates an empty new field', async ({ page, request }) => {
  const field = await createField(request, 'TEXT', 'replacement source');
  const current = await stored(request, field.fieldId);
  const saved = await request.put(`/api/program-management/programs/3/field-values/${field.fieldId}`, {
    data: { version: current.applicability.version, value: 'Synthetic historical value' },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto('/program-management/fields.html?programId=3');
  await panel(page, field).getByRole('link', { name: 'Replace field meaning' }).click();
  await expect(page.locator('#replacement-controls')).toBeEnabled();
  await page.locator('#replacement-label').fill('Synthetic replacement meaning');
  await page.locator('#replacement-type').selectOption('BOOLEAN');
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await expectNoAxeViolations(page, `replacement form, ${colorScheme}`);
  }
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Replace field', exact: true }).click();
  await expect(page.locator('#replacement-status')).toContainText('Field replaced.');

  const old = await stored(request, field.fieldId);
  expect(old.lifecycleStatus).toBe('DISCONTINUED');
  expect(old.value).toBe('Synthetic historical value');
  expect(old.replacedByFieldId).not.toBe(field.fieldId);
  const replacement = await stored(request, old.replacedByFieldId);
  expect(replacement.label).toBe('Synthetic replacement meaning');
  expect(replacement.lifecycleStatus).toBe('ACTIVE');
  expect(replacement.value).toBeNull();

  await page.getByRole('link', { name: 'Return to Program fields' }).click();
  await expect(page.locator(`#value-${field.fieldId}`)).toHaveValue('Synthetic historical value');
  await expect(panel(page, field).getByRole('button', { name: 'Save field value' })).toBeDisabled();
  await expect(page.locator(`#value-${replacement.fieldId}`)).toHaveValue('');
});

test('retirement before the review period preserves historical values', async ({ page, request }) => {
  const field = await createField(request, 'TEXT', 'retirement review');
  let current = await stored(request, field.fieldId);
  const saved = await request.put(`/api/program-management/programs/3/field-values/${field.fieldId}`, {
    data: { version: current.applicability.version, value: 'Synthetic preserved history' },
  });
  expect(saved.ok()).toBeTruthy();
  current = await stored(request, field.fieldId);
  const discontinued = await request.post(`/api/program-management/fields/${field.fieldId}/discontinue`, {
    data: { version: current.version },
  });
  expect(discontinued.ok()).toBeTruthy();

  await page.goto('/program-management/fields.html?programId=3');
  const retire = panel(page, field).getByRole('button', { name: 'Retire field', exact: true });
  await expect(retire).toBeEnabled();
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await expectNoAxeViolations(page, `discontinued field with retirement control, ${colorScheme}`);
  }
  page.once('dialog', (dialog) => dialog.accept());
  await retire.click();
  await expect(page.locator('#field-status')).toContainText('90-day review period');
  current = await stored(request, field.fieldId);
  expect(current.lifecycleStatus).toBe('DISCONTINUED');
  expect(current.value).toBe('Synthetic preserved history');
  await expect(page.locator(`#value-${field.fieldId}`)).toHaveValue('Synthetic preserved history');
  await expect(retire).toBeEnabled();
});

test('reusing a field shares its identity while keeping each Program value separate', async ({ page, request }) => {
  const field = await createField(request, 'TEXT', 'shared value isolation');
  const source = await stored(request, field.fieldId);
  const saved = await request.put(`/api/program-management/programs/3/field-values/${field.fieldId}`, {
    data: { version: source.applicability.version, value: 'Synthetic source value' },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto('/program-management/reuse-field.html?programId=7');
  await page.locator('#reuse-field').selectOption(String(field.fieldId));
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await expectNoAxeViolations(page, `existing field reuse, ${colorScheme}`);
  }
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Use this field', exact: true }).click();
  await expect(page.locator('#reuse-status')).toContainText('Field added to this Program.');
  await page.getByRole('link', { name: 'Return to Program fields' }).click();
  await expect(page).toHaveURL(/fields\.html\?programId=7$/);
  const value = page.locator(`#value-${field.fieldId}`);
  await expect(value).toHaveValue('');
  await value.fill('Synthetic target value');
  await panel(page, field).getByRole('button', { name: 'Save field value' }).click();
  await expect(page.locator('#field-status')).toHaveText('Field value saved.');

  expect((await stored(request, field.fieldId)).value).toBe('Synthetic source value');
  const targetResponse = await request.get('/api/program-management/programs/7/fields');
  expect(targetResponse.ok()).toBeTruthy();
  const target = (await targetResponse.json()).fields.find((row) => row.fieldId === field.fieldId);
  expect(target.value).toBe('Synthetic target value');
  expect(target.applicability.programId).toBe(7);
  await page.reload();
  await expect(value).toHaveValue('Synthetic target value');
});

test('eligible retirement preserves history through the real browser and API', async ({ page }) => {
  const { createApp } = await import('../src/app.js');
  const { createMemoryReferralStore } = await import('../src/referrals/memoryReferralStore.js');
  const { createFieldService, RETIRE_AFTER_DAYS } = await import('../src/programs/fieldService.js');
  let instant = Date.parse('2026-01-01T12:00:00.000Z');
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic retirement Department', lifecycleStatus: 'ACTIVE' }],
    programs: [{ programId: 3, departmentId: 1, name: 'Synthetic retirement Program', lifecycleStatus: 'ACTIVE' }],
    users: [{ userId: 1, isActive: true }],
    grants: [
      { userId: 1, permission: 'MANAGE_PROGRAM', scopeType: 'PROGRAM', programId: 3, departmentId: null, grantSource: 'IN_APP' },
      { userId: 1, permission: 'MANAGE_ORGANIZATION', scopeType: 'ORG', programId: null, departmentId: null, grantSource: 'IN_APP' },
    ],
  }, { now: () => new Date(instant) });
  const service = createFieldService({ store });
  const created = await service.createField(1, 3, {
    label: 'Synthetic eligible retirement', dataType: 'TEXT',
  });
  await service.setFieldValue(1, 3, created.field.fieldId, {
    version: created.field.applicability.version, value: 'Synthetic retained history',
  });
  await service.discontinueField(1, created.field.fieldId, { version: created.field.version });
  instant += RETIRE_AFTER_DAYS * 24 * 60 * 60 * 1000;

  const app = createApp({
    affiliationStore: store, referralStore: store,
    resolveIdentity: () => ({ userId: 1 }), nodeEnv: 'test',
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.goto(`${base}/program-management/fields.html?programId=3`);
    const field = created.field;
    const retire = panel(page, field).getByRole('button', { name: 'Retire field', exact: true });
    await expect(retire).toBeEnabled();
    page.once('dialog', (dialog) => dialog.accept());
    await retire.click();
    await expect(page.locator('#field-status')).toHaveText('Field retired. Historical values are preserved.');
    await expect(page.locator(`#value-${field.fieldId}`)).toHaveValue('Synthetic retained history');
    await expect(panel(page, field).getByRole('button', { name: 'Save field value' })).toBeDisabled();
    await expect(panel(page, field).getByRole('button', { name: /^(Reactivate|Discontinue) field$/ })).toBeDisabled();

    const result = await service.listProgramFields(1, 3);
    const retired = result.fields.find((row) => row.fieldId === field.fieldId);
    expect(retired.lifecycleStatus).toBe('RETIRED');
    expect(retired.value).toBe('Synthetic retained history');
    await page.reload();
    await expect(page.locator(`#value-${field.fieldId}`)).toHaveValue('Synthetic retained history');
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await expectNoAxeViolations(page, `retired field history, ${colorScheme}`);
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
