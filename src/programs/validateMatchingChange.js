// Matching-fact maintenance: an explicit complete snapshot plus version.
// The backend validates category membership separately inside the transaction.
// Unknown information is never converted into confirmed no restriction.
//
// languageIds (Task W, language of service) is the one OPTIONAL fact: a
// body without it keeps the Program's saved languages. So a client written
// before Task W can never wipe them. When sent, it is the complete list;
// an empty list means "not on file". It is validated here, not in
// src/gpme/programFacts.js: the matching engine never reads language
// (rule gpme-v1; test/gpmeInterpretation.test.js keeps it that way).
import { findMatchingFactProblems } from '../gpme/programFacts.js';

export const MATCHING_FIELDS = Object.freeze([
  'needCategoryIds', 'ageLimitState', 'ageMin', 'ageMax',
  'serviceAreaState', 'serviceAreaZips',
]);
export const OPTIONAL_MATCHING_FIELDS = Object.freeze(['languageIds']);

export function matchingFactsOf(program) {
  return {
    needCategoryIds: [...(program.needCategoryIds ?? [])],
    ageLimitState: program.ageLimitState ?? 'NOT_ON_FILE',
    ageMin: program.ageMin ?? null,
    ageMax: program.ageMax ?? null,
    serviceAreaState: program.serviceAreaState ?? 'NOT_ON_FILE',
    serviceAreaZips: [...(program.serviceAreaZips ?? [])],
    languageIds: [...(program.languageIds ?? [])],
  };
}

export function validateMatchingChange(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, fields: [] };
  }
  const allowed = ['version', ...MATCHING_FIELDS, ...OPTIONAL_MATCHING_FIELDS];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    return { ok: false, unexpectedField: true };
  }
  const fields = [];
  if (typeof body.version !== 'string' || !body.version.length || body.version.length > 64) {
    fields.push('version');
  }
  for (const key of MATCHING_FIELDS) {
    if (!Object.hasOwn(body, key)) fields.push(key);
  }
  const facts = Object.fromEntries(MATCHING_FIELDS.map((key) => [key, body[key]]));
  const hasLanguages = Object.hasOwn(body, 'languageIds');
  if (hasLanguages) facts.languageIds = body.languageIds;
  const lists = ['needCategoryIds', 'serviceAreaZips', ...(hasLanguages ? ['languageIds'] : [])];
  for (const key of lists) {
    if (!Array.isArray(facts[key])) fields.push(key);
  }
  for (const key of ['ageLimitState', 'serviceAreaState']) {
    if (typeof facts[key] !== 'string') fields.push(key);
  }
  for (const key of ['ageMin', 'ageMax']) {
    if (facts[key] !== null && !Number.isInteger(facts[key])) fields.push(key);
  }
  fields.push(...findMatchingFactProblems(facts));
  if (hasLanguages && Array.isArray(facts.languageIds)
      && !facts.languageIds.every((id) => Number.isSafeInteger(id) && id > 0)) {
    fields.push('languageIds');
  }
  for (const key of lists) {
    if (Array.isArray(facts[key]) && new Set(facts[key]).size !== facts[key].length) {
      fields.push(key);
    }
  }
  if (fields.length) {
    return { ok: false, fields: [...new Set(fields)] };
  }
  return {
    ok: true,
    value: {
      version: body.version,
      facts: {
        ...facts,
        needCategoryIds: [...facts.needCategoryIds].sort((a, b) => a - b),
        serviceAreaZips: [...facts.serviceAreaZips].sort(),
        ...(hasLanguages ? { languageIds: [...facts.languageIds].sort((a, b) => a - b) } : {}),
      },
    },
  };
}
