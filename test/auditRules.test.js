// Audit rules enforced by the in-memory stores (Trello card 4, PRD 6.4,
// 9.6): the dbo.audit_events constraints as written in migration 001, and
// the app's stricter rules, kept apart. All data is SYNTHETIC.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createMemoryStore } from '../src/affiliation/memoryStore.js';
import {
  APP_RULES, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, CORRELATION_ID_MAX, AuditRuleError, checkAuditEvent,
} from '../src/referrals/auditRules.js';

const MIGRATION = readFileSync(new URL('../db/migrations/001_core_schema.sql', import.meta.url), 'utf8');
const MARKER = 'SyntheticMarkerChi';

// The quoted values inside one CHECK (... IN (...)) constraint.
function checkList(name) {
  const match = new RegExp(`CONSTRAINT ${name} CHECK \\(\\w+ IN\\s*\\(([^)]*)\\)`, 's').exec(MIGRATION);
  assert.ok(match, `${name} not found in 001_core_schema.sql`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const good = (extra = {}) => ({
  entityType: 'REFERRAL', entityId: 1, action: 'CREATED', actorUserId: 100,
  before: null, after: { response_status: 'AWAITING_RESPONSE' }, correlationId: 'c-1', ...extra,
});

describe('the rules match the SQL schema exactly', () => {
  test('entity types match ck_audit_entity', () => {
    assert.deepEqual([...AUDIT_ENTITY_TYPES].sort(), checkList('ck_audit_entity').sort());
  });
  test('actions match ck_audit_action', () => {
    assert.deepEqual([...AUDIT_ACTIONS].sort(), checkList('ck_audit_action').sort());
  });
  test('correlation ID length matches correlation_id NVARCHAR(64)', () => {
    const match = /correlation_id\s+NVARCHAR\((\d+)\)/.exec(MIGRATION);
    assert.equal(CORRELATION_ID_MAX, Number(match[1]));
  });
  test('the actor is a foreign key to dbo.users', () => {
    assert.match(MIGRATION, /actor_user_id\s+INT\s+NOT NULL CONSTRAINT fk_audit_actor REFERENCES dbo\.users\(user_id\)/);
  });
  test('before/after are checked with ISJSON, and entity_id has no CHECK, so the stricter rules are app rules', () => {
    assert.match(MIGRATION, /CONSTRAINT ck_audit_before_json CHECK \(before_json IS NULL OR ISJSON\(before_json\) = 1\)/);
    assert.match(MIGRATION, /CONSTRAINT ck_audit_after_json\s+CHECK \(after_json\s+IS NULL OR ISJSON\(after_json\)\s+= 1\)/);
    assert.match(MIGRATION, /entity_id\s+BIGINT\s+NOT NULL,/);
    const table = /CREATE TABLE dbo\.audit_events \(([\s\S]*?)\n\);/.exec(MIGRATION)[1];
    assert.doesNotMatch(table, /CHECK \(entity_id/, 'SQL now checks entity_id: make the positive rule a SQL rule');
  });
});

describe('checkAuditEvent', () => {
  const exists = { userExists: (id) => id === 100 };
  const refused = (event, constraint, kind = 'SQL') => assert.throws(() => checkAuditEvent(event, exists),
    (err) => err instanceof AuditRuleError && err.constraint === constraint && err.kind === kind);

  test('a valid event passes; null before/after and no correlation ID are allowed', () => {
    checkAuditEvent(good(), exists);
    checkAuditEvent(good({ before: null, after: null, correlationId: null }), exists);
    checkAuditEvent(good({ correlationId: undefined }), exists);
    checkAuditEvent(good({ correlationId: 'x'.repeat(64) }), exists);
  });

  test('SQL rules: each refuses where the dbo.audit_events constraints would', () => {
    refused(good({ entityType: 'NOTE' }), 'ck_audit_entity');
    refused(good({ entityType: 'referral' }), 'ck_audit_entity');
    refused(good({ action: 'MOVED' }), 'ck_audit_action');
    refused(good({ action: 'OUTCOME_CORRECTED' }), 'ck_audit_action');
    refused(good({ entityId: null }), 'entity_id BIGINT NOT NULL');
    refused(good({ entityId: '7' }), 'entity_id BIGINT NOT NULL');
    refused(good({ entityId: 1.5 }), 'entity_id BIGINT NOT NULL');
    refused(good({ actorUserId: 999 }), 'fk_audit_actor');
    refused(good({ actorUserId: null }), 'fk_audit_actor');
    refused(good({ correlationId: 'x'.repeat(65) }), 'correlation_id NVARCHAR(64)');
    refused(good({ correlationId: 42 }), 'correlation_id NVARCHAR(64)');
    refused(good({ before: { n: 1n } }), 'ck_audit_before_json');
    refused(good({ after: 'not an object' }), 'ck_audit_after_json');
  });

  test('SQL rules: before/after are judged by their serialized JSON, as ISJSON would see it', () => {
    // A Date is an object in JavaScript but serializes to a lone JSON
    // string, which ISJSON refuses (review of #31).
    refused(good({ after: new Date('2026-10-21T12:00:00Z') }), 'ck_audit_after_json');
    refused(good({ before: new Date('2026-10-21T12:00:00Z') }), 'ck_audit_before_json');
    refused(good({ after: { toJSON: () => 'text' } }), 'ck_audit_after_json');
    refused(good({ after: { toJSON: () => 7 } }), 'ck_audit_after_json');
    refused(good({ after: { toJSON: () => null } }), 'ck_audit_after_json');
    refused(good({ after: () => ({}) }), 'ck_audit_after_json');
    // Nested dates are fine: they are strings inside an object.
    checkAuditEvent(good({ after: { at: new Date('2026-10-21T12:00:00Z') } }), exists);
    checkAuditEvent(good({ after: { toJSON: () => ({ ok: true }) } }), exists);
  });

  test('APP rules: stricter than SQL, and reported as app rules', () => {
    // ISJSON accepts an array and SQL has no CHECK on entity_id; we still refuse.
    refused(good({ after: [1, 2] }), APP_RULES.JSON_IS_OBJECT, 'APP');
    refused(good({ before: { toJSON: () => [1] } }), APP_RULES.JSON_IS_OBJECT, 'APP');
    refused(good({ entityId: 0 }), APP_RULES.ENTITY_ID_POSITIVE, 'APP');
    refused(good({ entityId: -4 }), APP_RULES.ENTITY_ID_POSITIVE, 'APP');
  });

  test('the error names the rule, never the event values', () => {
    assert.throws(() => checkAuditEvent(good({ action: MARKER }), exists),
      (e) => e instanceof AuditRuleError && !e.message.includes(MARKER));
  });
});

describe('the memory stores enforce the rules and roll back like a refused INSERT', () => {
  const seed = () => createMemoryReferralStore({
    departments: [{ departmentId: 1, name: 'Synthetic Dept', lifecycleStatus: 'ACTIVE' }],
    programs: [{ programId: 10, departmentId: 1, name: 'Synthetic Program', site: null, lifecycleStatus: 'ACTIVE' }],
    users: [{ userId: 100, isActive: true, currentProgramId: 10 }],
  });

  test('a refused audit event rolls back the whole transaction', async () => {
    const store = seed();
    const before = JSON.stringify([store._allPrograms(), store._referralAuditEvents]);
    await assert.rejects(store.withTransaction(async (tx) => {
      const p = await tx.lockProgramForUpdate(10);
      await tx.updateProgram({ programId: 10, expectedVersion: p.version, set: { description: 'Synthetic change' } });
      await tx.appendAuditEvent(good({ entityType: 'PROGRAM', entityId: 10, action: 'MOVED' }));
    }), (err) => err instanceof AuditRuleError && err.constraint === 'ck_audit_action');
    assert.equal(JSON.stringify([store._allPrograms(), store._referralAuditEvents]), before);
  });

  test('an after value that serializes to a lone JSON string (a Date) is refused and rolls back', async () => {
    const store = seed();
    const before = JSON.stringify([store._allPrograms(), store._referralAuditEvents]);
    await assert.rejects(store.withTransaction(async (tx) => {
      const p = await tx.lockProgramForUpdate(10);
      await tx.updateProgram({ programId: 10, expectedVersion: p.version, set: { description: 'Synthetic change' } });
      await tx.appendAuditEvent(good({ entityType: 'PROGRAM', entityId: 10, action: 'UPDATED', after: new Date('2026-10-21T12:00:00Z') }));
    }), (err) => err instanceof AuditRuleError && err.constraint === 'ck_audit_after_json' && err.kind === 'SQL');
    assert.equal(JSON.stringify([store._allPrograms(), store._referralAuditEvents]), before);
  });

  test('an app-rule refusal rolls back the same way', async () => {
    const store = seed();
    const before = JSON.stringify([store._allPrograms(), store._referralAuditEvents]);
    await assert.rejects(store.withTransaction(async (tx) => {
      const p = await tx.lockProgramForUpdate(10);
      await tx.updateProgram({ programId: 10, expectedVersion: p.version, set: { description: 'Synthetic change' } });
      await tx.appendAuditEvent(good({ entityType: 'PROGRAM', entityId: 10, action: 'UPDATED', after: ['x'] }));
    }), (err) => err.constraint === APP_RULES.JSON_IS_OBJECT && err.kind === 'APP');
    assert.equal(JSON.stringify([store._allPrograms(), store._referralAuditEvents]), before);
  });

  test('an actor who is not a user is refused (foreign key)', async () => {
    const store = seed();
    await assert.rejects(store.withTransaction((tx) => tx.appendAuditEvent(good({ actorUserId: 555 }))),
      (err) => err.constraint === 'fk_audit_actor');
    assert.equal(store._referralAuditEvents.length, 0);
  });

  test('a valid event is stored with a store-set UTC timestamp', async () => {
    const store = seed();
    await store.withTransaction((tx) => tx.appendAuditEvent(good()));
    assert.equal(store._referralAuditEvents.length, 1);
    assert.match(store._referralAuditEvents[0].occurredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('the affiliation store checks its USER audit event before changing anything', async () => {
    const store = createMemoryStore({
      departments: [{ departmentId: 1, name: 'Synthetic Dept', lifecycleStatus: 'ACTIVE' }],
      programs: [{ programId: 10, departmentId: 1, name: 'Synthetic Program', site: null, lifecycleStatus: 'ACTIVE' }],
      users: [{ userId: 100, isActive: true }],
    });
    const version = (await store.getUser(100)).version;
    await assert.rejects(store.updateUserProgramAffiliation({
      userId: 100, expectedVersion: version, fromProgramId: null, toProgramId: 10, actorUserId: 100, correlationId: 'x'.repeat(65),
    }), (err) => err.constraint === 'correlation_id NVARCHAR(64)');
    assert.equal((await store.getUser(100)).currentProgramId, null);
    assert.equal((await store.getUser(100)).version, version);
    assert.equal(store._auditEvents.length, 0);
  });
});
