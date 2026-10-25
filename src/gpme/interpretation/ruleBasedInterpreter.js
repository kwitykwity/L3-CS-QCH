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
// age range, ZIP) can ever come out of an interpreter (PRD 8.2).
//
// No external service is called: it is a pure function over the text, the
// current need categories, and the tables below. The text is never stored,
// logged, or returned (PRD 5.3, 5.4, 15.3). Terms returned in `reasons` come
// from the vocabulary, never from the worker's text.

export const INTERPRETER_VERSION = 'interpret-rules-v1';

export const NOTES = Object.freeze({
  MULTIPLE_AGES: 'MULTIPLE_AGES',
  MULTIPLE_ZIPS: 'MULTIPLE_ZIPS',
  INVALID_AGE: 'INVALID_AGE',
});

// Extra words that point at a need category. A category is recognized by
// words in its current name (so a Program Management rename or a new
// category is picked up with no code change); a group below adds common
// everyday wording when the category name contains one of its `names`.
const SYNONYM_GROUPS = Object.freeze([
  { names: ['food', 'nutrition', 'meal'], terms: ['hungry', 'hunger', 'groceries', 'grocery', 'pantry', 'meals', 'snap', 'food stamps'] },
  { names: ['housing', 'shelter'], terms: ['homeless', 'eviction', 'evicted', 'rent', 'landlord', 'apartment', 'lease', 'shelter'] },
  { names: ['employment', 'job', 'workforce'], terms: ['job', 'jobs', 'work', 'unemployed', 'resume', 'hiring', 'career', 'laid off'] },
  { names: ['education', 'school', 'literacy'], terms: ['school', 'class', 'classes', 'tutoring', 'homework', 'ged', 'esl', 'english', 'diploma'] },
  { names: ['childcare', 'child care'], terms: ['daycare', 'day care', 'child care', 'babysitter', 'preschool', 'toddler'] },
  { names: ['older adult', 'senior', 'aging'], terms: ['senior', 'seniors', 'elderly', 'older adult', 'older adults', 'aging'] },
  { names: ['health', 'medical'], terms: ['doctor', 'medical', 'clinic', 'insurance', 'medicaid', 'sick'] },
  { names: ['mental', 'counseling', 'behavioral'], terms: ['counseling', 'therapy', 'anxiety', 'depressed', 'depression', 'stress'] },
  { names: ['legal', 'immigration'], terms: ['lawyer', 'attorney', 'visa', 'citizenship', 'immigration', 'legal'] },
  { names: ['youth', 'teen'], terms: ['teen', 'teens', 'teenager', 'youth'] },
  { names: ['benefit', 'financial', 'income'], terms: ['benefits', 'bills', 'debt', 'money', 'income', 'taxes'] },
]);

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

function termsForCategory(name) {
  const lowered = String(name).toLowerCase().replace(/\(.*?\)/g, ' ');
  const nameWords = lowered.split(/[^a-z0-9]+/).filter((w) => w && !NAME_STOP_WORDS.has(w));
  const terms = new Set(nameWords);
  for (const group of SYNONYM_GROUPS) {
    if (group.names.some((n) => lowered.includes(n))) for (const t of group.terms) terms.add(t);
  }
  return [...terms];
}

function containsTerm(paddedText, wordSet, term) {
  if (term.includes(' ')) return paddedText.includes(` ${term} `) || paddedText.includes(` ${term}s `);
  return wordSet.has(term) || wordSet.has(stem(term));
}

function readNeeds(paddedText, needCategories) {
  const words = new Set();
  for (const w of paddedText.trim().split(' ')) {
    if (w) { words.add(w); words.add(stem(w)); }
  }
  const needCategoryIds = [];
  const reasons = new Map();
  for (const category of needCategories) {
    if (category.lifecycleStatus !== 'ACTIVE') continue;
    const hits = termsForCategory(category.name).filter((t) => containsTerm(paddedText, words, t));
    if (hits.length > 0) {
      needCategoryIds.push(category.needCategoryId);
      // One entry per word family ("job" and "jobs" are listed once).
      const byStem = new Map();
      for (const t of hits) if (!byStem.has(stem(t))) byStem.set(stem(t), t);
      reasons.set(category.needCategoryId, [...byStem.values()].sort());
    }
  }
  needCategoryIds.sort((a, b) => a - b);
  return { needCategoryIds, reasons };
}

function inRange(n) {
  return Number.isInteger(n) && n >= 0 && n <= MAX_AGE;
}

// Ages are only read next to age wording ("17 year old", "age 17", "ages 18
// to 24"), so other numbers (a ZIP, "5 bags") are not mistaken for an age.
// Two different ages (a parent and a child) are ambiguous, so none is
// proposed and the worker enters it.
function readAge(paddedText, notes) {
  const found = [];

  const patterns = [
    // ages 18 to 24 / age between 18 and 24 / aged 18-24
    [/\bage[sd]?\s+(?:of\s+|between\s+)?(\d{1,3})\s*(?:-|to|through|and)\s*(\d{1,3})\b/g, 2],
    // 18 to 24 years old / 18-24 yo
    [/\b(\d{1,3})\s*(?:-|to|through)\s*(\d{1,3})\s*(?:years?|yrs?|y\/o|yo)\b/g, 2],
    // 17 year old / 17-year-old
    [/\b(\d{1,3})[\s-]*(?:years?|yrs?)[\s-]*old\b/g, 1],
    // 17 yo / 17 y/o
    [/\b(\d{1,3})\s*(?:yo|y\/o)\b/g, 1],
    // age 17 / aged 17
    [/\bage[d]?\s+(\d{1,3})\b(?!\s*(?:-|to|through|and)\s*\d)/g, 1],
  ];

  const consumed = [];
  for (const [pattern, count] of patterns) {
    for (const m of paddedText.matchAll(pattern)) {
      const span = [m.index, m.index + m[0].length];
      if (consumed.some(([s, e]) => span[0] < e && span[1] > s)) continue;
      consumed.push(span);
      const a = Number(m[1]);
      const b = count === 2 ? Number(m[2]) : a;
      if (!inRange(a) || !inRange(b) || a > b) {
        notes.add(NOTES.INVALID_AGE);
        continue;
      }
      found.push({ min: a, max: b });
    }
  }

  // Everyday wording for a range. A starting point for the worker to check,
  // not a Program rule.
  if (found.length === 0) {
    if (/ (?:teen|teens|teenager|teenagers) /.test(paddedText)) found.push({ min: 13, max: 19 });
    else if (/ (?:elderly|older adult|older adults) /.test(paddedText)) found.push({ min: 60, max: MAX_AGE });
  }

  const distinct = new Map(found.map((r) => [`${r.min}-${r.max}`, r]));
  if (distinct.size > 1) {
    notes.add(NOTES.MULTIPLE_AGES);
    return null;
  }
  return distinct.size === 1 ? [...distinct.values()][0] : null;
}

function readZip(paddedText, notes) {
  const zips = new Set([...paddedText.matchAll(/(?<![\d-])(\d{5})(?![\d-])/g)].map((m) => m[1]));
  if (zips.size > 1) {
    notes.add(NOTES.MULTIPLE_ZIPS);
    return null;
  }
  return zips.size === 1 ? [...zips][0] : null;
}

export function createRuleBasedInterpreter() {
  return Object.freeze({
    version: INTERPRETER_VERSION,
    interpret({ text, needCategories }) {
      const padded = normalize(text);
      const notes = new Set();
      const { needCategoryIds, reasons } = readNeeds(padded, needCategories);
      const ageRange = readAge(padded, notes);
      const participantZip = readZip(padded, notes);
      return { needCategoryIds, reasons, ageRange, participantZip, notes: [...notes].sort() };
    },
  });
}
