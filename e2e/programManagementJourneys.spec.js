// Card 52: Program Management browser journeys (reviews card 14, PR #32).
//
// The card 14 specs (fieldValues, organization, programManagement,
// matchingManagement) cover each screen's main path. This file adds the
// journeys they leave out, one block per area named on the card: fields,
// options, reuse, replacement, retirement, Departments, creation, moves.
// Mostly the "something went wrong" paths: missing or duplicate input,
// a page that went stale, a cancelled confirmation, a lost connection,
// and the rules for what may be reused, replaced, retired or moved.
//
// Final Technical PRD 3.6, 4.1 to 4.4, 9.1, 12.4, 13.4, 14.2, 14.3, 14.5.
// SYNTHETIC data only. Every test makes its own fields, Departments and
// Programs (names carry a per-run tag) so tests do not depend on each
// other or on the order the spec files run in.

import { test, expect } from '@playwright/test';
import { ensureAffiliation, expectNoAxeViolations, focused } from './helpers.js';

const RUN = Date.now().toString(36);
const api = '/api/program-management';

// ---------- shared helpers ----------

async function createField(request, programId, dataType, label, options) {
  const data = { label: `${label} ${RUN}`, dataType };
  if (dataType.includes('SELECT')) data.options = options ?? ['First', 'Second'];
  const response = await request.post(`${api}/programs/${programId}/fields`, { data });
  expect(response.status(), `create field "${label}"`).toBe(201);
  return (await response.json()).field;
}
async function fieldsOf(request, programId) {
  const response = await request.get(`${api}/programs/${programId}/fields`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).fields;
}
async function fieldOf(request, programId, fieldId) {
  return (await fieldsOf(request, programId)).find((row) => row.fieldId === fieldId);
}
async function setValue(request, programId, fieldId, value) {
  const current = await fieldOf(request, programId, fieldId);
  const response = await request.put(`${api}/programs/${programId}/field-values/${fieldId}`, {
    data: { version: current.applicability.version, value },
  });
  expect(response.ok(), 'set field value').toBeTruthy();
}
async function discontinueField(request, programId, fieldId) {
  const current = await fieldOf(request, programId, fieldId);
  const response = await request.post(`${api}/fields/${fieldId}/discontinue`, { data: { version: current.version } });
  expect(response.ok(), 'discontinue field').toBeTruthy();
}
async function departments(request) {
  const response = await request.get(`${api}/departments`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).departments;
}
async function createDepartment(request, name) {
  const response = await request.post(`${api}/departments`, { data: { name: `${name} ${RUN}` } });
  expect(response.status(), `create Department "${name}"`).toBe(201);
  return (await response.json()).department;
}
async function departmentAction(request, departmentId, action) {
  const current = (await departments(request)).find((row) => row.departmentId === departmentId);
  const response = await request.post(`${api}/departments/${departmentId}/${action}`, { data: { version: current.version } });
  expect(response.ok(), `${action} Department`).toBeTruthy();
}
async function orgPrograms(request) {
  const response = await request.get(`${api}/organization-programs`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).programs;
}
async function createProgram(request, name, departmentId, site = 'Synthetic journey site') {
  const response = await request.post(`${api}/programs`, { data: { name: `${name} ${RUN}`, departmentId, site } });
  expect(response.status(), `create Program "${name}"`).toBe(201);
  return (await response.json()).program;
}

// A field's panel on the Program fields screen, found by its heading.
function fieldPanel(page, label) {
  return page.locator('section.panel').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
}
function departmentPanel(page, departmentId) {
  return page.locator('section.panel').filter({ has: page.locator(`#department-name-${departmentId}`) });
}

// Records every request that would change something (anything but GET)
// under `pathPart`, so a test can prove that nothing was sent.
function watchChanges(page, pathPart) {
  const sent = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes(pathPart)) sent.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return sent;
}

// Presses Tab until the button with this exact text has focus.
async function tabToButton(page, name, max = 80) {
  for (let i = 0; i < max; i += 1) {
    const text = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName === 'BUTTON' ? el.textContent.trim() : null;
    });
    if (text === name) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`could not reach the "${name}" button by keyboard`);
}
async function tabToId(page, id, max = 80) {
  for (let i = 0; i < max; i += 1) {
    if ((await focused(page)) === id) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`could not reach #${id} by keyboard`);
}

// Starts a second, private copy of the app on its own store and clock.
// Used only where the shared synthetic server cannot reach a state, such
// as a field that has finished its 90-day review period.
async function privateApp(store) {
  const { createApp } = await import('../src/app.js');
  const app = createApp({ affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId: 1 }), nodeEnv: 'test' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

// ---------- fields ----------

test.describe('fields', () => {
  test('creating a field: a missing label, missing options or a bad order sends nothing and focuses the problem', async ({ page }) => {
    const sent = watchChanges(page, `${api}/programs/3/fields`);
    await page.goto('/program-management/fields.html?programId=3');
    await expect(page.locator('#create-field-panel')).toBeVisible();
    const status = page.locator('#field-status');
    const create = page.getByRole('button', { name: 'Create field', exact: true });

    await create.click();
    await expect(status).toHaveText('Check the new field label, options, and display order.');
    expect(await focused(page)).toBe('new-field-label');

    await page.locator('#new-field-label').fill(`Synthetic choice field ${RUN}`);
    await page.locator('#new-field-type').selectOption('SINGLE_SELECT');
    await expect(page.locator('#new-options-group')).toBeVisible();
    await create.click();
    expect(await focused(page)).toBe('new-field-options');

    await page.locator('#new-field-options').fill('Mornings\nEvenings');
    await page.locator('#new-field-order').fill('20000');
    await create.click();
    expect(await focused(page)).toBe('new-field-order');
    expect(sent, 'nothing is sent while the form is invalid').toEqual([]);

    await page.locator('#new-field-order').fill('5');
    await create.click();
    await expect(status).toHaveText('Field created. You can now enter its value.');
    expect(sent).toHaveLength(1);
    await expect(page.getByRole('heading', { name: `Synthetic choice field ${RUN}`, exact: true })).toBeVisible();
  });

  test('keyboard only: create a field and save its value; Enter in a one-line box never submits', async ({ page, request }) => {
    const sent = watchChanges(page, `${api}/programs/3/`);
    await page.goto('/program-management/fields.html?programId=3');
    await expect(page.locator('#field-status')).not.toHaveText('Loading fields...');

    await page.locator('#new-field-label').focus();
    await page.keyboard.type(`Synthetic keyboard field ${RUN}`);
    await page.keyboard.press('Enter');
    expect(sent, 'Enter in the label created a field').toEqual([]);
    await tabToButton(page, 'Create field');
    await page.keyboard.press('Enter');
    await expect(page.locator('#field-status')).toHaveText('Field created. You can now enter its value.');

    const field = (await fieldsOf(request, 3)).find((row) => row.label === `Synthetic keyboard field ${RUN}`);
    await page.locator(`#value-${field.fieldId}`).focus();
    await page.keyboard.type('Synthetic typed value');
    await page.keyboard.press('Enter');
    expect(sent.filter((s) => s.startsWith('PUT')), 'Enter in the value box saved it').toEqual([]);
    await tabToButton(page, 'Save field value');
    await page.keyboard.press('Enter');
    await expect(page.locator('#field-status')).toHaveText('Field value saved.');
    expect((await fieldOf(request, 3, field.fieldId)).value).toBe('Synthetic typed value');
  });

  test('a required field cannot be saved empty, and the typed state stays', async ({ page, request }) => {
    const created = await request.post(`${api}/programs/3/fields`, {
      data: { label: `Synthetic required ${RUN}`, dataType: 'TEXT', isRequired: true },
    });
    expect(created.status()).toBe(201);
    const field = (await created.json()).field;
    await setValue(request, 3, field.fieldId, 'Synthetic saved answer');

    await page.goto('/program-management/fields.html?programId=3');
    const control = page.locator(`#value-${field.fieldId}`);
    await expect(control).toHaveValue('Synthetic saved answer');
    await expect(control).toHaveAttribute('aria-required', 'true');
    await control.fill('');
    await fieldPanel(page, field.label).getByRole('button', { name: 'Save field value' }).click();
    await expect(page.locator('#field-status')).toContainText('Nothing was saved.');
    await expect(control).toHaveValue('');
    expect((await fieldOf(request, 3, field.fieldId)).value).toBe('Synthetic saved answer');
  });

  test('cancelling a confirmation changes nothing', async ({ page, request }) => {
    const field = await createField(request, 3, 'SINGLE_SELECT', 'Synthetic cancel');
    const sent = watchChanges(page, `${api}/fields/${field.fieldId}`);
    await page.goto('/program-management/fields.html?programId=3');
    const panel = fieldPanel(page, field.label);

    const wording = panel.getByLabel('Field wording', { exact: true });
    await wording.fill(`Synthetic cancel renamed ${RUN}`);
    page.once('dialog', (dialog) => dialog.dismiss());
    await panel.getByRole('button', { name: 'Rename field', exact: true }).click();
    await expect(wording, 'Cancel keeps the typed wording').toHaveValue(`Synthetic cancel renamed ${RUN}`);
    await wording.fill(field.label); // undo the edit so the next actions are allowed

    page.once('dialog', (dialog) => dialog.dismiss());
    await panel.getByRole('button', { name: 'Discontinue field', exact: true }).click();
    page.once('dialog', (dialog) => dialog.dismiss());
    await panel.getByRole('button', { name: 'Discontinue option', exact: true }).first().click();

    expect(sent).toEqual([]);
    const stored = await fieldOf(request, 3, field.fieldId);
    expect(stored.label).toBe(field.label);
    expect(stored.lifecycleStatus).toBe('ACTIVE');
    expect(stored.options.every((o) => o.lifecycleStatus === 'ACTIVE')).toBe(true);
  });
});

// ---------- options ----------

test.describe('options', () => {
  test('a choice field always keeps at least one active option', async ({ page, request }) => {
    const field = await createField(request, 3, 'SINGLE_SELECT', 'Synthetic one option', ['Only choice']);
    await page.goto('/program-management/fields.html?programId=3');
    const panel = fieldPanel(page, field.label);
    page.once('dialog', (dialog) => dialog.accept());
    await panel.getByRole('button', { name: 'Discontinue option', exact: true }).click();
    await expect(page.locator('#field-status')).toHaveClass(/status--error/);
    const stored = await fieldOf(request, 3, field.fieldId);
    expect(stored.options).toHaveLength(1);
    expect(stored.options[0].lifecycleStatus).toBe('ACTIVE');
  });

  test('a duplicate option (any letter case) is refused and nothing is added', async ({ page, request }) => {
    const field = await createField(request, 3, 'MULTI_SELECT', 'Synthetic duplicate option');
    await page.goto('/program-management/fields.html?programId=3');
    const panel = fieldPanel(page, field.label);
    await page.locator(`#new-option-${field.fieldId}`).fill('first');
    page.once('dialog', (dialog) => dialog.accept());
    await panel.getByRole('button', { name: 'Add option', exact: true }).click();
    await expect(page.locator('#field-status')).toHaveClass(/status--error/);
    await expect(page.locator(`#new-option-${field.fieldId}`)).toHaveValue('first');
    expect((await fieldOf(request, 3, field.fieldId)).options.map((o) => o.label)).toEqual(['First', 'Second']);
  });

  test('an empty option label sends nothing and focuses the box', async ({ page, request }) => {
    const field = await createField(request, 3, 'SINGLE_SELECT', 'Synthetic empty option');
    const sent = watchChanges(page, `${api}/fields/${field.fieldId}/options`);
    await page.goto('/program-management/fields.html?programId=3');
    await fieldPanel(page, field.label).getByRole('button', { name: 'Add option', exact: true }).click();
    await expect(page.locator('#field-status')).toHaveText('Enter an option label.');
    expect(await focused(page)).toBe(`new-option-${field.fieldId}`);
    expect(sent).toEqual([]);
  });

  test('a discontinued choice stays on a saved answer but cannot be picked again', async ({ page, request }) => {
    const field = await createField(request, 3, 'SINGLE_SELECT', 'Synthetic retiring choice');
    const [first, second] = field.options;
    await setValue(request, 3, field.fieldId, first.optionId);
    const discontinued = await request.post(`${api}/fields/${field.fieldId}/options/${first.optionId}/discontinue`, {
      data: { version: first.version },
    });
    expect(discontinued.ok()).toBeTruthy();

    await page.goto('/program-management/fields.html?programId=3');
    const control = page.locator(`#value-${field.fieldId}`);
    await expect(control).toHaveValue(String(first.optionId));
    const kept = control.locator(`option[value="${first.optionId}"]`);
    await expect(kept).toHaveText('First (discontinued)');
    await expect(kept).toBeDisabled();

    await control.selectOption(String(second.optionId));
    await fieldPanel(page, field.label).getByRole('button', { name: 'Save field value' }).click();
    await expect(page.locator('#field-status')).toHaveText('Field value saved.');
    await page.reload();
    await expect(control).toHaveValue(String(second.optionId));
    await expect(control.locator(`option[value="${first.optionId}"]`), 'gone once no saved answer uses it').toHaveCount(0);
  });
});

// ---------- reuse ----------

test.describe('reuse', () => {
  test('only active fields the Program does not already use are offered; a reused field drops off the list', async ({ page, request }) => {
    const offered = await createField(request, 3, 'TEXT', 'Synthetic reusable');
    const discontinued = await createField(request, 3, 'TEXT', 'Synthetic discontinued');
    await discontinueField(request, 3, discontinued.fieldId);
    const alreadyUsed = await createField(request, 3, 'TEXT', 'Synthetic already shared');
    const shared = await request.post(`${api}/programs/7/field-applicability/${alreadyUsed.fieldId}`, {
      data: { isRequired: false, displayOrder: 0 },
    });
    expect(shared.status()).toBe(201);

    await page.goto('/program-management/reuse-field.html?programId=7');
    await expect(page.locator('#reuse-status')).toContainText('Available fields loaded.');
    const chooser = page.locator('#reuse-field');
    await expect(chooser.locator(`option[value="${offered.fieldId}"]`)).toHaveCount(1);
    await expect(chooser.locator(`option[value="${discontinued.fieldId}"]`)).toHaveCount(0);
    await expect(chooser.locator(`option[value="${alreadyUsed.fieldId}"]`)).toHaveCount(0);

    await chooser.selectOption(String(offered.fieldId));
    await expect(page.locator('#reuse-preview')).toContainText(offered.label);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Use this field', exact: true }).click();
    await expect(page.locator('#reuse-status')).toContainText('Field added to this Program.');
    await expect(page.getByRole('button', { name: 'Use this field', exact: true })).toBeDisabled();
    await page.locator('#reload-reuse').click();
    await expect(page.locator('#reuse-status')).not.toHaveText('Loading available fields...');
    await expect(chooser.locator(`option[value="${offered.fieldId}"]`)).toHaveCount(0);
  });

  test('no field chosen: nothing is sent and focus goes to the chooser', async ({ page, request }) => {
    await createField(request, 3, 'TEXT', 'Synthetic reuse choice'); // so there is something to choose
    const sent = watchChanges(page, `${api}/programs/7/field-applicability`);
    await page.goto('/program-management/reuse-field.html?programId=7');
    await expect(page.getByRole('button', { name: 'Use this field', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Use this field', exact: true }).click();
    await expect(page.locator('#reuse-status')).toHaveText('Choose a field and a whole display order from 0 to 10000.');
    expect(await focused(page)).toBe('reuse-field');
    expect(sent).toEqual([]);
  });

  test('a lost connection blocks a second try until reload, and nothing is duplicated', async ({ page, request }) => {
    const field = await createField(request, 3, 'TEXT', 'Synthetic uncertain reuse');
    await page.goto('/program-management/reuse-field.html?programId=7');
    await page.locator('#reuse-field').selectOption(String(field.fieldId));
    const url = `**${api}/programs/7/field-applicability/${field.fieldId}`;
    await page.route(url, (route) => route.abort());
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Use this field', exact: true }).click();
    await expect(page.locator('#reuse-status')).toContainText('the save outcome is uncertain');
    await expect(page.locator('#reuse-field')).toHaveValue(String(field.fieldId));
    await expect(page.getByRole('button', { name: 'Use this field', exact: true })).toBeDisabled();
    await page.unroute(url);

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#reload-reuse').click();
    await expect(page.getByRole('button', { name: 'Use this field', exact: true })).toBeEnabled();
    expect((await fieldsOf(request, 7)).some((row) => row.fieldId === field.fieldId)).toBe(false);
  });
});

// ---------- replacement ----------

test.describe('replacement', () => {
  test('replacing a shared field: each Program keeps its own old answer, and both get the same empty new field', async ({ page, request }) => {
    const field = await createField(request, 3, 'TEXT', 'Synthetic shared meaning');
    const shared = await request.post(`${api}/programs/7/field-applicability/${field.fieldId}`, {
      data: { isRequired: false, displayOrder: 0 },
    });
    expect(shared.status()).toBe(201);
    await setValue(request, 3, field.fieldId, 'Synthetic answer for Program 3');
    await setValue(request, 7, field.fieldId, 'Synthetic answer for Program 7');

    await page.goto(`/program-management/replace-field.html?programId=3&fieldId=${field.fieldId}`);
    await expect(page.getByRole('button', { name: 'Replace field', exact: true })).toBeEnabled();
    await page.locator('#replacement-label').fill(`Synthetic new meaning ${RUN}`);
    await page.locator('#replacement-type').selectOption('SINGLE_SELECT');
    await page.locator('#replacement-options').fill('Weekly\nMonthly');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Replace field', exact: true }).click();
    await expect(page.locator('#replacement-status')).toContainText('Field replaced.');

    for (const [programId, answer] of [[3, 'Synthetic answer for Program 3'], [7, 'Synthetic answer for Program 7']]) {
      const old = await fieldOf(request, programId, field.fieldId);
      expect(old.lifecycleStatus).toBe('DISCONTINUED');
      expect(old.value, `Program ${programId} keeps its own history`).toBe(answer);
      const replacement = await fieldOf(request, programId, old.replacedByFieldId);
      expect(replacement.label).toBe(`Synthetic new meaning ${RUN}`);
      expect(replacement.options.map((o) => o.label)).toEqual(['Weekly', 'Monthly']);
      expect(replacement.value).toBeNull();
    }

    // On the other Program's screen: the old answer is history, and a
    // replaced field cannot be brought back.
    await page.goto('/program-management/fields.html?programId=7');
    await expect(page.locator(`#value-${field.fieldId}`)).toHaveValue('Synthetic answer for Program 7');
    const oldPanel = fieldPanel(page, field.label);
    await expect(oldPanel.getByRole('button', { name: 'Save field value' })).toBeDisabled();
    await expect(oldPanel.getByRole('button', { name: 'Reactivate field', exact: true })).toBeDisabled();
  });

  test('replacement form: a missing label or missing choices sends nothing and focuses the problem', async ({ page, request }) => {
    const field = await createField(request, 3, 'TEXT', 'Synthetic replace check');
    const sent = watchChanges(page, `${api}/fields/${field.fieldId}/replace`);
    await page.goto(`/program-management/replace-field.html?programId=3&fieldId=${field.fieldId}`);
    await expect(page.getByRole('button', { name: 'Replace field', exact: true })).toBeEnabled();
    const replace = page.getByRole('button', { name: 'Replace field', exact: true });

    await replace.click();
    await expect(page.locator('#replacement-status')).toHaveText('Check the replacement label, type, and options.');
    expect(await focused(page)).toBe('replacement-label');
    await page.locator('#replacement-label').fill(`Synthetic replacement ${RUN}`);
    await page.locator('#replacement-type').selectOption('MULTI_SELECT');
    await replace.click();
    expect(await focused(page)).toBe('replacement-options');

    await page.locator('#replacement-options').fill('Yes\nNo');
    page.once('dialog', (dialog) => dialog.dismiss());
    await replace.click();
    expect(sent, 'nothing is sent while invalid or after Cancel').toEqual([]);
    expect((await fieldOf(request, 3, field.fieldId)).lifecycleStatus).toBe('ACTIVE');
  });

  test('a discontinued field cannot be replaced', async ({ page, request }) => {
    const field = await createField(request, 3, 'TEXT', 'Synthetic not replaceable');
    await discontinueField(request, 3, field.fieldId);
    await page.goto(`/program-management/replace-field.html?programId=3&fieldId=${field.fieldId}`);
    await expect(page.locator('#replacement-status')).toHaveText('Only an active field can be replaced.');
    await expect(page.getByRole('button', { name: 'Replace field', exact: true })).toBeDisabled();
  });
});

// ---------- retirement ----------

test.describe('retirement', () => {
  test('an active field has no Retire control; cancelling a retirement sends nothing', async ({ page, request }) => {
    const active = await createField(request, 3, 'TEXT', 'Synthetic still active');
    const discontinued = await createField(request, 3, 'TEXT', 'Synthetic retire cancel');
    await discontinueField(request, 3, discontinued.fieldId);
    const sent = watchChanges(page, '/retire');

    await page.goto('/program-management/fields.html?programId=3');
    await expect(fieldPanel(page, active.label).getByRole('button', { name: 'Retire field', exact: true })).toHaveCount(0);
    page.once('dialog', (dialog) => dialog.dismiss());
    await fieldPanel(page, discontinued.label).getByRole('button', { name: 'Retire field', exact: true }).click();
    expect(sent).toEqual([]);
    expect((await fieldOf(request, 3, discontinued.fieldId)).lifecycleStatus).toBe('DISCONTINUED');
  });

  test('a retired field is history only: no reuse, no replacement, no edits', async ({ page }) => {
    // A field only becomes retirable 90 days after it is discontinued, so
    // this test runs its own copy of the app with a clock it controls.
    const { createMemoryReferralStore } = await import('../src/referrals/memoryReferralStore.js');
    const { createFieldService, RETIRE_AFTER_DAYS } = await import('../src/programs/fieldService.js');
    let instant = Date.parse('2026-01-01T12:00:00.000Z');
    const store = createMemoryReferralStore({
      departments: [{ departmentId: 1, name: 'Synthetic Department', lifecycleStatus: 'ACTIVE' }],
      programs: [
        { programId: 1, departmentId: 1, name: 'Synthetic Program One', lifecycleStatus: 'ACTIVE' },
        { programId: 2, departmentId: 1, name: 'Synthetic Program Two', lifecycleStatus: 'ACTIVE' },
      ],
      users: [{ userId: 1, isActive: true }],
      grants: [
        ...[1, 2].map((programId) => ({ userId: 1, permission: 'MANAGE_PROGRAM', scopeType: 'PROGRAM', programId, departmentId: null, grantSource: 'IN_APP' })),
        { userId: 1, permission: 'MANAGE_ORGANIZATION', scopeType: 'ORG', programId: null, departmentId: null, grantSource: 'IN_APP' },
      ],
    }, { now: () => new Date(instant) });
    const service = createFieldService({ store });
    const { field } = await service.createField(1, 1, { label: 'Synthetic retired choice', dataType: 'SINGLE_SELECT', options: ['Yes', 'No'] });
    await service.setFieldValue(1, 1, field.fieldId, { version: field.applicability.version, value: field.options[0].optionId });
    await service.discontinueField(1, field.fieldId, { version: field.version });
    instant += RETIRE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    const current = (await service.listProgramFields(1, 1)).fields.find((row) => row.fieldId === field.fieldId);
    await service.retireField(1, field.fieldId, { version: current.version });

    const app = await privateApp(store);
    try {
      await page.goto(`${app.base}/program-management/fields.html?programId=1`);
      const panel = fieldPanel(page, field.label);
      await expect(page.locator(`#value-${field.fieldId}`)).toHaveValue(String(field.options[0].optionId));
      await expect(panel.getByText('This field is retired from operational use.')).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Save field value' })).toBeDisabled();
      await expect(panel.getByRole('button', { name: 'Rename field', exact: true })).toBeDisabled();
      await expect(panel.getByRole('button', { name: 'Add option', exact: true })).toBeDisabled();

      await page.goto(`${app.base}/program-management/reuse-field.html?programId=2`);
      await expect(page.locator('#reuse-status')).toHaveText('No unused active fields are available from your managed Programs.');
      await expect(page.locator(`#reuse-field option[value="${field.fieldId}"]`)).toHaveCount(0);

      await page.goto(`${app.base}/program-management/replace-field.html?programId=1&fieldId=${field.fieldId}`);
      await expect(page.getByRole('button', { name: 'Replace field', exact: true })).toBeDisabled();
    } finally {
      await app.close();
    }
  });
});

// ---------- Departments ----------

test.describe('Departments', () => {
  test('empty and duplicate names are refused, and the typed name stays', async ({ page, request }) => {
    const before = (await departments(request)).length;
    await page.goto('/program-management/organization.html');
    await expect(page.locator('#org-status')).toHaveText('Saved Departments loaded.');
    const create = page.getByRole('button', { name: 'Create Department', exact: true });

    await create.click();
    await expect(page.locator('#org-status')).toHaveText('Enter a Department name of up to 200 characters.');
    expect(await focused(page)).toBe('new-department-name');

    await page.locator('#new-department-name').fill('adult services (SAMPLE)');
    await create.click();
    await expect(page.locator('#org-status')).toHaveText('That Department name is already in use. Your entry remains.');
    await expect(page.locator('#new-department-name')).toHaveValue('adult services (SAMPLE)');
    expect((await departments(request)).length).toBe(before);
  });

  test('keyboard only: create a Department; Enter in the name box does not submit', async ({ page, request }) => {
    const sent = watchChanges(page, `${api}/departments`);
    await page.goto('/program-management/organization.html');
    await expect(page.locator('#org-status')).toHaveText('Saved Departments loaded.');
    await tabToId(page, 'new-department-name');
    await page.keyboard.type(`Synthetic keyboard Department ${RUN}`);
    await page.keyboard.press('Enter');
    expect(sent).toEqual([]);
    await tabToButton(page, 'Create Department');
    await page.keyboard.press('Enter');
    await expect(page.locator('#org-status')).toHaveText('Department created.');
    expect(await focused(page), 'the result is announced from the status box').toBe('org-status');
    expect((await departments(request)).some((row) => row.name === `Synthetic keyboard Department ${RUN}`)).toBe(true);
  });

  test('a rename on a stale page keeps the typed name and asks for a reload', async ({ page, request }) => {
    const department = await createDepartment(request, 'Synthetic stale Department');
    await page.goto('/program-management/organization.html');
    const name = page.locator(`#department-name-${department.departmentId}`);
    await name.fill(`Synthetic my rename ${RUN}`);

    // Someone else renames it first.
    const elsewhere = await request.patch(`${api}/departments/${department.departmentId}`, {
      data: { version: department.version, name: `Synthetic their rename ${RUN}` },
    });
    expect(elsewhere.ok()).toBeTruthy();

    page.once('dialog', (dialog) => dialog.accept());
    await departmentPanel(page, department.departmentId).getByRole('button', { name: 'Rename Department', exact: true }).click();
    await expect(page.locator('#org-status')).toContainText('Reload saved organization before continuing.');
    await expect(name).toHaveValue(`Synthetic my rename ${RUN}`);
    await expect(name).toBeDisabled();

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#reload-organization').click();
    await expect(page.locator(`#department-name-${department.departmentId}`)).toHaveValue(`Synthetic their rename ${RUN}`);
  });

  test('a lost connection on create blocks a second try until reload', async ({ page, request }) => {
    const before = (await departments(request)).length;
    await page.goto('/program-management/organization.html');
    await page.locator('#new-department-name').fill(`Synthetic uncertain Department ${RUN}`);
    const url = `**${api}/departments`;
    await page.route(url, (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
    await page.getByRole('button', { name: 'Create Department', exact: true }).click();
    await expect(page.locator('#org-status')).toContainText('Save outcome is not confirmed.');
    await expect(page.locator('#new-department-name')).toHaveValue(`Synthetic uncertain Department ${RUN}`);
    await expect(page.locator('#new-department-name')).toBeDisabled();
    await page.unroute(url);
    expect((await departments(request)).length).toBe(before);
  });

  test('a discontinued Department is not offered for new or moved Programs, and comes back when reactivated', async ({ page, request }) => {
    const department = await createDepartment(request, 'Synthetic paused Department');
    await departmentAction(request, department.departmentId, 'discontinue');
    const choice = (select) => page.locator(`${select} option[value="${department.departmentId}"]`);

    await page.goto('/program-management/organization-programs.html');
    await expect(page.locator('#program-org-status')).toHaveText('Saved organization loaded.');
    await expect(choice('#create-program-department')).toHaveCount(0);
    await expect(choice('#move-program-department')).toHaveCount(0);

    await departmentAction(request, department.departmentId, 'reactivate');
    await page.locator('#reload-program-organization').click();
    await expect(page.locator('#program-org-status')).toHaveText('Saved organization loaded.');
    await expect(choice('#create-program-department')).toHaveCount(1);
    await expect(choice('#move-program-department')).toHaveCount(1);
  });
});

// ---------- Program creation ----------

test.describe('Program creation', () => {
  test('nothing is sent until a name and an active Department are chosen, or after Cancel', async ({ page }) => {
    const sent = watchChanges(page, `${api}/programs`);
    await page.goto('/program-management/organization-programs.html');
    await expect(page.locator('#program-org-status')).toHaveText('Saved organization loaded.');
    const create = page.getByRole('button', { name: 'Create Program', exact: true });

    await create.click();
    await expect(page.locator('#program-org-status')).toHaveText('Check the required fields and text lengths.');
    expect(await focused(page)).toBe('create-program-name');
    await page.locator('#create-program-name').fill(`Synthetic needs a Department ${RUN}`);
    await create.click();
    expect(await focused(page)).toBe('create-program-department');

    await page.locator('#create-program-department').selectOption('2');
    page.once('dialog', (dialog) => dialog.dismiss());
    await create.click();
    expect(sent).toEqual([]);
  });

  test('the same name at the same site is refused; the same name at another site is allowed', async ({ page, request }) => {
    const name = `Synthetic twin ${RUN}`;
    await createProgram(request, 'Synthetic twin', 2, 'Synthetic site A');
    await page.goto('/program-management/organization-programs.html');
    await page.locator('#create-program-name').fill(name);
    await page.locator('#create-program-department').selectOption('2');
    await page.locator('#create-program-site').fill('Synthetic site A');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Create Program', exact: true }).click();
    await expect(page.locator('#program-org-status')).toHaveText('A Program already uses that name and site. Your entries remain.');
    await expect(page.locator('#create-program-name')).toHaveValue(name);

    await page.locator('#create-program-site').fill('Synthetic site B');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Create Program', exact: true }).click();
    await expect(page.locator('#program-org-status')).toContainText('Program created.');
    expect((await orgPrograms(request)).filter((row) => row.name === name).map((row) => row.site).sort())
      .toEqual(['Synthetic site A', 'Synthetic site B']);
  });

  test('a lost connection blocks a second try until reload, and no duplicate is made', async ({ page, request }) => {
    await page.goto('/program-management/organization-programs.html');
    await page.locator('#create-program-name').fill(`Synthetic uncertain Program ${RUN}`);
    await page.locator('#create-program-department').selectOption('2');
    const url = `**${api}/programs`;
    await page.route(url, (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Create Program', exact: true }).click();
    await expect(page.locator('#program-org-status')).toContainText('Save outcome is not confirmed.');
    await expect(page.locator('#create-program-name')).toHaveValue(`Synthetic uncertain Program ${RUN}`);
    await expect(page.getByRole('button', { name: 'Create Program', exact: true })).toBeDisabled();
    await page.unroute(url);
    expect((await orgPrograms(request)).some((row) => row.name === `Synthetic uncertain Program ${RUN}`)).toBe(false);
  });
});

// ---------- Program moves ----------

test.describe('Program moves', () => {
  test('choosing nothing, the same Department, or with edits in the other form changes nothing', async ({ page, request }) => {
    const program = await createProgram(request, 'Synthetic stay put', 2);
    const sent = watchChanges(page, `${api}/programs`);
    await page.goto('/program-management/organization-programs.html');
    await expect(page.locator('#program-org-status')).toHaveText('Saved organization loaded.');
    const move = page.getByRole('button', { name: 'Move Program', exact: true });

    await move.click();
    await expect(page.locator('#program-org-status')).toHaveText('Choose a Program first.');
    expect(await focused(page)).toBe('move-program');

    await page.locator('#create-program-name').fill('Synthetic unsaved entry');
    await page.locator('#move-program').selectOption(String(program.programId));
    await page.locator('#move-program-department').selectOption('2');
    await move.click();
    await expect(page.locator('#program-org-status')).toHaveText('Save or reload edits in the other form before continuing.');
    expect(sent).toEqual([]);

    await page.locator('#create-program-name').fill('');
    page.once('dialog', (dialog) => dialog.accept());
    await move.click();
    await expect(page.locator('#program-org-status')).toHaveText('The Program is already in that Department.');
    const current = (await orgPrograms(request)).find((row) => row.programId === program.programId);
    expect(current.departmentId).toBe(2);
    expect(current.version).toBe(program.version);
  });

  test('a Department discontinued after the page loaded is refused as a target', async ({ page, request }) => {
    const program = await createProgram(request, 'Synthetic mover', 2);
    const target = await createDepartment(request, 'Synthetic closing Department');
    await page.goto('/program-management/organization-programs.html');
    await page.locator('#move-program').selectOption(String(program.programId));
    await page.locator('#move-program-department').selectOption(String(target.departmentId));
    await departmentAction(request, target.departmentId, 'discontinue');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Move Program', exact: true }).click();
    await expect(page.locator('#program-org-status')).toContainText('The target Department is no longer active.');
    await expect(page.getByRole('button', { name: 'Move Program', exact: true })).toBeDisabled();
    expect((await orgPrograms(request)).find((row) => row.programId === program.programId).departmentId).toBe(2);
  });

  test('a move on a stale page keeps the choices and asks for a reload', async ({ page, request }) => {
    const program = await createProgram(request, 'Synthetic double move', 2);
    await page.goto('/program-management/organization-programs.html');
    await page.locator('#move-program').selectOption(String(program.programId));
    await page.locator('#move-program-department').selectOption('3');

    // Someone else moves it first.
    const elsewhere = await request.post(`${api}/programs/${program.programId}/move`, {
      data: { version: program.version, departmentId: 1 },
    });
    expect(elsewhere.ok()).toBeTruthy();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Move Program', exact: true }).click();
    await expect(page.locator('#program-org-status')).toContainText('Reload saved organization before continuing.');
    await expect(page.locator('#move-program-department')).toHaveValue('3');
    expect((await orgPrograms(request)).find((row) => row.programId === program.programId).departmentId).toBe(1);
  });

  test('referrals made before a move stay counted under the old Department; new ones go to the new one', async ({ page, request }) => {
    const program = await createProgram(request, 'Synthetic reporting move', 2);
    await page.goto('/program-management/organization-programs.html');
    await ensureAffiliation(page, 1);
    const refer = (n) => request.post('/api/referrals', {
      data: {
        submissionId: crypto.randomUUID(), receivingProgramId: program.programId,
        participantName: `Synthetic Person Move ${n}`, contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic need',
      },
    });
    const received = async (departmentId) => {
      const response = await request.get(`/api/reports/referral-activity?period=WEEKLY&departmentId=${departmentId}`);
      expect(response.ok()).toBeTruthy();
      return (await response.json()).programs.find((row) => row.programId === program.programId)?.received ?? 0;
    };
    expect((await refer(1)).status()).toBe(201);
    expect(await received(2)).toBe(1);

    await page.locator('#reload-program-organization').click();
    await page.locator('#move-program').selectOption(String(program.programId));
    await page.locator('#move-program-department').selectOption('3');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Move Program', exact: true }).click();
    await expect(page.locator('#program-org-status')).toContainText('Program moved.');

    expect((await refer(2)).status()).toBe(201);
    expect(await received(2), 'the earlier referral keeps its Department').toBe(1);
    expect(await received(3), 'only the referral made after the move').toBe(1);
  });
});

// ---------- every Program Management screen ----------

test.describe('text size and accessibility on every Program Management screen', () => {
  const screens = [
    ['Program fields', '/program-management/fields.html?programId=3', '#field-status'],
    ['field reuse', '/program-management/reuse-field.html?programId=7', '#reuse-status'],
    ['Departments', '/program-management/organization.html', '#org-status'],
    ['Program creation and moves', '/program-management/organization-programs.html', '#program-org-status'],
  ];
  for (const [name, path, status] of screens) {
    test(`${name}: XL text at phone width does not scroll sideways`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(path);
      await page.locator('[data-size="XL"]').click();
      await expect(page.locator(status)).not.toHaveText(/^Loading/);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('24px');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'pixels of sideways scroll').toBeLessThanOrEqual(0);
      await page.locator('[data-size="M"]').click();
    });
  }

  test('error states pass axe in both themes', async ({ page }) => {
    await page.goto('/program-management/organization.html');
    await page.getByRole('button', { name: 'Create Department', exact: true }).click();
    await page.goto('/program-management/organization-programs.html');
    await expect(page.locator('#program-org-status')).toHaveText('Saved organization loaded.');
    await page.getByRole('button', { name: 'Create Program', exact: true }).click();
    await expect(page.locator('#program-org-status')).toHaveClass(/status--error/);
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await expectNoAxeViolations(page, `Program creation error, ${colorScheme}`);
    }
    await page.goto('/program-management/fields.html?programId=3');
    await expect(page.locator('#create-field-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Create field', exact: true }).click();
    await expect(page.locator('#field-status')).toHaveClass(/status--error/);
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      await expectNoAxeViolations(page, `field creation error, ${colorScheme}`);
    }
  });
});
