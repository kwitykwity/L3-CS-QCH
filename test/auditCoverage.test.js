// Audit coverage (Trello card 4, PRD 6.4, 6.5, 9.6). All data is SYNTHETIC.
//
// Walks every action in the app that changes stored data and checks that
// each writes exactly the expected audit events: right entity, action,
// actor and correlation ID, in the same transaction. The memory store
// enforces the dbo.audit_events rules (auditRules.js), so every event
// here would also be accepted by Azure SQL. At the end, no audit event may
// contain participant data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createReferralService } from '../src/referrals/referralService.js';
import { createResponseService } from '../src/referrals/responseService.js';
import { createOutcomeService } from '../src/referrals/outcomeService.js';
import { createReferralQueryService } from '../src/referrals/referralQueryService.js';
import { createAffiliationService } from '../src/affiliation/affiliationService.js';
import { createProgramService } from '../src/programs/programService.js';
import { createFieldService } from '../src/programs/fieldService.js';
import { createOrganizationService } from '../src/programs/organizationService.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../src/referrals/auditRules.js';

const A = 100;   // referring staff, affiliated with Program 10
const U = 101;   // staff with no affiliation yet
const R = 102;   // Program Director for 10 and 11, receiving staff for 11
const ORG = 103; // MANAGE_ORGANIZATION at ORG scope
const PARTICIPANT = { name: 'Synthetic Participant Psi', contact: '555-010-0199', context: 'Synthetic context Psi' };

const g = (userId, permission, programId) => ({
  userId, permission, scopeType: programId ? 'PROGRAM' : 'ORG', programId: programId ?? null, departmentId: null, grantSource: 'IN_APP',
});

test('every data-changing action writes exactly its audit events', async () => {
  let clock = new Date('2026-07-01T14:00:00.000Z');
  const store = createMemoryReferralStore({
    departments: [
      { departmentId: 1, name: 'Synthetic Dept A', lifecycleStatus: 'ACTIVE' },
      { departmentId: 2, name: 'Synthetic Dept B', lifecycleStatus: 'ACTIVE' },
    ],
    programs: [
      { programId: 10, departmentId: 1, name: 'Synthetic Program Ten', site: null, lifecycleStatus: 'ACTIVE' },
      { programId: 11, departmentId: 2, name: 'Synthetic Program Eleven', site: null, lifecycleStatus: 'ACTIVE' },
    ],
    users: [
      { userId: A, isActive: true, currentProgramId: 10 },
      { userId: U, isActive: true },
      { userId: R, isActive: true, currentProgramId: 11 },
      { userId: ORG, isActive: true },
    ],
    grants: [
      ...['VIEW_RECEIVED_REFERRAL', 'RESPOND_TO_REFERRAL', 'RECORD_OUTCOME', 'CORRECT_OUTCOME', 'UPDATE_RECEIVED_REFERRAL']
        .map((p) => g(R, p, 11)),
      g(R, 'MANAGE_PROGRAM', 10), g(R, 'MANAGE_PROGRAM', 11),
      g(ORG, 'MANAGE_ORGANIZATION'),
    ],
    notAppropriateReasons: [{ reasonId: 1, code: 'PROGRAM_CRITERIA_NOT_MET', label: 'Program criteria not met', displayOrder: 1 }],
  }, { now: () => clock });

  const referrals = createReferralService({ store });
  const responses = createResponseService({ store });
  const outcomes = createOutcomeService({ store });
  const queries = createReferralQueryService({ store });
  const affiliation = createAffiliationService({ store });
  const programs = createProgramService({ store });
  const fields = createFieldService({ store });
  const org = createOrganizationService({ store });

  const allEvents = () => [...store._auditEvents, ...store._referralAuditEvents];
  const seen = new Set();
  let n = 0;
  // Runs one action; checks the events it added (order-independent).
  async function step(actor, expected, run) {
    n += 1;
    const correlationId = `step-${n}`;
    // Two audit lists in memory (affiliation's and everything else's),
    // both dbo.audit_events in Azure: count new events in each.
    const lists = [store._auditEvents, store._referralAuditEvents];
    const before = lists.map((l) => l.length);
    await run({ correlationId });
    const added = lists.flatMap((l, i) => l.slice(before[i]));
    const got = added.map((e) => `${e.entityType} ${e.action}`).sort();
    assert.deepEqual(got, [...expected].sort(), `step ${n}`);
    for (const e of added) {
      assert.equal(e.actorUserId, actor, `step ${n}: actor`);
      assert.equal(e.correlationId, correlationId, `step ${n}: correlation ID`);
      assert.match(e.occurredAt, /Z$/, `step ${n}: UTC timestamp`);
      seen.add(`${e.entityType} ${e.action}`);
    }
  }

  const referralVersion = async (id) => (await queries.getReferral(R, id)).referral.version;
  const fieldVersion = (id) => store._fieldRows().find((f) => f.fieldId === id).version;
  const optionVersion = (id) => store._optionRows().find((o) => o.optionId === id).version;
  const useVersion = (p, f) => store._applicabilityRows().find((a) => a.programId === p && a.fieldId === f).version;
  const send = (opts) => referrals.createDirectReferral(A, {
    submissionId: randomUUID(), receivingProgramId: 11, participantName: PARTICIPANT.name,
    contactMethod: 'PHONE_CALL', contactValue: PARTICIPANT.contact, referralContext: PARTICIPANT.context,
  }, opts);

  // ----- Referrals (cards 3, 7, 8) -----
  let id;
  await step(A, ['REFERRAL CREATED'], async (o) => { id = (await send(o)).referral.referralId; });
  await step(R, ['REFERRAL ACCEPTED'], (o) => responses.respond(R, id, { decision: 'ACCEPTED' }, o));
  await step(R, ['REFERRAL SERVICE_OUTCOME_RECORDED'], (o) => outcomes.recordOutcome(R, id, { outcome: 'RESULTED_IN_SERVICE' }, o));
  await step(R, ['REFERRAL CORRECTED'], async (o) => outcomes.correctOutcome(R, id, { outcome: 'NOT_RECORDED', version: await referralVersion(id) }, o));
  await step(R, ['REFERRAL CORRECTED'], async (o) => outcomes.correctResponse(R, id, { decision: 'NOT_APPROPRIATE', reasonId: 1, version: await referralVersion(id) }, o));
  let id2;
  await step(A, ['REFERRAL CREATED'], async (o) => { id2 = (await send(o)).referral.referralId; });
  await step(R, ['REFERRAL NOT_APPROPRIATE'], (o) => responses.respond(R, id2, { decision: 'NOT_APPROPRIATE', reasonId: 1 }, o));
  // A retried submission is not a second referral, so it writes no audit event.
  const submissionId = randomUUID();
  const body = { submissionId, receivingProgramId: 11, participantName: PARTICIPANT.name, contactMethod: 'PHONE_CALL', contactValue: PARTICIPANT.contact, referralContext: PARTICIPANT.context };
  await step(A, ['REFERRAL CREATED'], (o) => referrals.createDirectReferral(A, body, o));
  await step(A, [], (o) => referrals.createDirectReferral(A, body, o));

  // ----- Staff affiliation (card 2) -----
  await step(U, ['USER UPDATED'], async (o) => affiliation.setAffiliation(U, { programId: 10, version: (await store.getUser(U)).version }, o));

  // ----- Program information and lifecycle (card 14A) -----
  await step(R, ['PROGRAM UPDATED'], async (o) => programs.updateDetails(R, 11, { version: (await store.getProgram(11)).version, description: 'Synthetic description' }, o));
  await step(R, ['PROGRAM DISCONTINUED'], async (o) => programs.discontinue(R, 10, { version: (await store.getProgram(10)).version }, o));
  await step(R, ['PROGRAM REACTIVATED'], async (o) => programs.reactivate(R, 10, { version: (await store.getProgram(10)).version }, o));

  // ----- Configurable fields, options, values (cards 14B, 14B-2) -----
  let field;
  await step(R, ['FIELD CREATED', 'FIELD_OPTION CREATED', 'FIELD_OPTION CREATED', 'PROGRAM_FIELD CREATED'], async (o) => {
    field = (await fields.createField(R, 11, { label: 'Synthetic format', dataType: 'SINGLE_SELECT', options: ['Synthetic A', 'Synthetic B'] }, o)).field;
  });
  const [opt1] = field.options;
  await step(R, ['PROGRAM_FIELD CREATED'], (o) => fields.applyField(R, 10, field.fieldId, {}, o));
  await step(R, ['PROGRAM_FIELD UPDATED'], (o) => fields.setFieldValue(R, 11, field.fieldId, { version: useVersion(11, field.fieldId), value: opt1.optionId }, o));
  await step(R, ['PROGRAM_FIELD UPDATED'], (o) => fields.updateApplicability(R, 11, field.fieldId, { version: useVersion(11, field.fieldId), isRequired: true }, o));
  await step(R, ['FIELD RENAMED'], (o) => fields.renameField(R, field.fieldId, { version: fieldVersion(field.fieldId), label: 'Synthetic session format' }, o));
  await step(R, ['FIELD_OPTION CREATED'], (o) => fields.addOption(R, field.fieldId, { label: 'Synthetic C' }, o));
  await step(R, ['FIELD_OPTION RENAMED'], (o) => fields.renameOption(R, field.fieldId, opt1.optionId, { version: optionVersion(opt1.optionId), label: 'Synthetic A2' }, o));
  await step(R, ['FIELD_OPTION DISCONTINUED'], (o) => fields.discontinueOption(R, field.fieldId, opt1.optionId, { version: optionVersion(opt1.optionId) }, o));
  await step(R, ['FIELD_OPTION REACTIVATED'], (o) => fields.reactivateOption(R, field.fieldId, opt1.optionId, { version: optionVersion(opt1.optionId) }, o));
  let replacement;
  await step(R, ['FIELD CREATED', 'PROGRAM_FIELD CREATED', 'PROGRAM_FIELD CREATED', 'FIELD REPLACED'], async (o) => {
    replacement = (await fields.replaceField(R, field.fieldId, { version: fieldVersion(field.fieldId), label: 'Synthetic notes', dataType: 'TEXT' }, o)).replacement;
  });
  await step(R, ['FIELD DISCONTINUED'], (o) => fields.discontinueField(R, replacement.fieldId, { version: fieldVersion(replacement.fieldId) }, o));
  await step(R, ['FIELD REACTIVATED'], (o) => fields.reactivateField(R, replacement.fieldId, { version: fieldVersion(replacement.fieldId) }, o));
  await step(R, ['FIELD DISCONTINUED'], (o) => fields.discontinueField(R, replacement.fieldId, { version: fieldVersion(replacement.fieldId) }, o));
  clock = new Date(clock.getTime() + 91 * 24 * 60 * 60 * 1000);
  await step(ORG, ['FIELD RETIRED'], (o) => fields.retireField(ORG, replacement.fieldId, { version: fieldVersion(replacement.fieldId) }, o));

  // ----- Departments and new Programs (card 14C) -----
  let dept;
  await step(ORG, ['DEPARTMENT CREATED'], async (o) => { dept = (await org.createDepartment(ORG, { name: 'Synthetic Dept C' }, o)).department; });
  await step(ORG, ['DEPARTMENT RENAMED'], async (o) => org.renameDepartment(ORG, dept.departmentId, { version: (await store.getDepartment(dept.departmentId)).version, name: 'Synthetic Dept C2' }, o));
  let program;
  await step(ORG, ['PROGRAM CREATED'], async (o) => { program = (await org.createProgram(ORG, { departmentId: dept.departmentId, name: 'Synthetic Program New' }, o)).program; });
  await step(ORG, ['PROGRAM UPDATED'], async (o) => org.moveProgram(ORG, program.programId, { version: (await store.getProgram(program.programId)).version, departmentId: 1 }, o));
  await step(ORG, ['DEPARTMENT DISCONTINUED'], async (o) => org.discontinueDepartment(ORG, dept.departmentId, { version: (await store.getDepartment(dept.departmentId)).version }, o));
  await step(ORG, ['DEPARTMENT REACTIVATED'], async (o) => org.reactivateDepartment(ORG, dept.departmentId, { version: (await store.getDepartment(dept.departmentId)).version }, o));

  // Every audit name the app uses is one the schema allows (also enforced
  // on every write by the store).
  for (const pair of seen) {
    const [entity, action] = pair.split(' ');
    assert.ok(AUDIT_ENTITY_TYPES.includes(entity) && AUDIT_ACTIONS.includes(action), pair);
  }
  // The full list of audit event kinds the app writes today, all covered above.
  assert.deepEqual([...seen].sort(), [
    'DEPARTMENT CREATED', 'DEPARTMENT DISCONTINUED', 'DEPARTMENT REACTIVATED', 'DEPARTMENT RENAMED',
    'FIELD CREATED', 'FIELD DISCONTINUED', 'FIELD REACTIVATED', 'FIELD RENAMED', 'FIELD REPLACED', 'FIELD RETIRED',
    'FIELD_OPTION CREATED', 'FIELD_OPTION DISCONTINUED', 'FIELD_OPTION REACTIVATED', 'FIELD_OPTION RENAMED',
    'PROGRAM CREATED', 'PROGRAM DISCONTINUED', 'PROGRAM REACTIVATED', 'PROGRAM UPDATED',
    'PROGRAM_FIELD CREATED', 'PROGRAM_FIELD UPDATED',
    'REFERRAL ACCEPTED', 'REFERRAL CORRECTED', 'REFERRAL CREATED', 'REFERRAL NOT_APPROPRIATE', 'REFERRAL SERVICE_OUTCOME_RECORDED',
    'USER UPDATED',
  ]);

  // No participant data anywhere in audit history (PRD 5.4, 6.5).
  const history = JSON.stringify(allEvents());
  for (const secret of Object.values(PARTICIPANT)) assert.ok(!history.includes(secret), 'participant data in audit');
});
