// Server-side check of a replaceable interpreter's COMPLETE output, before
// anything from it reaches the worker's screen or GPME (Task D; Handoff PRD:
// Find a Program interpretation, GPME matching inputs; PRD 10.3, 15.4).
//
// An interpreter may be swapped for another implementation, so its output is
// untrusted. Only these shapes cross the boundary:
//   - need category ids that are in the current ACTIVE set
//   - an age range of whole numbers, 0 to 120, min <= max
//   - a five-digit ZIP
//   - note codes from the fixed NOTES list
//   - short vocabulary terms per proposed need (never prose)
//   - a short plain version label
// Anything else (an unknown key, an inactive or unknown id, a sentence in a
// field, a wrong type) makes the whole output unusable: the caller treats it
// as a technical failure instead of passing along part of it. Nothing here
// reads or returns the worker's text.

import { NOTES } from './ruleBasedInterpreter.js';

const ALLOWED_KEYS = new Set(['needCategoryIds', 'reasons', 'ageRange', 'participantZip', 'notes']);
const NOTE_CODES = new Set(Object.values(NOTES));
const MAX_AGE = 120;
const ZIP = /^\d{5}$/;
const VERSION = /^[A-Za-z0-9._-]{1,64}$/;
// A vocabulary term: a few lowercase words, not a sentence.
const TERM = /^[a-z0-9/-]{1,30}(?: [a-z0-9/-]{1,30}){0,2}$/;
const MAX_TERMS_PER_NEED = 10;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map);

export function validateInterpreterVersion(version) {
  return typeof version === 'string' && VERSION.test(version);
}

// activeIds: Set of currently ACTIVE needCategoryIds.
// Returns { ok: true, value: { needCategoryIds, reasons, ageRange, participantZip, notes } } or { ok: false }.
export function validateInterpretation(output, activeIds) {
  if (!isPlainObject(output)) return { ok: false };
  if (Object.keys(output).some((key) => !ALLOWED_KEYS.has(key))) return { ok: false };

  const ids = output.needCategoryIds;
  if (!Array.isArray(ids) || ids.length > activeIds.size) return { ok: false };
  if (!ids.every((id) => Number.isSafeInteger(id) && activeIds.has(id))) return { ok: false };
  if (new Set(ids).size !== ids.length) return { ok: false };

  let ageRange = null;
  if (output.ageRange !== null && output.ageRange !== undefined) {
    const a = output.ageRange;
    if (!isPlainObject(a) || Object.keys(a).some((k) => k !== 'min' && k !== 'max')) return { ok: false };
    const valid = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_AGE;
    if (!valid(a.min) || !valid(a.max) || a.min > a.max) return { ok: false };
    ageRange = { min: a.min, max: a.max };
  }

  let participantZip = null;
  if (output.participantZip !== null && output.participantZip !== undefined) {
    if (typeof output.participantZip !== 'string' || !ZIP.test(output.participantZip)) return { ok: false };
    participantZip = output.participantZip;
  }

  const rawNotes = output.notes ?? [];
  if (!Array.isArray(rawNotes) || !rawNotes.every((n) => typeof n === 'string' && NOTE_CODES.has(n))) return { ok: false };
  const notes = [...new Set(rawNotes)].sort();

  const reasons = new Map();
  if (output.reasons !== undefined && output.reasons !== null) {
    if (!(output.reasons instanceof Map)) return { ok: false };
    for (const [id, terms] of output.reasons) {
      if (!ids.includes(id) || !Array.isArray(terms) || terms.length > MAX_TERMS_PER_NEED) return { ok: false };
      if (!terms.every((t) => typeof t === 'string' && TERM.test(t))) return { ok: false };
      reasons.set(id, [...terms]);
    }
  }

  return { ok: true, value: { needCategoryIds: [...ids], reasons, ageRange, participantZip, notes } };
}
