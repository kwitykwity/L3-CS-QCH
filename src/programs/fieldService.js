// Configurable Program fields, slice 14B (Final Technical PRD 3.6, 4.1,
// 4.2, 4.3, 9.1, 9.3, 9.4, 9.6, 10.5, 13.4).
//
// What a field is (PRD 4.2, 4.3; dbo.field_definitions, field_options,
// program_field_applicability):
// - A field's identity follows its MEANING. A wording-only change is a
//   rename: same fieldId. A meaning change is a replacement: the old field
//   is discontinued, a new field is created with replaced_by_field_id
//   pointing from old to new, and the new field is used by the same
//   Programs. Values collected under the old field stay with it.
// - Lifecycle: ACTIVE -> DISCONTINUED -> ACTIVE (reactivated), or, after
//   the review period, DISCONTINUED -> RETIRED. Discontinued fields stay
//   recoverable and visible in history. Retirement never deletes values.
// - A field is a shared definition; each Program that uses it has its own
//   applicability row (required or optional, display order).
//
// Authorization (PRD 3.6, capability + resource + scope), always read
// inside the transaction with locking reads, active user required:
// - Program-level actions (list, create a field for a Program, use an
//   existing field, change required/order): MANAGE_PROGRAM for THAT
//   Program.
// - Changes to a field's definition or options (rename, replace,
//   discontinue, reactivate, options): MANAGE_PROGRAM for EVERY Program
//   that uses the field. A shared field is never changed by the manager of
//   only one of its Programs. A field used by no Program can't be changed
//   here (fail closed).
// - Retire: MANAGE_ORGANIZATION at ORG scope (PRD 4.3), and only after the
//   field has been discontinued for RETIRE_AFTER_DAYS ("approximately
//   three months of review"; 90 days is a TEAM DECISION).
//
// Every change: one transaction; rows held for update (field, then option,
// then applicability rows by ascending programId); version check; audit
// events in the same transaction (PRD 9.6). A stale version gets
// FIELD_CHANGED / PROGRAM_CHANGED with the current row; nothing is written.

import {
  hasOrgScopeCapability,
  programIdsWithCapability,
} from '../authorization/referralAccess.js';
import { programErrors } from './errors.js';
import { MANAGE_PROGRAM } from './programService.js';
import {
  SELECT_TYPES,
  validateApplicabilityUpdate,
  validateApplyField,
  validateCreateField,
  validateCreateOption,
  validateRename,
  validateReplaceField,
  validateVersionOnly,
} from './validateFieldChange.js';

export const MANAGE_ORGANIZATION = 'MANAGE_ORGANIZATION';
export const RETIRE_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const APPLIES_TO = 'PROGRAM_INFO';

function throwInvalid(validation) {
  throw validation.unexpectedField
    ? programErrors.unexpectedField()
    : programErrors.invalidRequest(validation.fields);
}

function positiveInt(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function toFieldView(field, options) {
  return {
    fieldId: field.fieldId,
    label: field.label,
    dataType: field.dataType,
    appliesTo: field.appliesTo,
    lifecycleStatus: field.lifecycleStatus,
    replacedByFieldId: field.replacedByFieldId ?? null,
    discontinuedAt: field.discontinuedAt ?? null,
    retiredAt: field.retiredAt ?? null,
    version: field.version,
    options: options.map((o) => ({
      optionId: o.optionId,
      label: o.label,
      displayOrder: o.displayOrder,
      lifecycleStatus: o.lifecycleStatus,
      version: o.version,
    })),
  };
}

function toApplicabilityView(row) {
  return { programId: row.programId, isRequired: row.isRequired, displayOrder: row.displayOrder, version: row.version };
}

export function createFieldService({ store, allowDemoGrants = false }) {
  if (!store || typeof store.withTransaction !== 'function') {
    throw new Error('createFieldService requires a transactional store');
  }

  async function activeUserGrants(tx, userId) {
    if (!positiveInt(userId)) throw programErrors.notAuthenticated();
    const user = await tx.getUser(userId);
    if (!user || !user.isActive) throw programErrors.userNotActive();
    return tx.getActiveGrants(userId);
  }

  const managed = (grants) => programIdsWithCapability(grants, MANAGE_PROGRAM, { allowDemoGrants });

  // Program-level: active user + MANAGE_PROGRAM for this Program.
  async function authorizeProgram(tx, userId, programId) {
    if (!positiveInt(programId)) throw programErrors.programNotFound();
    const grants = await activeUserGrants(tx, userId);
    const program = await tx.getProgram(programId);
    if (!program) throw programErrors.programNotFound();
    if (!managed(grants).has(programId)) throw programErrors.notAuthorized();
    return { program, grants };
  }

  // Every action on an existing field refuses fields outside this slice
  // (appliesTo other than PROGRAM_INFO), after authorization, before any
  // write. applies_to never changes, so a plain read is enough to check it.
  function assertSupported(field) {
    if (field.appliesTo !== APPLIES_TO) throw programErrors.fieldNotSupported();
  }

  // Field-level: field held for update, and MANAGE_PROGRAM for every
  // Program that uses it.
  async function authorizeField(tx, userId, fieldId) {
    if (!positiveInt(fieldId)) throw programErrors.fieldNotFound();
    const grants = await activeUserGrants(tx, userId);
    const field = await tx.lockFieldForUpdate(fieldId);
    if (!field) throw programErrors.fieldNotFound();
    const usedBy = await tx.listFieldApplicability(fieldId);
    const mine = managed(grants);
    if (usedBy.length === 0 || !usedBy.every((a) => mine.has(a.programId))) throw programErrors.notAuthorized();
    assertSupported(field);
    return { field, usedBy, grants };
  }

  async function fieldView(tx, fieldId) {
    return toFieldView(await tx.getField(fieldId), await tx.listFieldOptions(fieldId));
  }

  async function staleField(tx, fieldId) {
    return programErrors.fieldChanged(await fieldView(tx, fieldId));
  }

  // Inserts a field, its options, and its use by each given Program, with
  // audit events. Returns the new field.
  async function insertFieldWithUse(tx, userId, { label, dataType, options }, uses, correlationId, replacesFieldId = null) {
    const field = await tx.insertField({ label, dataType, appliesTo: APPLIES_TO, lifecycleStatus: 'ACTIVE' });
    await tx.appendAuditEvent({
      entityType: 'FIELD',
      entityId: field.fieldId,
      action: 'CREATED',
      actorUserId: userId,
      before: null,
      after: { label, data_type: dataType, applies_to: APPLIES_TO, replaces_field_id: replacesFieldId },
      correlationId,
    });
    let order = 0;
    for (const optionLabel of options) {
      const option = await tx.insertOption({ fieldId: field.fieldId, label: optionLabel, displayOrder: order, lifecycleStatus: 'ACTIVE' });
      order += 1;
      await tx.appendAuditEvent({
        entityType: 'FIELD_OPTION',
        entityId: option.optionId,
        action: 'CREATED',
        actorUserId: userId,
        before: null,
        after: { field_id: field.fieldId, label: optionLabel, display_order: option.displayOrder },
        correlationId,
      });
    }
    for (const use of [...uses].sort((a, b) => a.programId - b.programId)) {
      const row = await tx.insertApplicability({ programId: use.programId, fieldId: field.fieldId, isRequired: use.isRequired, displayOrder: use.displayOrder });
      await tx.appendAuditEvent({
        entityType: 'PROGRAM_FIELD',
        entityId: use.programId,
        action: 'CREATED',
        actorUserId: userId,
        before: null,
        after: { field_id: field.fieldId, is_required: row.isRequired, display_order: row.displayOrder },
        correlationId,
      });
    }
    return field;
  }

  // ----- Program-level ---------------------------------------------------

  async function listProgramFields(userId, programId) {
    return store.withTransaction(async (tx) => {
      await authorizeProgram(tx, userId, programId);
      const uses = await tx.listProgramApplicability(programId);
      const fields = [];
      for (const use of uses) {
        // Only PROGRAM_INFO fields belong on the Program information screen.
        if ((await tx.getField(use.fieldId)).appliesTo !== APPLIES_TO) continue;
        fields.push({ ...(await fieldView(tx, use.fieldId)), applicability: toApplicabilityView(use) });
      }
      fields.sort((a, b) => a.applicability.displayOrder - b.applicability.displayOrder || a.fieldId - b.fieldId);
      return { programId, fields };
    });
  }

  async function createField(userId, programId, body, { correlationId = null } = {}) {
    const validation = validateCreateField(body);
    if (!validation.ok) throwInvalid(validation);
    const value = validation.value;
    return store.withTransaction(async (tx) => {
      const { program } = await authorizeProgram(tx, userId, programId);
      if (program.lifecycleStatus === 'RETIRED') throw programErrors.programRetired();
      const field = await insertFieldWithUse(tx, userId, value,
        [{ programId, isRequired: value.isRequired, displayOrder: value.displayOrder }], correlationId);
      const use = await tx.lockApplicabilityForUpdate(programId, field.fieldId);
      return { status: 'CREATED', field: { ...(await fieldView(tx, field.fieldId)), applicability: toApplicabilityView(use) } };
    });
  }

  async function applyField(userId, programId, fieldId, body, { correlationId = null } = {}) {
    const validation = validateApplyField(body);
    if (!validation.ok) throwInvalid(validation);
    const { isRequired, displayOrder } = validation.value;
    return store.withTransaction(async (tx) => {
      const { program } = await authorizeProgram(tx, userId, programId);
      if (program.lifecycleStatus === 'RETIRED') throw programErrors.programRetired();
      if (!positiveInt(fieldId)) throw programErrors.fieldNotFound();
      // Held so the set of Programs using the field can't change under a
      // concurrent field change.
      const field = await tx.lockFieldForUpdate(fieldId);
      if (!field) throw programErrors.fieldNotFound();
      assertSupported(field);
      if (field.lifecycleStatus !== 'ACTIVE') throw programErrors.fieldNotActive();
      const row = await tx.insertApplicability({ programId, fieldId, isRequired, displayOrder });
      if (!row) throw programErrors.alreadyApplied();
      await tx.appendAuditEvent({
        entityType: 'PROGRAM_FIELD',
        entityId: programId,
        action: 'CREATED',
        actorUserId: userId,
        before: null,
        after: { field_id: fieldId, is_required: isRequired, display_order: displayOrder },
        correlationId,
      });
      return { status: 'APPLIED', field: { ...(await fieldView(tx, fieldId)), applicability: toApplicabilityView(row) } };
    });
  }

  async function updateApplicability(userId, programId, fieldId, body, { correlationId = null } = {}) {
    const validation = validateApplicabilityUpdate(body);
    if (!validation.ok) throwInvalid(validation);
    const { version, ...changes } = validation.value;
    return store.withTransaction(async (tx) => {
      await authorizeProgram(tx, userId, programId);
      if (!positiveInt(fieldId)) throw programErrors.fieldNotFound();
      const use = await tx.lockApplicabilityForUpdate(programId, fieldId);
      if (!use) throw programErrors.fieldNotApplied();
      assertSupported(await tx.getField(fieldId));
      if (use.version !== version) throw programErrors.programChanged(toApplicabilityView(use));
      const set = {};
      const before = {};
      const after = {};
      if (changes.isRequired !== undefined && changes.isRequired !== use.isRequired) {
        set.isRequired = changes.isRequired; before.is_required = use.isRequired; after.is_required = changes.isRequired;
      }
      if (changes.displayOrder !== undefined && changes.displayOrder !== use.displayOrder) {
        set.displayOrder = changes.displayOrder; before.display_order = use.displayOrder; after.display_order = changes.displayOrder;
      }
      if (Object.keys(set).length === 0) throw programErrors.noChange();
      const updated = await tx.updateApplicability({ programId, fieldId, expectedVersion: version, set });
      if (!updated) throw programErrors.programChanged(toApplicabilityView(use));
      await tx.appendAuditEvent({
        entityType: 'PROGRAM_FIELD',
        entityId: programId,
        action: 'UPDATED',
        actorUserId: userId,
        before: { field_id: fieldId, ...before },
        after: { field_id: fieldId, ...after },
        correlationId,
      });
      return { status: 'UPDATED', applicability: toApplicabilityView(updated) };
    });
  }

  // ----- Field-level -----------------------------------------------------

  async function renameField(userId, fieldId, body, { correlationId = null } = {}) {
    const validation = validateRename(body);
    if (!validation.ok) throwInvalid(validation);
    const { version, label } = validation.value;
    return store.withTransaction(async (tx) => {
      const { field } = await authorizeField(tx, userId, fieldId);
      if (field.lifecycleStatus === 'RETIRED') throw programErrors.fieldRetired();
      if (field.version !== version) throw await staleField(tx, fieldId);
      if (field.label === label) throw programErrors.noChange();
      const updated = await tx.updateField({ fieldId, expectedVersion: version, set: { label } });
      if (!updated) throw await staleField(tx, fieldId);
      await tx.appendAuditEvent({
        entityType: 'FIELD',
        entityId: fieldId,
        action: 'RENAMED',
        actorUserId: userId,
        before: { label: field.label },
        after: { label },
        correlationId,
      });
      return { status: 'RENAMED', field: await fieldView(tx, fieldId) };
    });
  }

  async function replaceField(userId, fieldId, body, { correlationId = null } = {}) {
    const validation = validateReplaceField(body);
    if (!validation.ok) throwInvalid(validation);
    const { version, ...meaning } = validation.value;
    return store.withTransaction(async (tx) => {
      const { field, usedBy } = await authorizeField(tx, userId, fieldId);
      if (field.lifecycleStatus === 'RETIRED') throw programErrors.fieldRetired();
      if (field.version !== version) throw await staleField(tx, fieldId);
      if (field.lifecycleStatus !== 'ACTIVE') throw programErrors.fieldNotActive();

      const replacement = await insertFieldWithUse(tx, userId, meaning,
        usedBy.map((a) => ({ programId: a.programId, isRequired: a.isRequired, displayOrder: a.displayOrder })),
        correlationId, fieldId);

      const stamp = tx.now();
      const updated = await tx.updateField({
        fieldId,
        expectedVersion: version,
        set: { lifecycleStatus: 'DISCONTINUED', discontinuedAt: stamp, replacedByFieldId: replacement.fieldId },
      });
      if (!updated) throw await staleField(tx, fieldId);
      await tx.appendAuditEvent({
        entityType: 'FIELD',
        entityId: fieldId,
        action: 'REPLACED',
        actorUserId: userId,
        before: { lifecycle_status: 'ACTIVE', replaced_by_field_id: null },
        after: { lifecycle_status: 'DISCONTINUED', replaced_by_field_id: replacement.fieldId },
        correlationId,
      });
      return {
        status: 'REPLACED',
        field: await fieldView(tx, fieldId),
        replacement: await fieldView(tx, replacement.fieldId),
      };
    });
  }

  async function changeFieldLifecycle(userId, fieldId, body, action, { correlationId = null } = {}) {
    const validation = validateVersionOnly(body);
    if (!validation.ok) throwInvalid(validation);
    const { version } = validation.value;
    return store.withTransaction(async (tx) => {
      let field;
      if (action === 'RETIRED') {
        // Organization-level: MANAGE_ORGANIZATION at ORG scope (PRD 3.6, 4.3).
        if (!positiveInt(fieldId)) throw programErrors.fieldNotFound();
        const grants = await activeUserGrants(tx, userId);
        field = await tx.lockFieldForUpdate(fieldId);
        if (!field) throw programErrors.fieldNotFound();
        if (!hasOrgScopeCapability(grants, MANAGE_ORGANIZATION, { allowDemoGrants })) throw programErrors.notAuthorized();
        assertSupported(field);
      } else {
        ({ field } = await authorizeField(tx, userId, fieldId));
      }
      if (field.lifecycleStatus === 'RETIRED') throw programErrors.fieldRetired();
      if (field.version !== version) throw await staleField(tx, fieldId);

      let set;
      if (action === 'DISCONTINUED') {
        if (field.lifecycleStatus !== 'ACTIVE') throw programErrors.alreadyInStatus();
        set = { lifecycleStatus: 'DISCONTINUED', discontinuedAt: tx.now() };
      } else if (action === 'REACTIVATED') {
        if (field.lifecycleStatus !== 'DISCONTINUED') throw programErrors.alreadyInStatus();
        if (field.replacedByFieldId != null) throw programErrors.fieldReplaced();
        set = { lifecycleStatus: 'ACTIVE', discontinuedAt: null };
      } else {
        if (field.lifecycleStatus !== 'DISCONTINUED') throw programErrors.notDiscontinued();
        const discontinuedMs = Date.parse(field.discontinuedAt);
        if (!(Date.parse(tx.now()) - discontinuedMs >= RETIRE_AFTER_DAYS * DAY_MS)) throw programErrors.retireNotYet();
        set = { lifecycleStatus: 'RETIRED', retiredAt: tx.now() };
      }

      const updated = await tx.updateField({ fieldId, expectedVersion: version, set });
      if (!updated) throw await staleField(tx, fieldId);
      await tx.appendAuditEvent({
        entityType: 'FIELD',
        entityId: fieldId,
        action,
        actorUserId: userId,
        before: { lifecycle_status: field.lifecycleStatus },
        after: { lifecycle_status: set.lifecycleStatus },
        correlationId,
      });
      return { status: action, field: await fieldView(tx, fieldId) };
    });
  }

  // ----- Options -----------------------------------------------------------

  async function addOption(userId, fieldId, body, { correlationId = null } = {}) {
    const validation = validateCreateOption(body);
    if (!validation.ok) throwInvalid(validation);
    const { label } = validation.value;
    return store.withTransaction(async (tx) => {
      const { field } = await authorizeField(tx, userId, fieldId);
      if (field.lifecycleStatus !== 'ACTIVE') throw programErrors.fieldNotActive();
      if (!SELECT_TYPES.includes(field.dataType)) throw programErrors.optionsNotAllowed();
      const existing = await tx.listFieldOptions(fieldId);
      if (existing.some((o) => o.label.toLowerCase() === label.toLowerCase())) throw programErrors.duplicateOption();
      const displayOrder = existing.reduce((max, o) => Math.max(max, o.displayOrder + 1), 0);
      const option = await tx.insertOption({ fieldId, label, displayOrder, lifecycleStatus: 'ACTIVE' });
      await tx.appendAuditEvent({
        entityType: 'FIELD_OPTION',
        entityId: option.optionId,
        action: 'CREATED',
        actorUserId: userId,
        before: null,
        after: { field_id: fieldId, label, display_order: displayOrder },
        correlationId,
      });
      return { status: 'CREATED', field: await fieldView(tx, fieldId) };
    });
  }

  async function lockOwnOption(tx, fieldId, optionId) {
    if (!positiveInt(optionId)) throw programErrors.optionNotFound();
    const option = await tx.lockOptionForUpdate(optionId);
    if (!option || option.fieldId !== fieldId) throw programErrors.optionNotFound();
    return option;
  }

  async function renameOption(userId, fieldId, optionId, body, { correlationId = null } = {}) {
    const validation = validateRename(body);
    if (!validation.ok) throwInvalid(validation);
    const { version, label } = validation.value;
    return store.withTransaction(async (tx) => {
      const { field } = await authorizeField(tx, userId, fieldId);
      if (field.lifecycleStatus === 'RETIRED') throw programErrors.fieldRetired();
      const option = await lockOwnOption(tx, fieldId, optionId);
      if (option.version !== version) throw await staleField(tx, fieldId);
      if (option.label === label) throw programErrors.noChange();
      const others = (await tx.listFieldOptions(fieldId)).filter((o) => o.optionId !== optionId);
      if (others.some((o) => o.label.toLowerCase() === label.toLowerCase())) throw programErrors.duplicateOption();
      const updated = await tx.updateOption({ optionId, expectedVersion: version, set: { label } });
      if (!updated) throw await staleField(tx, fieldId);
      await tx.appendAuditEvent({
        entityType: 'FIELD_OPTION',
        entityId: optionId,
        action: 'RENAMED',
        actorUserId: userId,
        before: { label: option.label },
        after: { label },
        correlationId,
      });
      return { status: 'RENAMED', field: await fieldView(tx, fieldId) };
    });
  }

  async function changeOptionLifecycle(userId, fieldId, optionId, body, action, { correlationId = null } = {}) {
    const validation = validateVersionOnly(body);
    if (!validation.ok) throwInvalid(validation);
    const { version } = validation.value;
    return store.withTransaction(async (tx) => {
      const { field } = await authorizeField(tx, userId, fieldId);
      if (field.lifecycleStatus === 'RETIRED') throw programErrors.fieldRetired();
      const option = await lockOwnOption(tx, fieldId, optionId);
      if (option.version !== version) throw await staleField(tx, fieldId);
      const target = action === 'REACTIVATED' ? 'ACTIVE' : 'DISCONTINUED';
      if (option.lifecycleStatus === target) throw programErrors.alreadyInStatus();
      if (option.lifecycleStatus === 'RETIRED') throw programErrors.fieldRetired();
      if (target === 'ACTIVE' && field.lifecycleStatus !== 'ACTIVE') throw programErrors.fieldNotActive();
      if (target === 'DISCONTINUED' && field.lifecycleStatus === 'ACTIVE') {
        const active = (await tx.listFieldOptions(fieldId)).filter((o) => o.lifecycleStatus === 'ACTIVE');
        if (active.length <= 1) throw programErrors.lastActiveOption();
      }
      const updated = await tx.updateOption({ optionId, expectedVersion: version, set: { lifecycleStatus: target } });
      if (!updated) throw await staleField(tx, fieldId);
      await tx.appendAuditEvent({
        entityType: 'FIELD_OPTION',
        entityId: optionId,
        action,
        actorUserId: userId,
        before: { lifecycle_status: option.lifecycleStatus },
        after: { lifecycle_status: target },
        correlationId,
      });
      return { status: action, field: await fieldView(tx, fieldId) };
    });
  }

  return Object.freeze({
    listProgramFields,
    createField,
    applyField,
    updateApplicability,
    renameField,
    replaceField,
    discontinueField: (u, f, b, o) => changeFieldLifecycle(u, f, b, 'DISCONTINUED', o),
    reactivateField: (u, f, b, o) => changeFieldLifecycle(u, f, b, 'REACTIVATED', o),
    retireField: (u, f, b, o) => changeFieldLifecycle(u, f, b, 'RETIRED', o),
    addOption,
    renameOption,
    discontinueOption: (u, f, op, b, o) => changeOptionLifecycle(u, f, op, b, 'DISCONTINUED', o),
    reactivateOption: (u, f, op, b, o) => changeOptionLifecycle(u, f, op, b, 'REACTIVATED', o),
  });
}
