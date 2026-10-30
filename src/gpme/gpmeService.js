// GPME service: checks the caller, validates the request, loads current
// Program data, and runs the matching engine (PRD 8.1 to 8.10, 3.2, 3.6).
//
// - Identity is the server-derived userId only (PRD 3.2). Matching needs
//   application access only, which an active user has.
// - Inputs live only for this request. They are never stored, logged, or
//   returned (PRD 5.3, 15.3).
// - If Program data cannot be loaded or the engine throws, the result is
//   UNABLE_TO_MATCH. That is a technical failure, never reported as "no
//   plausible match" (PRD 8.5, 8.8). The browser keeps the worker's
//   inputs and offers Retry or Direct Referral.
// - GPME only suggests. It never creates, routes, or submits a referral
//   (PRD 8.1). Direct Referral never calls this service (PRD 8.8).
//
// Store contract (see src/affiliation/memoryStore.js):
//   getUser(userId)          -> { userId, isActive, ... } | null
//   listNeedCategories()     -> [{ needCategoryId, name, lifecycleStatus }]
//   listMatchablePrograms()  -> [{ program, department }], both ACTIVE, where
//       program has the matching facts in src/gpme/programFacts.js
//   listServiceLanguages()   -> [{ languageId, name, lifecycleStatus }]
//
// Language of service (Task W) is added to each result AFTER matching, as
// information for staff. The engine never sees it, so a language can never
// remove a Program or change a result (rule gpme-v1). The referral
// re-check calls the engine directly and is not affected either.

import { errors as affiliationErrors } from '../affiliation/errors.js';
import { gpmeErrors } from './errors.js';
import { GPME_RULE_VERSION, MATCH_STATUS, matchPrograms } from './matchPrograms.js';
import { validateMatchRequest } from './validateMatchRequest.js';
import { createRuleBasedInterpreter } from './interpretation/ruleBasedInterpreter.js';
import { validateInterpretRequest } from './interpretation/validateInterpretRequest.js';
import { validateInterpretation, validateInterpreterVersion } from './interpretation/validateInterpretation.js';
import { readMatchingFacts } from './programFacts.js';
import { readCurrentProgramInformation } from '../programs/currentProgramInformation.js';
import { attachProgramInformation } from './programInformationForResults.js';
import { matchingFactsOf } from '../programs/validateMatchingChange.js';

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// What each result says about language of service. Known languages are
// listed by name; none on file is NOT_ON_FILE (never "English only").
// Languages are shown whatever their list status, because they are what
// the Program has on file.
export function serviceLanguagesOf(program, namesById) {
  const names = [...new Set(program?.languageIds ?? [])]
    .filter((id) => namesById.has(id))
    .map((id) => namesById.get(id))
    .sort(compareText);
  return names.length > 0
    ? { status: 'ON_FILE', names }
    : { status: 'NOT_ON_FILE', names: [] };
}

export const INTERPRET_STATUS = Object.freeze({
  INTERPRETED: 'INTERPRETED',
  NOTHING_RECOGNIZED: 'NOTHING_RECOGNIZED',
  UNABLE_TO_INTERPRET: 'UNABLE_TO_INTERPRET',
});

// `interpreter` is the replaceable interpretation layer (Task D); see
// src/gpme/interpretation/ruleBasedInterpreter.js for its contract. It only
// proposes criteria; GPME matching below never depends on which one ran.
export function createGpmeService({
  store, ruleVersion = GPME_RULE_VERSION, logFailure = defaultLogFailure,
  interpreter = createRuleBasedInterpreter(), logLanguageFailure = defaultLogLanguageFailure,
} = {}) {
  if (!store) throw new Error('createGpmeService requires a store');

  async function requireActiveUser(userId) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw gpmeErrors.notAuthenticated();
    const user = await store.getUser(userId);
    if (!user || !user.isActive) throw affiliationErrors.userNotActive();
  }

  function unableToMatch(err) {
    logFailure(err);
    return { status: MATCH_STATUS.UNABLE_TO_MATCH, ruleVersion };
  }

  return {
    // The controlled list the guided form offers. Active categories only.
    async listNeedCategories(userId) {
      await requireActiveUser(userId);
      const categories = await store.listNeedCategories();
      return categories
        .filter((c) => c.lifecycleStatus === 'ACTIVE')
        .map((c) => ({ needCategoryId: c.needCategoryId, name: c.name }))
        .sort((a, b) => compareText(a.name, b.name) || a.needCategoryId - b.needCategoryId);
    },

    // Turns the worker's short description into PROPOSED matching criteria
    // for the worker to review, correct, and confirm before matching (Task D).
    // It never matches, stores, logs, or returns the text, and never calls
    // an external service. Each proposed need also reports how many Programs
    // currently offer it, read from current Program Management data, so the
    // worker sees up front when no current Program lists a need.
    async interpret(userId, body) {
      await requireActiveUser(userId);

      const checked = validateInterpretRequest(body);
      if (checked.unexpectedField) throw gpmeErrors.unexpectedField();
      if (!checked.ok) throw gpmeErrors.invalidRequest(checked.fields);

      let needCategories;
      let proposal;
      try {
        needCategories = await store.listNeedCategories();
        const raw = await interpreter.interpret({ text: checked.value.text, needCategories });
        // The interpreter is replaceable, so its whole output is untrusted:
        // only active category ids and the approved structured values pass.
        const active = new Set(
          needCategories.filter((c) => c.lifecycleStatus === 'ACTIVE').map((c) => c.needCategoryId),
        );
        const verdict = validateInterpretation(raw, active);
        if (!verdict.ok || !validateInterpreterVersion(interpreter.version)) {
          throw new Error('interpreter output not accepted');
        }
        proposal = verdict.value;
      } catch (err) {
        logFailure(err);
        return { status: INTERPRET_STATUS.UNABLE_TO_INTERPRET };
      }

      // Current Program Management data. If it cannot be read, interpretation
      // still works; the counts are simply left out (null), never guessed.
      let offeredCounts = null;
      try {
        offeredCounts = new Map();
        for (const { program } of await store.listMatchablePrograms()) {
          for (const id of readMatchingFacts(program).needCategoryIds) {
            offeredCounts.set(id, (offeredCounts.get(id) ?? 0) + 1);
          }
        }
      } catch (err) {
        logFailure(err);
        offeredCounts = null;
      }

      const names = new Map(needCategories.map((c) => [c.needCategoryId, c.name]));
      const needs = proposal.needCategoryIds
        .map((id) => ({
          needCategoryId: id,
          name: names.get(id),
          matchedTerms: [...(proposal.reasons.get(id) ?? [])],
          currentProgramCount: offeredCounts ? (offeredCounts.get(id) ?? 0) : null,
        }));

      return {
        status: needs.length > 0 || proposal.ageRange !== null || proposal.participantZip !== null
          ? INTERPRET_STATUS.INTERPRETED
          : INTERPRET_STATUS.NOTHING_RECOGNIZED,
        interpreterVersion: interpreter.version,
        needs,
        ageRange: proposal.ageRange,
        participantZip: proposal.participantZip,
        notes: proposal.notes,
      };
    },

    // Internal Task C interface; no HTTP route exposes these fields.
    // Requires the transactional store contract used by Program Management.
    // This information is descriptive: gpme-v1 does not interpret it.
    async listCurrentProgramInformation(userId) {
      await requireActiveUser(userId);
      return store.withTransaction(async (tx) => {
        const candidates = await tx.listMatchablePrograms();
        const information = [];
        for (const { program, department } of candidates) {
          if (program.lifecycleStatus !== 'ACTIVE'
              || department.lifecycleStatus !== 'ACTIVE') continue;
          information.push({
            ...(await readCurrentProgramInformation(tx, program)),
            name: program.name,
            departmentId: department.departmentId,
            departmentName: department.name,
            matchingFacts: matchingFactsOf(program),
          });
        }
        return information.sort((a, b) => a.programId - b.programId);
      });
    },

    async match(userId, body) {
      await requireActiveUser(userId);

      const checked = validateMatchRequest(body);
      if (checked.unexpectedField) throw gpmeErrors.unexpectedField();
      if (!checked.ok) throw gpmeErrors.invalidRequest(checked.fields);
      const input = checked.value;

      let needCategories;
      let candidates;
      try {
        needCategories = await store.listNeedCategories();
      } catch (err) {
        return unableToMatch(err);
      }

      // Every picked need must be a current, active category.
      const active = new Set(
        needCategories.filter((c) => c.lifecycleStatus === 'ACTIVE').map((c) => c.needCategoryId),
      );
      if (!input.needCategoryIds.every((id) => active.has(id))) {
        throw gpmeErrors.invalidRequest(['needCategoryIds']);
      }

      let result;
      try {
        candidates = await store.listMatchablePrograms();
        result = matchPrograms(input, { candidates, needCategories, ruleVersion });
      } catch (err) {
        return unableToMatch(err);
      }
      // Information for staff, attached AFTER matching so it can never add,
      // remove, or reorder a result: language of service (Task W), then
      // current Program information (Task X). Each leaves its own part out
      // if it cannot be read; neither can fail the match.
      const withLanguages = await addServiceLanguages(result, candidates);
      return attachProgramInformation(store, withLanguages, { logFailure });
    },
  };

  // Display only (Task W). If the language list cannot be read, the
  // results are returned without it rather than failing matching, and
  // never as "not on file" (that would claim something we did not check).
  async function addServiceLanguages(result, candidates) {
    if (result.status !== MATCH_STATUS.RESULTS) return result;
    let namesById;
    try {
      const languages = await store.listServiceLanguages();
      namesById = new Map(languages.map((row) => [row.languageId, row.name]));
    } catch (err) {
      logLanguageFailure(err);
      return result;
    }
    const programs = new Map(candidates.map(({ program }) => [program.programId, program]));
    const withLanguages = (item) => ({
      ...item,
      serviceLanguages: serviceLanguagesOf(programs.get(item.programId), namesById),
    });
    return {
      ...result,
      plausible: result.plausible.map(withLanguages),
      possible: result.possible.map(withLanguages),
    };
  }
}

// Error kinds that may appear in logs. Anything else, including a custom
// error name that could carry arbitrary text, is logged as OtherError.
const LOGGABLE_ERROR_KINDS = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError']);

export function safeErrorKind(err) {
  const name = err?.name;
  return typeof name === 'string' && LOGGABLE_ERROR_KINDS.has(name) ? name : 'OtherError';
}

// Safe metadata only: never the error message, stack, raw error name, or
// request values, any of which could carry participant data (PRD 15.3).
function defaultLogFailure(err) {
  console.error(`[gpme] matching unavailable (${safeErrorKind(err)})`);
}

function defaultLogLanguageFailure(err) {
  console.error(`[gpme] language list unavailable; results sent without languages (${safeErrorKind(err)})`);
}
