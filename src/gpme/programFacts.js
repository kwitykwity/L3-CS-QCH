// The Program facts GPME matches on, and the rules that keep them honest
// (Final Technical PRD 4.2, 8.2, 8.10; migration 003; GPME Decision
// Proposal, approved Oct 18, 2026).
//
// Each limit (age, service area) has one of four states:
//   SET             a limit is on file and GPME checks it
//   NO_RESTRICTION  confirmed: the Program has no such limit
//   NOT_ON_FILE     nobody has entered it yet (the default)
//   OTHER_LIMIT     a limit exists that these fields cannot express, such
//                   as one housing development, or an age rule about
//                   someone other than the participant (a child's age)
//
// Missing information is never treated as "no restriction" (PRD 8.10).
//
// Database mapping (migration 003):
//   ageLimitState     -> programs.age_limit_state
//   ageMin / ageMax   -> programs.age_min / programs.age_max
//   serviceAreaState  -> programs.service_area_state
//   serviceAreaZips   -> program_service_area_zips.zip_code
//   needCategoryIds   -> program_service_categories.service_category_id
//
// The database CHECKs the age rules. The service-area rule crosses two
// tables, so it is enforced here: SET needs at least one ZIP, every other
// state needs none.

export const LIMIT_STATES = Object.freeze(['SET', 'NO_RESTRICTION', 'NOT_ON_FILE', 'OTHER_LIMIT']);

const ZIP = /^\d{5}$/;
const MAX_STORED_AGE = 255; // TINYINT

function isAge(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_STORED_AGE;
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Returns the names of the rules a Program's matching facts break.
// Names only, never values. An empty list means the facts are valid.
export function findMatchingFactProblems(program) {
  const problems = [];
  const {
    ageLimitState = 'NOT_ON_FILE',
    ageMin = null,
    ageMax = null,
    serviceAreaState = 'NOT_ON_FILE',
    serviceAreaZips = [],
    needCategoryIds = [],
  } = program ?? {};

  if (!LIMIT_STATES.includes(ageLimitState)) {
    problems.push('ageLimitState');
  } else if (ageLimitState === 'SET') {
    const hasMin = ageMin !== null;
    const hasMax = ageMax !== null;
    if (!hasMin && !hasMax) problems.push('ageLimitState');
    if ((hasMin && !isAge(ageMin)) || (hasMax && !isAge(ageMax))) problems.push('ageRange');
    else if (hasMin && hasMax && ageMin > ageMax) problems.push('ageRange');
  } else if (ageMin !== null || ageMax !== null) {
    problems.push('ageLimitState');
  }

  if (!LIMIT_STATES.includes(serviceAreaState)) {
    problems.push('serviceAreaState');
  } else if (!Array.isArray(serviceAreaZips)) {
    problems.push('serviceAreaZips');
  } else {
    if (serviceAreaState === 'SET' && serviceAreaZips.length === 0) problems.push('serviceAreaState');
    if (serviceAreaState !== 'SET' && serviceAreaZips.length > 0) problems.push('serviceAreaState');
    if (serviceAreaZips.some((zip) => typeof zip !== 'string' || !ZIP.test(zip))) problems.push('serviceAreaZips');
  }

  if (!Array.isArray(needCategoryIds) || !needCategoryIds.every(isPositiveInteger)) {
    problems.push('needCategoryIds');
  }

  return problems;
}

// Reads a Program's matching facts for the engine. Fails safe: if a limit's
// facts are inconsistent (for example SET with no ZIP codes), that limit is
// read as NOT_ON_FILE, so bad data can only make a Program "possible",
// never remove it (PRD 8.10).
export function readMatchingFacts(program) {
  const problems = new Set(findMatchingFactProblems(program));

  const ageBad = problems.has('ageLimitState') || problems.has('ageRange');
  const age = ageBad
    ? { state: 'NOT_ON_FILE', min: null, max: null }
    : {
        state: program.ageLimitState ?? 'NOT_ON_FILE',
        min: program.ageMin ?? null,
        max: program.ageMax ?? null,
      };

  const areaBad = problems.has('serviceAreaState') || problems.has('serviceAreaZips');
  const area = areaBad
    ? { state: 'NOT_ON_FILE', zips: new Set() }
    : {
        state: program.serviceAreaState ?? 'NOT_ON_FILE',
        zips: new Set(program.serviceAreaZips ?? []),
      };

  const needCategoryIds = problems.has('needCategoryIds')
    ? new Set()
    : new Set(program.needCategoryIds ?? []);

  return { age, area, needCategoryIds };
}
