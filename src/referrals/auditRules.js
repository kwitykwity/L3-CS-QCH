// The rules dbo.audit_events enforces in Azure SQL (db/migrations/
// 001_core_schema.sql), applied by the in-memory stores too, so every test
// that writes an audit event also proves Azure would accept it
// (Trello card 4; PRD 6.4, 9.6).
//
// test/auditRules.test.js reads the migration and fails if these lists
// ever drift from the SQL CHECK constraints.

export const AUDIT_ENTITY_TYPES = Object.freeze([
  'REFERRAL', 'PROGRAM', 'DEPARTMENT', 'FIELD', 'FIELD_OPTION', 'PROGRAM_FIELD', 'USER', 'USER_GRANT', 'REASON', 'GPME_RULE',
]);

export const AUDIT_ACTIONS = Object.freeze([
  'CREATED', 'UPDATED', 'RENAMED', 'ACCEPTED', 'NOT_APPROPRIATE', 'SERVICE_OUTCOME_RECORDED', 'CORRECTED',
  'DISCONTINUED', 'REACTIVATED', 'RETIRED', 'REPLACED', 'GRANTED', 'REVOKED', 'ACTIVATED',
]);

export const CORRELATION_ID_MAX = 64; // correlation_id NVARCHAR(64)

// Thrown where SQL Server would refuse the INSERT. Names the constraint
// only, never the event's values.
export class AuditRuleError extends Error {
  constructor(constraint) {
    super(`audit_events insert refused by ${constraint}`);
    this.name = 'AuditRuleError';
    this.constraint = constraint;
  }
}

// before_json / after_json: NULL or valid JSON (ck_audit_*_json). A value
// JSON can't hold (a BigInt, a cycle) or a top-level non-object is refused.
function checkJson(value, constraint) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'object' || Array.isArray(value)) throw new AuditRuleError(constraint);
  try {
    JSON.stringify(value);
  } catch {
    throw new AuditRuleError(constraint);
  }
}

// userExists(userId) -> boolean: the actor_user_id foreign key.
export function checkAuditEvent(event, { userExists }) {
  if (!AUDIT_ENTITY_TYPES.includes(event?.entityType)) throw new AuditRuleError('ck_audit_entity');
  if (!AUDIT_ACTIONS.includes(event.action)) throw new AuditRuleError('ck_audit_action');
  if (!Number.isSafeInteger(event.entityId) || event.entityId <= 0) throw new AuditRuleError('entity_id NOT NULL');
  if (!Number.isSafeInteger(event.actorUserId) || !userExists(event.actorUserId)) throw new AuditRuleError('fk_audit_actor');
  const correlationId = event.correlationId ?? null;
  if (correlationId !== null && (typeof correlationId !== 'string' || correlationId.length > CORRELATION_ID_MAX)) {
    throw new AuditRuleError('correlation_id NVARCHAR(64)');
  }
  checkJson(event.before, 'ck_audit_before_json');
  checkJson(event.after, 'ck_audit_after_json');
}
