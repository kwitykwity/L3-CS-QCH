// Rules every audit event must pass before the in-memory stores accept it
// (Trello card 4; PRD 6.4, 9.6). There are two kinds, kept apart on
// purpose, and every refusal says which kind it is:
//
// - SQL rules: what dbo.audit_events itself refuses in
//   db/migrations/001_core_schema.sql (CHECK lists, NOT NULL, the
//   actor foreign key, NVARCHAR(64), ISJSON). JavaScript type checks stand
//   in for the column types the SQL store will bind parameters to.
// - APP rules: stricter rules this application adds. Azure SQL would
//   accept these events; we refuse them anyway, so audit history stays
//   uniform. Today: a positive entity_id, and before/after must be a JSON
//   object (ISJSON also allows an array).
//
// What this does NOT prove: that Azure SQL accepts or stores an event.
// These checks mirror the schema as written. Actual persistence,
// transactions and permissions against QCH's database are verified
// separately (db/AUDIT_VERIFICATION.md).
//
// test/auditRules.test.js reads the migration and fails if the SQL lists
// drift from its CHECK constraints.

export const AUDIT_ENTITY_TYPES = Object.freeze([
  'REFERRAL', 'PROGRAM', 'DEPARTMENT', 'FIELD', 'FIELD_OPTION', 'PROGRAM_FIELD', 'USER', 'USER_GRANT', 'REASON', 'GPME_RULE',
]);

export const AUDIT_ACTIONS = Object.freeze([
  'CREATED', 'UPDATED', 'RENAMED', 'ACCEPTED', 'NOT_APPROPRIATE', 'SERVICE_OUTCOME_RECORDED', 'CORRECTED',
  'DISCONTINUED', 'REACTIVATED', 'RETIRED', 'REPLACED', 'GRANTED', 'REVOKED', 'ACTIVATED',
]);

export const CORRELATION_ID_MAX = 64; // correlation_id NVARCHAR(64)

// Names of the stricter application rules (not SQL constraints).
export const APP_RULES = Object.freeze({
  ENTITY_ID_POSITIVE: 'app_audit_entity_id_positive',
  JSON_IS_OBJECT: 'app_audit_json_is_object',
});

// Thrown when an event fails a rule. `constraint` names the rule (a SQL
// constraint or one of APP_RULES); `kind` is 'SQL' or 'APP'. The message
// never includes the event's values.
export class AuditRuleError extends Error {
  constructor(constraint, kind = 'SQL') {
    super(kind === 'SQL'
      ? `audit_events insert refused by ${constraint}`
      : `audit event refused by application rule ${constraint}`);
    this.name = 'AuditRuleError';
    this.constraint = constraint;
    this.kind = kind;
  }
}

// before_json / after_json. The SQL store writes JSON.stringify(value) to
// the NVARCHAR(MAX) column, so this checks that serialized text:
// - SQL (ck_audit_*_json): NULL, or text ISJSON accepts. ISJSON without a
//   type argument accepts an object or an array, never a lone string,
//   number or boolean. A Date (or anything with toJSON) can serialize to
//   a lone string, which SQL would refuse.
// - APP: an object, not an array.
function checkJson(value, sqlConstraint) {
  if (value === null || value === undefined) return;
  let parsed;
  try {
    const text = JSON.stringify(value);
    if (typeof text !== 'string') throw new Error('not serializable');
    parsed = JSON.parse(text);
  } catch {
    throw new AuditRuleError(sqlConstraint, 'SQL');
  }
  if (parsed === null || typeof parsed !== 'object') throw new AuditRuleError(sqlConstraint, 'SQL');
  if (Array.isArray(parsed)) throw new AuditRuleError(APP_RULES.JSON_IS_OBJECT, 'APP');
}

// userExists(userId) -> boolean: the actor_user_id foreign key.
export function checkAuditEvent(event, { userExists }) {
  if (!AUDIT_ENTITY_TYPES.includes(event?.entityType)) throw new AuditRuleError('ck_audit_entity');
  if (!AUDIT_ACTIONS.includes(event.action)) throw new AuditRuleError('ck_audit_action');
  // entity_id BIGINT NOT NULL: SQL needs an integer, of any sign.
  if (!Number.isSafeInteger(event.entityId)) throw new AuditRuleError('entity_id BIGINT NOT NULL');
  if (!Number.isSafeInteger(event.actorUserId) || !userExists(event.actorUserId)) throw new AuditRuleError('fk_audit_actor');
  const correlationId = event.correlationId ?? null;
  if (correlationId !== null && (typeof correlationId !== 'string' || correlationId.length > CORRELATION_ID_MAX)) {
    throw new AuditRuleError('correlation_id NVARCHAR(64)');
  }
  checkJson(event.before, 'ck_audit_before_json');
  checkJson(event.after, 'ck_audit_after_json');
  // Stricter than SQL: our entity IDs all come from IDENTITY(1,1) keys.
  if (event.entityId <= 0) throw new AuditRuleError(APP_RULES.ENTITY_ID_POSITIVE, 'APP');
}
