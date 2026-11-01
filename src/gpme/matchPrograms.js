// Guided Program Matching Engine (GPME), rule set v1
// (Final Technical PRD 8.1 to 8.10, 5.3, 2.1; GPME Decision Proposal,
// approved by the team Oct 18, 2026).
//
// A pure function: same inputs + same Program data + same rule version
// -> same result (PRD 8.4). No randomness, no clock, no I/O, no scores.
//
// It reads ONLY need categories, an age range, and a ZIP code. Notes,
// Referral Context, worker identity, and anything else are never read,
// even if a caller passes them (Handoff PRD: GPME matching inputs).
//
// For each active Program, each criterion gives PASS, FAIL, or NOT_CHECKED:
//   - Need: the Program offers at least one picked need category -> PASS.
//     Tagged, but none picked -> left out. No tags at all -> counted as
//     "not checked for need", never listed.
//   - Age: compared only when the Program's age state is SET.
//     Participant range fully inside -> PASS. No overlap -> FAIL.
//     Partial overlap, or no age range given -> NOT_CHECKED.
//   - Service area: compared only when the state is SET (ZIP list).
//     ZIP on the list -> PASS. Not on it -> FAIL. No ZIP -> NOT_CHECKED.
//   - NO_RESTRICTION -> PASS. NOT_ON_FILE and OTHER_LIMIT -> NOT_CHECKED.
// Any FAIL removes the Program. All PASS -> "plausible". Otherwise
// "possible". A FAIL always needs a limit on file AND a participant answer
// outside it, so missing information never removes a Program (PRD 8.10).
//
// Explanations come from Program facts only. They never repeat the
// participant's age range or ZIP (PRD 8.6). Order within a group is
// Department name, then Program name, then Program ID. Order never means
// "better match" (PRD 8.4).

import { readMatchingFacts } from './programFacts.js';

export const GPME_RULE_VERSION = 'gpme-v1';

export const MATCH_STATUS = Object.freeze({
  RESULTS: 'RESULTS',
  NO_PLAUSIBLE_MATCH: 'NO_PLAUSIBLE_MATCH',
  UNABLE_TO_MATCH: 'UNABLE_TO_MATCH',
});

const PASS = 'PASS';
const FAIL = 'FAIL';
const NOT_CHECKED = 'NOT_CHECKED';

// Plain code-unit comparison: the same order on every machine and locale.
function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function describeAgeLimit(min, max) {
  if (min !== null && max !== null) return `Serves ages ${min} to ${max}`;
  if (min !== null) return `Serves ages ${min} and up`;
  return `Serves ages up to ${max}`;
}

function checkAge(age, ageRange) {
  switch (age.state) {
    case 'NO_RESTRICTION':
      return { result: PASS, explanation: 'No age limit' };
    case 'OTHER_LIMIT':
      return { result: NOT_CHECKED, explanation: 'Has an age rule GPME does not check; see program details' };
    case 'SET': {
      const limit = describeAgeLimit(age.min, age.max);
      if (!ageRange) return { result: NOT_CHECKED, explanation: `${limit}; age range not provided` };
      const low = age.min ?? -Infinity;
      const high = age.max ?? Infinity;
      if (ageRange.max < low || ageRange.min > high) return { result: FAIL };
      if (ageRange.min >= low && ageRange.max <= high) return { result: PASS, explanation: limit };
      return { result: NOT_CHECKED, explanation: `${limit}; part of the age range given is outside this` };
    }
    default:
      return { result: NOT_CHECKED, explanation: 'Age limits not on file' };
  }
}

function checkServiceArea(area, participantZip) {
  switch (area.state) {
    case 'NO_RESTRICTION':
      return { result: PASS, explanation: 'No area limit' };
    case 'OTHER_LIMIT':
      return { result: NOT_CHECKED, explanation: 'Serves residents of a specific area; confirm with the program' };
    case 'SET':
      if (!participantZip) return { result: NOT_CHECKED, explanation: 'Serves listed ZIP codes; ZIP not provided' };
      return area.zips.has(participantZip)
        ? { result: PASS, explanation: 'Serves listed ZIP codes' }
        : { result: FAIL };
    default:
      return { result: NOT_CHECKED, explanation: 'Service area not on file' };
  }
}

function byDepartmentThenProgram(a, b) {
  return compareText(a.departmentName, b.departmentName)
    || compareText(a.name, b.name)
    || a.programId - b.programId;
}

// input:   { needCategoryIds: number[], ageRange: {min,max} | null,
//            participantZip: string | null }  (already validated)
// context: { candidates: [{ program, department }],
//            needCategories: [{ needCategoryId, name, lifecycleStatus }],
//            ruleVersion }
export function matchPrograms(input, { candidates, needCategories, ruleVersion = GPME_RULE_VERSION }) {
  // Read only the three approved inputs (Handoff PRD: GPME matching inputs).
  const picked = new Set(input.needCategoryIds);
  const ageRange = input.ageRange ?? null;
  const participantZip = input.participantZip ?? null;

  const activeCategoryNames = new Map(
    needCategories
      .filter((c) => c.lifecycleStatus === 'ACTIVE')
      .map((c) => [c.needCategoryId, c.name]),
  );

  const plausible = [];
  const possible = [];
  let notCheckedForNeedCount = 0;

  for (const { program, department } of candidates) {
    // Only ACTIVE Programs in ACTIVE Departments, even if a store sends more.
    if (program?.lifecycleStatus !== 'ACTIVE' || department?.lifecycleStatus !== 'ACTIVE') continue;

    const facts = readMatchingFacts(program);
    const offered = [...facts.needCategoryIds].filter((id) => activeCategoryNames.has(id));

    if (offered.length === 0) {
      notCheckedForNeedCount += 1;
      continue;
    }

    const matchedNames = offered
      .filter((id) => picked.has(id))
      .map((id) => activeCategoryNames.get(id))
      .sort(compareText);
    if (matchedNames.length === 0) continue;

    const checks = [
      { result: PASS, explanation: `Offers: ${matchedNames.join(', ')}` },
      checkAge(facts.age, ageRange),
      checkServiceArea(facts.area, participantZip),
    ];
    if (checks.some((c) => c.result === FAIL)) continue;

    const item = {
      programId: program.programId,
      name: program.name,
      site: program.site ?? null,
      departmentId: department.departmentId,
      departmentName: department.name,
      explanations: checks.map((c) => c.explanation),
    };
    (checks.every((c) => c.result === PASS) ? plausible : possible).push(item);
  }

  plausible.sort(byDepartmentThenProgram);
  possible.sort(byDepartmentThenProgram);

  return {
    status: plausible.length + possible.length > 0
      ? MATCH_STATUS.RESULTS
      : MATCH_STATUS.NO_PLAUSIBLE_MATCH,
    ruleVersion,
    plausible,
    possible,
    notCheckedForNeedCount,
  };
}
