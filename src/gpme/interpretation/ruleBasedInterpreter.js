// Interpretation layer, in-application implementation v1: a controlled
// vocabulary plus simple pattern reading (Task D; Final Technical PRD 8.1,
// 8.2, 15.5, section 21 non-goals).
//
//   staff description -> interpreter -> proposed criteria -> staff confirm
//   or correct -> GPME (unchanged) -> possible Programs -> staff decision
//
// This is ONE way to fill the interpretation step. It is not a client
// requirement, and it is replaceable: createGpmeService accepts any object
// with the same shape,
//
//   { version: string,
//     interpret({ text, needCategories }) -> { needCategoryIds: number[],
//         reasons: Map<needCategoryId, string[]>,
//         ageRange: { min, max } | null,
//         participantZip: string | null,
//         notes: string[] }  }      (sync or async)
//
// and GPME never learns which implementation ran. The output is only a
// PROPOSAL: the worker sees it, corrects it, and confirms it before
// anything is matched. Only the three approved criteria (need categories,
// age range, ZIP) can ever come out of an interpreter (Handoff PRD: Find a
// Program interpretation; GPME matching inputs).
//
// No external service is called: it is a pure function over the text, the
// current need categories, and the tables below. The text is never stored,
// logged, or returned (PRD 5.3, 5.4, 15.3). Terms returned in `reasons` come
// from the vocabulary, never from the worker's text.

export const INTERPRETER_VERSION = 'interpret-rules-v2';

export const NOTES = Object.freeze({
  MULTIPLE_AGES: 'MULTIPLE_AGES',
  MULTIPLE_ZIPS: 'MULTIPLE_ZIPS',
  INVALID_AGE: 'INVALID_AGE',
  NOT_REQUESTED: 'NOT_REQUESTED',
});

// Everyday wording that points at a need category. Wording is attached to a
// category by its stable needCategoryId, never by matching its current name,
// so renaming a category in Program Management does not change what is
// recognized. A category with no attachment is recognized by the words of its
// current name only. The default attachments below cover the synthetic sample
// categories (scripts/syntheticSeed.js); attaching wording to QCH's real
// categories needs their ids from Program Management (a QCH decision), and is
// passed to createRuleBasedInterpreter({ attachments }).
export const DEFAULT_ATTACHMENTS = Object.freeze({
  1: ['childcare', 'daycare', 'day care', 'child care', 'babysitter', 'preschool', 'toddler'],
  2: ['education', 'school', 'class', 'classes', 'tutoring', 'homework', 'ged', 'esl', 'english', 'diploma'],
  3: ['employment', 'job', 'jobs', 'work', 'unemployed', 'resume', 'hiring', 'career', 'laid off'],
  4: ['housing', 'homeless', 'eviction', 'evicted', 'rent', 'landlord', 'apartment', 'lease', 'shelter'],
  5: ['older adult', 'older adults', 'senior', 'seniors', 'elderly', 'aging'],
});

// Words in a category name that say nothing about the need.
const NAME_STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'or', 'services', 'service', 'support',
  'program', 'programs', 'help', 'assistance', 'sample', 'general', 'other',
]);

const MAX_AGE = 120;

function normalize(text) {
  return ` ${String(text).toLowerCase().replace(/[^a-z0-9/\- ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

// Only a plain trailing s is folded, nothing cleverer, so the behavior
// stays easy to predict and to explain.
function stem(word) {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

function termsForCategory(category, attachments) {
  const attached = attachments[category.needCategoryId];
  if (Array.isArray(attached)) return [...new Set(attached)];
  const lowered = String(category.name).toLowerCase().replace(/\(.*?\)/g, ' ');
  return [...new Set(lowered.split(/[^a-z0-9]+/).filter((w) => w && !NAME_STOP_WORDS.has(w)))];
}

// Limited refusal safeguard (not a negation engine). Inside one clause, a
// small set of plain refusal phrases marks the next few words as "not
// requested", so "doesn't need housing" does not propose Housing. Passive
// uses ("was refused housing") are not refusals by the participant.
const REFUSAL_CUES = Object.freeze([
  ['no', 'need'], ['not', 'need'], ['not', 'needs'], ['doesnt', 'need'], ['dont', 'need'], ['didnt', 'need'],
  ['no', 'longer', 'need'], ['no', 'longer', 'needs'],
  ['not', 'want'], ['not', 'wants'], ['doesnt', 'want'], ['dont', 'want'],
  ['not', 'interested'], ['isnt', 'interested'], ['not', 'looking'], ['isnt', 'looking'],
  ['not', 'seeking'], ['not', 'requesting'], ['doesnt', 'require'], ['not', 'require'],
  ['declined'], ['declines'], ['declining'], ['refused'], ['refuses'], ['refusing'],
]);
const PASSIVE_BEFORE = new Set(['was', 'were', 'been', 'being', 'got', 'is', 'are']);
const REFUSAL_WINDOW = 4;

// Clause breaks: punctuation, and words that start a new statement.
const CLAUSE_BREAK = /[.;:!?\n,]|\b(?:but|however|although|though|except|instead|yet)\b|\band\s+(?=(?:also\s+)?(?:needs?|wants?|is looking|are looking|looking|seeking|requests?)\b)/gi;

function toClauses(text) {
  return String(text).replace(/['’]/g, '').split(CLAUSE_BREAK).map(normalize).filter((c) => c.trim());
}

function refusedWords(words) {
  const refused = new Array(words.length).fill(false);
  for (let i = 0; i < words.length; i += 1) {
    for (const cue of REFUSAL_CUES) {
      if (!cue.every((w, k) => words[i + k] === w)) continue;
      if (cue.length === 1 && PASSIVE_BEFORE.has(words[i - 1])) continue;
      const end = Math.min(words.length, i + cue.length + REFUSAL_WINDOW);
      for (let j = i + cue.length; j < end; j += 1) refused[j] = true;
    }
  }
  return refused;
}

// Word positions in the clause where the term occurs.
function termPositions(words, term) {
  const parts = term.split(' ');
  const out = [];
  for (let i = 0; i + parts.length <= words.length; i += 1) {
    if (parts.every((p, k) => words[i + k] === p || stem(words[i + k]) === stem(p))) out.push(i);
  }
  return out;
}

// A category is proposed when at least one of its terms is requested. If its
// terms appear only after a refusal, it is not proposed and `anyRefused` lets
// the worker know something was left out.
function readNeeds(text, needCategories, attachments) {
  const clauses = toClauses(text).map((c) => {
    const words = c.trim().split(' ');
    return { words, refused: refusedWords(words) };
  });
  const needCategoryIds = [];
  const reasons = new Map();
  let anyRefused = false;
  for (const category of needCategories) {
    if (category.lifecycleStatus !== 'ACTIVE') continue;
    const requested = [];
    let refusedHit = false;
    for (const term of termsForCategory(category, attachments)) {
      for (const { words, refused } of clauses) {
        for (const at of termPositions(words, term)) {
          if (refused[at]) refusedHit = true;
          else requested.push(term);
        }
      }
    }
    if (requested.length > 0) {
      needCategoryIds.push(category.needCategoryId);
      // One entry per word family ("job" and "jobs" are listed once).
      const byStem = new Map();
      for (const t of requested) if (!byStem.has(stem(t))) byStem.set(stem(t), t);
      reasons.set(category.needCategoryId, [...byStem.values()].sort());
    } else if (refusedHit) {
      anyRefused = true;
    }
  }
  needCategoryIds.sort((a, b) => a - b);
  return { needCategoryIds, reasons, anyRefused };
}

function inRange(n) {
  return Number.isInteger(n) && n >= 0 && n <= MAX_AGE;
}

// Ages are only read next to age wording ("17 year old", "age 17", "ages 18
// to 24"), so other numbers (a ZIP, "5 bags") are not mistaken for an age.
// No age is assumed from words such as "teen" or "elderly": the worker
// enters it. Two or more different ages ("ages 6 and 9", a parent and a
// child) are ambiguous, so none is proposed. "and" joins separate ages; it
// makes a range only after "between" ("between 6 and 9").
function readAge(paddedText, notes) {
  const found = [];

  // [pattern, kind]: 'range' captures min and max; 'list' captures several
  // separate ages; 'one' captures a single age. Earlier patterns win.
  const patterns = [
    [/\bbetween\s+(?:the\s+)?(?:ages?\s+)?(?:of\s+)?(\d{1,3})\s+and\s+(\d{1,3})\b/g, 'range'],
    // ages 18 to 24 / aged 18-24
    [/\bage[sd]?\s+(?:of\s+)?(\d{1,3})\s*(?:-|to|through)\s*(\d{1,3})\b/g, 'range'],
    // 18 to 24 years old / 18-24 yo
    [/\b(\d{1,3})\s*(?:-|to|through)\s*(\d{1,3})\s*(?:years?|yrs?|y\/o|yo)\b/g, 'range'],
    // ages 6 and 9 / ages 6 9 12
    [/\bage[sd]?\s+(\d{1,3}(?:\s+(?:and\s+|or\s+)?\d{1,3}\b)+)/g, 'list'],
    // 6 and 9 years old
    [/\b(\d{1,3}(?:\s+(?:and|or)\s+\d{1,3})+)\s*(?:years?|yrs?)[\s-]*old\b/g, 'list'],
    // 17 year old / 17-year-old
    [/\b(\d{1,3})[\s-]*(?:years?|yrs?)[\s-]*old\b/g, 'one'],
    // 17 yo / 17 y/o
    [/\b(\d{1,3})\s*(?:yo|y\/o)\b/g, 'one'],
    // age 17 / aged 17
    [/\bage[d]?\s+(\d{1,3})\b/g, 'one'],
  ];

  const consumed = [];
  for (const [pattern, kind] of patterns) {
    for (const m of paddedText.matchAll(pattern)) {
      const span = [m.index, m.index + m[0].length];
      if (consumed.some(([s, e]) => span[0] < e && span[1] > s)) continue;
      consumed.push(span);
      const ranges = kind === 'range'
        ? [[Number(m[1]), Number(m[2])]]
        : (kind === 'list' ? m[1].match(/\d+/g) : [m[1]]).map((n) => [Number(n), Number(n)]);
      // "ages 6 to 9 and 12": a number joined on after a range is one more age.
      if (kind === 'range') {
        const extra = /^(?:\s+old)?\s+(?:and|or)\s+(\d{1,3})\b(?!\s*(?:-|to|through))/.exec(paddedText.slice(span[1]));
        if (extra) {
          ranges.push([Number(extra[1]), Number(extra[1])]);
          consumed.push([span[1], span[1] + extra[0].length]);
        }
      }
      for (const [a, b] of ranges) {
        if (!inRange(a) || !inRange(b) || a > b) notes.add(NOTES.INVALID_AGE);
        else found.push({ min: a, max: b });
      }
    }
  }

  const distinct = new Map(found.map((r) => [`${r.min}-${r.max}`, r]));
  if (distinct.size > 1) {
    notes.add(NOTES.MULTIPLE_AGES);
    return null;
  }
  return distinct.size === 1 ? [...distinct.values()][0] : null;
}

// A ZIP is only read straight after ZIP wording ("ZIP 11101", "zip code is
// 11101"), so an unrelated five-digit number (a street number, part of a
// phone number, an amount) is never taken as a ZIP.
function readZip(paddedText, notes) {
  const zips = new Set();
  const pattern = /\b(?:zips?|zip\s*codes?|zipcodes?|postal\s*codes?)\s+(?:(?:is|are|of)\s+)?((?:\d{5}(?![\d-])(?:\s+(?:or\s+|and\s+)?)?)+)/g;
  for (const m of paddedText.matchAll(pattern)) {
    for (const z of m[1].match(/\d{5}/g)) zips.add(z);
  }
  if (zips.size > 1) {
    notes.add(NOTES.MULTIPLE_ZIPS);
    return null;
  }
  return zips.size === 1 ? [...zips][0] : null;
}

export function createRuleBasedInterpreter({ attachments = DEFAULT_ATTACHMENTS } = {}) {
  return Object.freeze({
    version: INTERPRETER_VERSION,
    interpret({ text, needCategories }) {
      const padded = normalize(text);
      const notes = new Set();
      const { needCategoryIds, reasons, anyRefused } = readNeeds(text, needCategories, attachments);
      if (anyRefused) notes.add(NOTES.NOT_REQUESTED);
      const ageRange = readAge(padded, notes);
      const participantZip = readZip(padded, notes);
      return { needCategoryIds, reasons, ageRange, participantZip, notes: [...notes].sort() };
    },
  });
}
