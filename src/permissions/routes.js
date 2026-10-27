// HTTP routes for permission administration (Trello Task Y, PRD 3.8).
// Mounted at /api/permissions. ADMINISTER_PERMISSIONS (ORG scope) only.
//
//   GET  /overview
//        200 { users: [{ userId, displayName, isActive, isYou }],
//              programs: [{ programId, name, site, departmentName, lifecycleStatus }],
//              grantable: [{ permission, label, scopeType }] }
//   GET  /users/:userId/grants
//        200 { user, canChange, grants: [{ grantId, permission, label, scopeType,
//              programId, programName, programSite, grantSource, grantedAt, revocable }] }
//   POST /users/:userId/grants                    { permission, programId? }
//        201 { status: "GRANTED", grant, grants }
//   POST /users/:userId/grants/:grantId/revoke     (empty body)
//        200 { status: "REVOKED", grants }
//
//   400 INVALID_REQUEST | UNEXPECTED_FIELD   401 NOT_AUTHENTICATED
//   403 USER_NOT_ACTIVE | NOT_AUTHORIZED | SELF_CHANGE_NOT_ALLOWED | NOT_REVOCABLE
//   404 USER_NOT_FOUND
//   409 TARGET_NOT_ACTIVE | ALREADY_GRANTED | GRANT_CHANGED (with `current`)
//
// Identity comes only from resolveIdentity(req) (PRD 3.2): nothing in the
// body, a header or the query says who is asking. No route accepts query
// parameters; any query string is a fixed 400 that does not echo it
// (PRD 10.3, 10.4). Responses are never cached (PRD 5.5).

import { randomUUID } from 'node:crypto';
import express from 'express';
import { assertDemoGrantsAllowed } from '../authorization/referralAccess.js';
import { PermissionError, permissionErrors } from './errors.js';
import { createPermissionService } from './permissionService.js';

const POSITIVE_INT = /^[1-9][0-9]{0,15}$/;
const MAX_BODY_BYTES = 1024;

function toId(text) {
  if (typeof text !== 'string' || !POSITIVE_INT.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

export function createPermissionRouter({ store, resolveIdentity, allowDemoGrants = false, nodeEnv }) {
  assertDemoGrantsAllowed(allowDemoGrants, nodeEnv);
  const router = express.Router();
  const service = store ? createPermissionService({ store, allowDemoGrants }) : null;

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.use((req, res, next) => {
    const identity = resolveIdentity ? resolveIdentity(req) : null;
    if (!identity || !Number.isSafeInteger(identity.userId)) return next(permissionErrors.notAuthenticated());
    if (!service) return next(permissionErrors.storeUnavailable());
    if (Object.keys(req.query ?? {}).length > 0) return next(permissionErrors.unexpectedField());
    req.userId = identity.userId;
    // Non-sensitive ID linking this request to its audit event (PRD 10.6).
    req.correlationId = randomUUID();
    next();
  });

  router.use(express.json({ limit: MAX_BODY_BYTES }));

  // A malformed user ID is "not found", the same answer as an unknown one.
  // The service checks the administrator first, so a non-administrator
  // gets 403 either way and learns nothing about who exists.
  const userIdOf = (req) => toId(req.params.userId) ?? 0;
  const opts = (req) => ({ correlationId: req.correlationId });

  router.get('/overview', async (req, res) => {
    res.json(await service.overview(req.userId));
  });

  router.get('/users/:userId/grants', async (req, res) => {
    res.json(await service.getUserGrants(req.userId, userIdOf(req)));
  });

  router.post('/users/:userId/grants', async (req, res) => {
    res.status(201).json(await service.grant(req.userId, userIdOf(req), req.body, opts(req)));
  });

  router.post('/users/:userId/grants/:grantId/revoke', async (req, res) => {
    const grantId = toId(req.params.grantId) ?? 0;
    res.json(await service.revoke(req.userId, userIdOf(req), grantId, req.body, opts(req)));
  });

  router.use((err, req, res, next) => {
    if (err instanceof PermissionError) {
      const body = { error: err.message, code: err.code };
      if (err.fields) body.fields = err.fields;
      if (err.current) body.current = err.current;
      return res.status(err.status).json(body);
    }
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      const e = permissionErrors.invalidRequest();
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    return next(err);
  });

  return router;
}
