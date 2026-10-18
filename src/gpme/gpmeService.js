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

import { errors as affiliationErrors } from '../affiliation/errors.js';
import { gpmeErrors } from './errors.js';
import { GPME_RULE_VERSION, MATCH_STATUS, matchPrograms } from './matchPrograms.js';
import { validateMatchRequest } from './validateMatchRequest.js';

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function createGpmeService({ store, ruleVersion = GPME_RULE_VERSION, logFailure = defaultLogFailure } = {}) {
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

      try {
        candidates = await store.listMatchablePrograms();
        return matchPrograms(input, { candidates, needCategories, ruleVersion });
      } catch (err) {
        return unableToMatch(err);
      }
    },
  };
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
