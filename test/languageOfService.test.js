// Trello Task W: language of service (Kyle Butler, QCH, Oct 26, 2026;
// Handoff PRD and Handoff MVP: Language of Service). A Program can have one or more languages of
// service, Program Management maintains them, and Find a Program shows
// them to staff. Matching never uses them (rule gpme-v1).
//
// Acceptance criteria covered here:
//   - one or multiple languages per Program
//   - maintained in Program Management, with the existing authorization,
//     version check and audit
//   - shown in Find a Program results
//   - none on file stays "not on file", never "English only"
//   - a language never removes an otherwise possible Program, and never
//     blocks a referral
//
// SYNTHETIC data only.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createProgramService } from '../src/programs/programService.js';
import { createGpmeService, serviceLanguagesOf } from '../src/gpme/gpmeService.js';
import { serviceLanguagesText } from '../public/referral/guided.js';

const EMPLOYMENT = 2;
const ENGLISH = 1;
const SPANISH = 2;
const CHINESE = 3;
const RETIRED_LANGUAGE = 9;

const LANGUAGES = [
  { languageId: ENGLISH, name: 'Synthetic English', lifecycleStatus: 'ACTIVE' },
  { languageId: SPANISH, name: 'Synthetic Spanish', lifecycleStatus: 'ACTIVE' },
  { languageId: CHINESE, name: 'Synthetic Chinese', lifecycleStatus: 'ACTIVE' },
  { languageId: RETIRED_LANGUAGE, name: 'Synthetic old language', lifecycleStatus: 'DISCONTINUED' },
];

const NO_LIMITS = {
  ageLimitState: 'NO_RESTRICTION', ageMin: null, ageMax: null,
  serviceAreaState: 'NO_RESTRICTION', serviceAreaZips: [],
};

// Three Programs that all match Employment the same way: one with two
// languages, one with none on file, one with a language that is no longer
// offered for new selection.
const PROGRAMS = [
  { programId: 11, departmentId: 1, name: 'Synthetic Bilingual Jobs', site: 'Site A', lifecycleStatus: 'ACTIVE',
    needCategoryIds: [EMPLOYMENT], ...NO_LIMITS, languageIds: [SPANISH, ENGLISH] },
  { programId: 12, departmentId: 1, name: 'Synthetic Jobs, languages not on file', site: null, lifecycleStatus: 'ACTIVE',
    needCategoryIds: [EMPLOYMENT], ...NO_LIMITS },
  { programId: 13, departmentId: 1, name: 'Synthetic Jobs, old language', site: null, lifecycleStatus: 'ACTIVE',
    needCategoryIds: [EMPLOYMENT], ...NO_LIMITS, languageIds: [RETIRED_LANGUAGE] },
];

const MANAGER = 1;          // MANAGE_PROGRAM for Program 11
const OTHER_MANAGER = 2;    // MANAGE_PROGRAM for Program 12 only
const ORG_ADMIN = 3;        // MANAGE_ORGANIZATION: not a Program grant
const WORKER = 4;           // app access only

function setup() {
  const grant = (userId, permission, programId, scopeType = 'PROGRAM') => ({
    userId, permission, programId, scopeType, departmentId: null, grantSource: 'IN_APP',
  });
  const store = createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Department', lifecycleStatus: 'ACTIVE' }],
    programs: PROGRAMS,
    users: [MANAGER, OTHER_MANAGER, ORG_ADMIN, WORKER].map((userId) => ({ userId, isActive: true, currentProgramId: 12 })),
    grants: [
      grant(MANAGER, 'MANAGE_PROGRAM', 11), grant(MANAGER, 'MANAGE_PROGRAM', 13),
      grant(OTHER_MANAGER, 'MANAGE_PROGRAM', 12),
      grant(ORG_ADMIN, 'MANAGE_ORGANIZATION', null, 'ORG'),
    ],
    needCategories: [{ needCategoryId: EMPLOYMENT, name: 'Synthetic Employment', lifecycleStatus: 'ACTIVE' }],
    serviceLanguages: LANGUAGES,
  });
  return { store, programs: createProgramService({ store }) };
}

const appAs = (store, userId) => createApp({
  affiliationStore: store, referralStore: store, resolveIdentity: () => ({ userId }), nodeEnv: 'test',
});
const state = (store) => JSON.stringify([store._allPrograms(), store._referralAuditEvents]);
const refused = (promise, code) => assert.rejects(promise, (error) => error.code === code);

async function factsBody(store, programId, extra = {}) {
  const program = await store.getProgram(programId);
  return {
    version: program.version,
    needCategoryIds: program.needCategoryIds,
    ageLimitState: program.ageLimitState, ageMin: program.ageMin, ageMax: program.ageMax,
    serviceAreaState: program.serviceAreaState, serviceAreaZips: program.serviceAreaZips,
    ...extra,
  };
}

const allListed = (result) => [...result.plausible, ...result.possible];
const byId = (result, programId) => allListed(result).find((p) => p.programId === programId);

describe('Task W: Program Management maintains languages of service', () => {
  test('the matching page returns the language list and the Program\'s languages', async () => {
    const { programs } = setup();
    const read = await programs.getMatchingFacts(MANAGER, 11);
    assert.deepEqual(read.facts.languageIds, [SPANISH, ENGLISH]);
    assert.deepEqual(read.languages, LANGUAGES);
  });

  test('a Program can have one language, then several; sorted, versioned and audited', async () => {
    const { store, programs } = setup();
    const one = await programs.updateMatchingFacts(MANAGER, 11,
      await factsBody(store, 11, { languageIds: [CHINESE] }), { correlationId: 'synthetic-one' });
    assert.deepEqual(one.facts.languageIds, [CHINESE]);

    const many = await programs.updateMatchingFacts(MANAGER, 11,
      await factsBody(store, 11, { languageIds: [CHINESE, ENGLISH, SPANISH] }));
    assert.deepEqual(many.facts.languageIds, [ENGLISH, SPANISH, CHINESE]);
    assert.notEqual(many.program.version, one.program.version);

    const events = store._referralAuditEvents;
    assert.equal(events.length, 2);
    assert.deepEqual(events[0].before.matching_facts.languageIds, [SPANISH, ENGLISH]);
    assert.deepEqual(events[0].after.matching_facts.languageIds, [CHINESE]);
    assert.equal(events[0].correlationId, 'synthetic-one');
    assert.deepEqual(events[1].after.matching_facts.languageIds, [ENGLISH, SPANISH, CHINESE]);
  });

  test('an empty list means "not on file"; leaving it out keeps the saved languages', async () => {
    const { store, programs } = setup();
    // Leaving languageIds out (a client from before Task W) keeps them.
    const kept = await programs.updateMatchingFacts(MANAGER, 11,
      await factsBody(store, 11, { ageLimitState: 'SET', ageMin: 18, ageMax: null }));
    assert.deepEqual(kept.facts.languageIds, [ENGLISH, SPANISH]);

    const cleared = await programs.updateMatchingFacts(MANAGER, 11,
      await factsBody(store, 11, { languageIds: [] }));
    assert.deepEqual(cleared.facts.languageIds, []);

    // Sending the same languages again is "no change", like any other fact.
    await refused(programs.updateMatchingFacts(MANAGER, 11,
      await factsBody(store, 11, { languageIds: [] })), 'NO_CHANGE');
  });

  test('unknown, duplicate, malformed and newly chosen discontinued languages write nothing', async () => {
    const { store, programs } = setup();
    const before = state(store);
    for (const languageIds of [[999], [ENGLISH, ENGLISH], ['es'], [0], null, [RETIRED_LANGUAGE]]) {
      await refused(programs.updateMatchingFacts(MANAGER, 11,
        await factsBody(store, 11, { languageIds })), 'INVALID_REQUEST');
      assert.equal(state(store), before, JSON.stringify(languageIds));
    }
  });

  test('a discontinued language already on file can be kept', async () => {
    const { store, programs } = setup();
    const kept = await programs.updateMatchingFacts(MANAGER, 13,
      await factsBody(store, 13, { languageIds: [RETIRED_LANGUAGE, ENGLISH] }));
    assert.deepEqual(kept.facts.languageIds, [ENGLISH, RETIRED_LANGUAGE]);
  });

  test('only the Program\'s own manager can change languages; refusals write nothing', async () => {
    const { store, programs } = setup();
    const before = state(store);
    for (const userId of [OTHER_MANAGER, ORG_ADMIN, WORKER]) {
      await refused(programs.updateMatchingFacts(userId, 11,
        await factsBody(store, 11, { languageIds: [CHINESE] })), 'NOT_AUTHORIZED');
      await refused(programs.getMatchingFacts(userId, 11), 'NOT_AUTHORIZED');
    }
    assert.equal(state(store), before);
  });

  test('a stale version is refused and the current languages come back', async () => {
    const { store, programs } = setup();
    const stale = await factsBody(store, 11, { languageIds: [CHINESE] });
    await programs.updateMatchingFacts(MANAGER, 11, await factsBody(store, 11, { languageIds: [ENGLISH] }));
    const before = state(store);
    await assert.rejects(programs.updateMatchingFacts(MANAGER, 11, stale), (error) => {
      assert.equal(error.code, 'PROGRAM_CHANGED');
      assert.deepEqual(error.current.matchingFacts.languageIds, [ENGLISH]);
      return true;
    });
    assert.equal(state(store), before);
  });

  test('if the audit write fails, the language change rolls back', async () => {
    const { store, programs } = setup();
    const before = state(store);
    store._failNextAudit();
    await assert.rejects(programs.updateMatchingFacts(MANAGER, 11,
      await factsBody(store, 11, { languageIds: [CHINESE] })));
    assert.equal(state(store), before);
  });

  test('over HTTP: saved, no-store, and an unknown field is refused', async () => {
    const { store } = setup();
    const app = appAs(store, MANAGER);
    const url = '/api/program-management/programs/11/matching-facts';
    const saved = await request(app).put(url).send(await factsBody(store, 11, { languageIds: [CHINESE, ENGLISH] }));
    assert.equal(saved.status, 200);
    assert.equal(saved.headers['cache-control'], 'no-store');
    assert.deepEqual(saved.body.facts.languageIds, [ENGLISH, CHINESE]);
    const bad = await request(app).put(url).send(await factsBody(store, 11, { languageNames: ['Synthetic'] }));
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'UNEXPECTED_FIELD');
  });
});

describe('Task W: Find a Program shows languages, and they never change matching', () => {
  test('results show known languages by name, and "not on file" when none are saved', async () => {
    const { store } = setup();
    const res = await request(appAs(store, WORKER)).post('/api/gpme/match').send({ needCategoryIds: [EMPLOYMENT] });
    assert.equal(res.status, 200);
    assert.deepEqual(byId(res.body, 11).serviceLanguages,
      { status: 'ON_FILE', names: ['Synthetic English', 'Synthetic Spanish'] });
    assert.deepEqual(byId(res.body, 12).serviceLanguages, { status: 'NOT_ON_FILE', names: [] });
    // A discontinued language a Program has on file is still shown.
    assert.deepEqual(byId(res.body, 13).serviceLanguages,
      { status: 'ON_FILE', names: ['Synthetic old language'] });
  });

  test('languages never add, remove, regroup or re-explain a Program', async () => {
    const strip = (result) => ({
      ...result,
      plausible: result.plausible.map(({ serviceLanguages, ...rest }) => rest),
      possible: result.possible.map(({ serviceLanguages, ...rest }) => rest),
    });
    const input = { needCategoryIds: [EMPLOYMENT] };
    const { store } = setup();
    const before = strip(await createGpmeService({ store }).match(WORKER, input));
    assert.equal(allListed(before).length, 3);

    // Give the Programs completely different languages.
    const programs = createProgramService({ store });
    for (const [programId, languageIds] of [[11, [CHINESE]], [13, []]]) {
      await programs.updateMatchingFacts(MANAGER, programId, await factsBody(store, programId, { languageIds }));
    }
    const after = strip(await createGpmeService({ store }).match(WORKER, input));
    assert.deepEqual(after, before);
  });

  test('a language is not a matching input', async () => {
    const { store } = setup();
    const res = await request(appAs(store, WORKER)).post('/api/gpme/match')
      .send({ needCategoryIds: [EMPLOYMENT], languageIds: [SPANISH] });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'UNEXPECTED_FIELD');
  });

  test('changing a Program\'s languages after the search does not block the referral', async () => {
    const { store, programs } = setup();
    const app = appAs(store, WORKER);
    const answers = { needCategoryIds: [EMPLOYMENT] };
    const found = await request(app).post('/api/gpme/match').send(answers);
    assert.ok(byId(found.body, 11));
    await programs.updateMatchingFacts(MANAGER, 11, await factsBody(store, 11, { languageIds: [CHINESE] }));
    const sent = await request(app).post('/api/referrals').send({
      submissionId: randomUUID(), receivingProgramId: 11, participantName: 'Synthetic Person Lang',
      contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic context', gpme: answers,
    });
    assert.equal(sent.status, 201);
    const saved = await request(app).get(`/api/referrals/${sent.body.referral.referralId}`);
    assert.equal(saved.body.referral.source, 'GPME_ASSISTED');
  });

  test('if the language list cannot be read, results still come back, without guessing', async () => {
    const { store } = setup();
    store._failLanguages();
    const logged = [];
    const service = createGpmeService({ store, logLanguageFailure: (err) => logged.push(err.name) });
    const result = await service.match(WORKER, { needCategoryIds: [EMPLOYMENT] });
    assert.equal(result.status, 'RESULTS');
    assert.equal(allListed(result).length, 3);
    assert.ok(allListed(result).every((p) => !('serviceLanguages' in p)), 'never claims "not on file"');
    assert.deepEqual(logged, ['Error']);
  });

  test('serviceLanguagesOf: ignores unknown IDs and repeats, and sorts by name', () => {
    const names = new Map([[1, 'B'], [2, 'A']]);
    assert.deepEqual(serviceLanguagesOf({ languageIds: [1, 2, 2, 99] }, names), { status: 'ON_FILE', names: ['A', 'B'] });
    assert.deepEqual(serviceLanguagesOf({ languageIds: [99] }, names), { status: 'NOT_ON_FILE', names: [] });
    assert.deepEqual(serviceLanguagesOf({}, names), { status: 'NOT_ON_FILE', names: [] });
  });

  test('the screen wording: names, "not on file", or nothing when the server sent nothing', () => {
    assert.equal(serviceLanguagesText({ status: 'ON_FILE', names: ['English', 'Spanish'] }),
      'Languages of service: English, Spanish');
    assert.equal(serviceLanguagesText({ status: 'NOT_ON_FILE', names: [] }), 'Languages of service: not on file');
    for (const value of [undefined, null, {}, { status: 'ON_FILE', names: [] }, { status: 'ON_FILE', names: [5] }]) {
      assert.equal(serviceLanguagesText(value), null, JSON.stringify(value));
    }
    assert.ok(!/english only/i.test(serviceLanguagesText({ status: 'NOT_ON_FILE', names: [] })));
  });
});
