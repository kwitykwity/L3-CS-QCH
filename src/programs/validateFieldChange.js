// Server-side validation for configurable Program fields, slice 14B
// (PRD 4.2, 4.3, 10.3, 10.4, 10.7).
//
// - Explicit allowlists per request; an unexpected property is reported
//   without its name.
// - Labels: 1 to 200 characters (field_definitions.label and
//   field_options.label are NVARCHAR(200)), one line, no control
//   characters, trimmed.
// - Data types match ck_field_definitions_type. SINGLE_SELECT and
//   MULTI_SELECT fields need at least one option; other types take none.
// - Only PROGRAM_INFO fields are created in this slice. REFERRAL_FORM
//   fields (extra referral-form questions) need referral-form support and
//   are refused until then (fail closed).

export const DATA_TYPES = Object.freeze(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SINGLE_SELECT', 'MULTI_SELECT']);
export const SELECT_TYPES = Object.freeze(['SINGLE_SELECT', 'MULTI_SELECT']);
export const LABEL_MAX = 200;
export const OPTIONS_MAX = 50;
export const DISPLAY_ORDER_MAX = 10000;
const VERSION_MAX = 64;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validVersion = (v) => typeof v === 'string' && v.length > 0 && v.length <= VERSION_MAX;
const validOrder = (v) => Number.isInteger(v) && v >= 0 && v <= DISPLAY_ORDER_MAX;

export function cleanLabel(value) {
  if (typeof value !== 'string' || value.length > LABEL_MAX) return undefined;
  const text = value.trim();
  if (text.length === 0 || CONTROL_CHARS.test(text)) return undefined;
  return text;
}

function shape(body, allowed) {
  if (!isPlainObject(body)) return { ok: false, fields: [] };
  if (Object.keys(body).some((k) => !allowed.includes(k))) return { ok: false, unexpectedField: true };
  return null;
}

function done(fields, value) {
  return fields.length > 0 ? { ok: false, fields } : { ok: true, value };
}

// Options for a new or replacement field. Returns cleaned labels or pushes
// 'options' into fields.
function readOptions(body, dataType, fields) {
  const isSelect = SELECT_TYPES.includes(dataType);
  if (body.options === undefined) {
    if (isSelect) fields.push('options');
    return [];
  }
  if (!isSelect || !Array.isArray(body.options) || body.options.length === 0 || body.options.length > OPTIONS_MAX) {
    fields.push('options');
    return [];
  }
  const labels = body.options.map(cleanLabel);
  const lower = labels.map((l) => l?.toLowerCase());
  if (labels.some((l) => l === undefined) || new Set(lower).size !== lower.length) {
    fields.push('options');
    return [];
  }
  return labels;
}

function readRequiredAndOrder(body, fields, value) {
  if (body.isRequired !== undefined) {
    if (typeof body.isRequired === 'boolean') value.isRequired = body.isRequired;
    else fields.push('isRequired');
  }
  if (body.displayOrder !== undefined) {
    if (validOrder(body.displayOrder)) value.displayOrder = body.displayOrder;
    else fields.push('displayOrder');
  }
}

// { label, dataType, options?, isRequired?, displayOrder? }
export function validateCreateField(body) {
  const bad = shape(body, ['label', 'dataType', 'options', 'isRequired', 'displayOrder']);
  if (bad) return bad;
  const fields = [];
  const label = cleanLabel(body.label);
  if (!label) fields.push('label');
  const dataType = DATA_TYPES.includes(body.dataType) ? body.dataType : undefined;
  if (!dataType) fields.push('dataType');
  const options = dataType ? readOptions(body, dataType, fields) : [];
  const value = { label, dataType, options, isRequired: false, displayOrder: 0 };
  readRequiredAndOrder(body, fields, value);
  return done(fields, value);
}

// Meaning change: { version, label, dataType, options? }
export function validateReplaceField(body) {
  const bad = shape(body, ['version', 'label', 'dataType', 'options']);
  if (bad) return bad;
  const fields = [];
  if (!validVersion(body.version)) fields.push('version');
  const label = cleanLabel(body.label);
  if (!label) fields.push('label');
  const dataType = DATA_TYPES.includes(body.dataType) ? body.dataType : undefined;
  if (!dataType) fields.push('dataType');
  const options = dataType ? readOptions(body, dataType, fields) : [];
  return done(fields, { version: body.version, label, dataType, options });
}

// Wording-only rename (field or option): { version, label }
export function validateRename(body) {
  const bad = shape(body, ['version', 'label']);
  if (bad) return bad;
  const fields = [];
  if (!validVersion(body.version)) fields.push('version');
  const label = cleanLabel(body.label);
  if (!label) fields.push('label');
  return done(fields, { version: body.version, label });
}

// Lifecycle actions: { version }
export function validateVersionOnly(body) {
  const bad = shape(body, ['version']);
  if (bad) return bad;
  return validVersion(body.version) ? { ok: true, value: { version: body.version } } : { ok: false, fields: ['version'] };
}

// New option: { label }
export function validateCreateOption(body) {
  const bad = shape(body, ['label']);
  if (bad) return bad;
  const label = cleanLabel(body.label);
  return label ? { ok: true, value: { label } } : { ok: false, fields: ['label'] };
}

// Use an existing field in a Program: { isRequired?, displayOrder? }
export function validateApplyField(body) {
  const bad = shape(body ?? {}, ['isRequired', 'displayOrder']);
  if (bad) return bad;
  const fields = [];
  const value = { isRequired: false, displayOrder: 0 };
  readRequiredAndOrder(body ?? {}, fields, value);
  return done(fields, value);
}

// Change required/order for a Program: { version, isRequired?, displayOrder? }
export function validateApplicabilityUpdate(body) {
  const bad = shape(body, ['version', 'isRequired', 'displayOrder']);
  if (bad) return bad;
  const fields = [];
  if (!validVersion(body.version)) fields.push('version');
  const value = { version: body.version };
  readRequiredAndOrder(body, fields, value);
  if (fields.length === 0 && value.isRequired === undefined && value.displayOrder === undefined) fields.push('changes');
  return done(fields, value);
}
