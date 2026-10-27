// Permissions screen logic (Trello Task Y). Pure functions: no DOM, so
// they also run under Node for tests. app.js applies the results.
//
// The server decides everything (PRD 3.2, 3.7): who may administer, who
// can be changed, what can be granted. This file only words the results.

export const MESSAGES = Object.freeze({
  LOADED: 'Staff list loaded. Choose a staff member.',
  NOT_ADMIN: 'You do not have permission to administer permissions.',
  SIGNED_OUT: 'Your sign-in is not active. Sign in again, then reload.',
  LOAD_FAILED: 'The staff list could not be loaded. Try Reload.',
  PERSON_LOADED: 'Permissions loaded.',
  PERSON_FAILED: 'Permissions could not be loaded. Try again.',
  CHOOSE_PERSON: 'Choose a staff member first.',
  CHOOSE_PERMISSION: 'Choose a permission.',
  CHOOSE_PROGRAM: 'Choose the Program this permission is for.',
  SAVING: 'Saving...',
  SELF: 'You cannot change your own permissions. Ask another administrator.',
  INACTIVE: 'This staff member is not active. You can remove permissions, but not add new ones.',
  ALREADY: 'Nothing was added: this staff member already has that permission. The current permissions are shown.',
  CHANGED: 'Nothing was changed: another administrator changed these permissions first. The current permissions are shown.',
  NOT_REVOCABLE: 'That permission is not managed on this screen.',
  NOT_CONFIRMED: 'The change was not confirmed. Reload this person before trying again.',
  REJECTED: 'The change was not saved. Check your choices and try again.',
});

export const ORG_WIDE = 'Organization-wide';

// "Manage Program information: Housing Help Desk (Site C)".
export function describeGrant(grant) {
  const where = grant.scopeType === 'ORG'
    ? ORG_WIDE
    : [grant.programName ?? `Program ${grant.programId}`, grant.programSite ? `(${grant.programSite})` : null]
      .filter(Boolean).join(' ');
  return `${grant.label}: ${where}`;
}

// Why a grant has no Remove button.
export function readOnlyReason(grant) {
  if (grant.revocable) return null;
  if (grant.grantSource === 'DEMO') return 'Demo data; not managed here';
  return 'Managed outside this screen';
}

export function personHeading(user) {
  return `Permissions for ${user.displayName}${user.isYou ? ' (you)' : ''}${user.isActive ? '' : ' (not active)'}`;
}

export function personOptionLabel(user) {
  return `${user.displayName}${user.isYou ? ' (you)' : ''}${user.isActive ? '' : ' (not active)'}`;
}

const isGrantList = (value) => Array.isArray(value) && value.every((g) => Number.isSafeInteger(g?.grantId)
  && typeof g.label === 'string' && typeof g.permission === 'string');

// response: { unknown: true } or { status, body } from a grant or remove.
// Returns { state, message, tone, grants? }. `grants`, when present, is
// what the screen should show now.
export function interpretChange(response, { added } = {}) {
  if (!response || response.unknown) return { state: 'UNKNOWN', message: MESSAGES.NOT_CONFIRMED, tone: 'error' };
  const { status, body } = response;
  if ((status === 201 || status === 200) && ['GRANTED', 'REVOKED'].includes(body?.status) && isGrantList(body.grants)) {
    const message = body.status === 'GRANTED'
      ? `Added: ${describeGrant(body.grant)}.`
      : `Removed: ${added ? describeGrant(added) : 'the permission'}.`;
    return { state: body.status, message, tone: 'success', grants: body.grants };
  }
  const current = isGrantList(body?.current) ? body.current : undefined;
  switch (body?.code) {
    case 'ALREADY_GRANTED': return { state: 'CONFLICT', message: MESSAGES.ALREADY, tone: 'info', grants: current };
    case 'GRANT_CHANGED': return { state: 'CONFLICT', message: MESSAGES.CHANGED, tone: 'info', grants: current };
    case 'NOT_REVOCABLE': return { state: 'REFUSED', message: MESSAGES.NOT_REVOCABLE, tone: 'error', grants: current };
    case 'SELF_CHANGE_NOT_ALLOWED': return { state: 'REFUSED', message: MESSAGES.SELF, tone: 'error' };
    case 'TARGET_NOT_ACTIVE': return { state: 'REFUSED', message: MESSAGES.INACTIVE, tone: 'error' };
    case 'NOT_AUTHORIZED':
    case 'USER_NOT_ACTIVE': return { state: 'NOT_ADMIN', message: MESSAGES.NOT_ADMIN, tone: 'error' };
    case 'NOT_AUTHENTICATED': return { state: 'NOT_ADMIN', message: MESSAGES.SIGNED_OUT, tone: 'error' };
    default:
      if (status >= 500) return { state: 'UNKNOWN', message: MESSAGES.NOT_CONFIRMED, tone: 'error' };
      return { state: 'REFUSED', message: MESSAGES.REJECTED, tone: 'error' };
  }
}

// Validates the add form before anything is sent.
// values: { permission, programId }, grantable: [{ permission, scopeType }]
export function validateAdd(values, grantable) {
  const rule = grantable.find((g) => g.permission === values.permission);
  if (!rule) return { ok: false, field: 'permission', message: MESSAGES.CHOOSE_PERMISSION };
  if (rule.scopeType === 'PROGRAM') {
    const programId = Number(values.programId);
    if (!Number.isSafeInteger(programId) || programId <= 0) {
      return { ok: false, field: 'program', message: MESSAGES.CHOOSE_PROGRAM };
    }
    return { ok: true, body: { permission: rule.permission, programId } };
  }
  return { ok: true, body: { permission: rule.permission } };
}
