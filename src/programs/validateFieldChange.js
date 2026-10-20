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

// ----- Field values (program_field_values) ------------------------------

export const VALUE_TEXT_MAX = 2000;           // value_text NVARCHAR(2000)
const NUMBER_LIMIT = 1e14;                     // value_number DECIMAL(18,4)
const TEXT_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// { version, value }. `value` must be present; null clears it. The value
// itself is checked against the field's data type by parseFieldValue.
export function validateSetValue(body) {
  const bad = shape(body, ['version', 'value']);
  if (bad) return bad;
  const fields = [];
  if (!validVersion(body.version)) fields.push('version');
  if (!('value' in body)) fields.push('value');
  return done(fields, { version: body.version, value: body.value });
}

// Turns a request value into stored value rows for the field's data type.
// Returns { ok: true, rows, optionIds } (rows = [] means "no value") or
// { ok: false }. Option IDs are returned for the caller to check against
// the field's options.
export function parseFieldValue(dataType, value) {
  if (value === null) return { ok: true, rows: [], optionIds: [] };
  switch (dataType) {
    case 'TEXT': {
      if (typeof value !== 'string' || value.length > VALUE_TEXT_MAX) return { ok: false };
      const text = value.trim();
      if (text.length === 0) return { ok: true, rows: [], optionIds: [] };
      if (TEXT_CONTROL.test(text)) return { ok: false };
      return { ok: true, rows: [{ valueText: text }], optionIds: [] };
    }
    case 'NUMBER': {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) >= NUMBER_LIMIT) return { ok: false };
      // At most 4 decimal places, counted from the shortest decimal text of
      // the number (multiplying by 10^4 is not exact for large values).
      const digits = String(Math.abs(value));
      if (digits.includes('e') || (digits.split('.')[1] ?? '').length > 4) return { ok: false };
      return { ok: true, rows: [{ valueNumber: value }], optionIds: [] };
    }
    case 'DATE': {
      const m = typeof value === 'string' ? DATE_PATTERN.exec(value) : null;
      if (!m) return { ok: false };
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const date = new Date(Date.UTC(y, mo - 1, d));
      if (y < 1900 || y > 2999 || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return { ok: false };
      return { ok: true, rows: [{ valueDate: value }], optionIds: [] };
    }
    case 'BOOLEAN':
      return typeof value === 'boolean' ? { ok: true, rows: [{ valueBool: value }], optionIds: [] } : { ok: false };
    case 'SINGLE_SELECT':
      return Number.isSafeInteger(value) && value > 0
        ? { ok: true, rows: [{ optionId: value }], optionIds: [value] }
        : { ok: false };
    case 'MULTI_SELECT': {
      if (!Array.isArray(value) || value.length > OPTIONS_MAX) return { ok: false };
      if (!value.every((id) => Number.isSafeInteger(id) && id > 0) || new Set(value).size !== value.length) return { ok: false };
      const ids = [...value].sort((a, b) => a - b);
      return { ok: true, rows: ids.map((optionId) => ({ optionId })), optionIds: ids };
    }
    default:
      return { ok: false };
  }
}

// The request/response shape of stored value rows for a data type.
export function valueFromRows(dataType, rows) {
  if (rows.length === 0) return dataType === 'MULTI_SELECT' ? [] : null;
  const first = rows[0];
  switch (dataType) {
    case 'TEXT': return first.valueText;
    case 'NUMBER': return first.valueNumber;
    case 'DATE': return first.valueDate;
    case 'BOOLEAN': return first.valueBool;
    case 'SINGLE_SELECT': return first.optionId;
    case 'MULTI_SELECT': return rows.map((r) => r.optionId).sort((a, b) => a - b);
    default: return null;
  }
}
