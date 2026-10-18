// Referral retrieval for the receiving queue, the creator's own list, and
// a single referral (Final Technical PRD 3.3, 3.4, 3.6, 3.7, 6.1, 6.5,
// 9.9, 10.5).
//
// Every read checks the current user's access to that resource:
// - Lists are built only from referrals the user may see. Nothing is
//   fetched first and filtered for display.
// - A single referral the user may not see answers exactly like one that
//   does not exist (404), so an ID or URL reveals nothing (PRD 3.3).
// - Responses carry only the fields the screen needs (PRD 10.5). Lists
//   never include contact details or notes.

import { errors as affiliationErrors } from '../affiliation/errors.js';
import { receivingProgramIds, referralAccess } from '../authorization/referralAccess.js';
import { referralErrors } from './errors.js';
import { stageOf } from './stage.js';
import { encodeCursor } from './cursor.js';

// Bounded pages (PRD 9.9, 10.7). The store returns at most limit + 1 rows
// so "there are more" can be reported without counting everything. When
// there are more, nextCursor fetches the following page (see cursor.js).
// Authorization is evaluated again for every page.
export const LIST_LIMIT = 200;

export function createReferralQueryService({ store, allowDemoGrants = false }) {
  if (!store) throw new Error('createReferralQueryService requires a store');

  async function requireActiveUser(userId) {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw referralErrors.notAuthenticated();
    const user = await store.getUser(userId);
    if (!user || !user.isActive) throw affiliationErrors.userNotActive();
    return user;
  }

  async function receivingIdsFor(userId) {
    return receivingProgramIds(await store.getActiveGrants(userId), { allowDemoGrants });
  }

  // Program names for display, looked up once per request.
  function programNamer() {
    const cache = new Map();
    return async (programId) => {
      if (!cache.has(programId)) {
        const program = await store.getProgram(programId);
        cache.set(programId, { programId, name: program?.name ?? null });
      }
      return cache.get(programId);
    };
  }

  async function listItem(row, nameOf, { includeNeed }) {
    const item = {
      referralId: row.referralId,
      createdAt: row.createdAt,
      participantName: row.participantName,
      referringProgram: await nameOf(row.referringProgramId),
      receivingProgram: await nameOf(row.receivingProgramId),
      responseStatus: row.responseStatus,
      decision: row.decision ?? null,
      serviceOutcome: row.serviceOutcome,
      stage: stageOf(row),
    };
    if (includeNeed) item.referralContext = row.referralContext;
    return item;
  }

  function page(rows) {
    const items = rows.slice(0, LIST_LIMIT);
    const hasMore = rows.length > LIST_LIMIT;
    return { items, hasMore, nextCursor: hasMore ? encodeCursor(items.at(-1)) : null };
  }

  // Receiving queue: referrals sent TO Programs the user holds a
  // receiving grant for. Optional programId must be one of those.
  async function listReceived(userId, { programId, stage, after } = {}) {
    await requireActiveUser(userId);
    const allowed = await receivingIdsFor(userId);
    const nameOf = programNamer();
    const programs = [];
    for (const id of [...allowed].sort((a, b) => a - b)) programs.push(await nameOf(id));

    if (programId !== undefined && !allowed.has(programId)) throw referralErrors.notAuthorizedForProgram();
    const scope = programId !== undefined ? [programId] : [...allowed];
    if (scope.length === 0) return { programs, referrals: [], hasMore: false, nextCursor: null };

    const rows = await store.listReferralsByReceivingPrograms(scope, { stage, after, limit: LIST_LIMIT + 1 });
    const { items, hasMore, nextCursor } = page(rows);
    const referrals = [];
    for (const row of items) referrals.push(await listItem(row, nameOf, { includeNeed: true }));
    return { programs, referrals, hasMore, nextCursor };
  }

  // The user's own submitted referrals (VIEW_CREATED_REFERRAL).
  async function listSent(userId, { stage, after } = {}) {
    await requireActiveUser(userId);
    const nameOf = programNamer();
    const { items, hasMore, nextCursor } = page(await store.listReferralsByCreator(userId, { stage, after, limit: LIST_LIMIT + 1 }));
    const referrals = [];
    for (const row of items) referrals.push(await listItem(row, nameOf, { includeNeed: false }));
    return { referrals, hasMore, nextCursor };
  }

  async function getReferral(userId, referralId) {
    await requireActiveUser(userId);
    const row = await store.getReferralById(referralId);
    if (!row) throw referralErrors.referralNotFound();

    const access = referralAccess(userId, row, await receivingIdsFor(userId));
    if (!access.canView) throw referralErrors.referralNotFound(); // same answer as "does not exist"

    const nameOf = programNamer();
    const creator = await store.getUser(row.createdByUserId);
    return {
      referral: {
        referralId: row.referralId,
        createdAt: row.createdAt,
        source: row.source,
        createdBy: { displayName: creator?.displayName ?? null },
        referringProgram: await nameOf(row.referringProgramId),
        receivingProgram: await nameOf(row.receivingProgramId),
        participantName: row.participantName,
        contactMethod: row.contactMethod,
        contactValue: row.contactValue,
        participantZip: row.participantZip,
        referralContext: row.referralContext,
        notes: row.notes,
        responseStatus: row.responseStatus,
        decision: row.decision ?? null,
        serviceOutcome: row.serviceOutcome,
        stage: stageOf(row),
      },
      // Lets the UI show this referral read-only or with receiving actions
      // (PRD 3.7). The backend re-checks every action on its own.
      viewerAccess: { asCreator: access.asCreator, asReceiver: access.asReceiver },
    };
  }

  return Object.freeze({ listReceived, listSent, getReferral });
}
