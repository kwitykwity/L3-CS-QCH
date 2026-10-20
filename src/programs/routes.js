// HTTP routes for Program maintenance, slice 14A (Trello card 14).
//
//   GET   /api/program-management/programs/:programId
//         200 { program }  (includes `version` to send back with a change)
//   PATCH /api/program-management/programs/:programId
//         body: { version, site?, description?, eligibilityNotes?,
//                 scheduleNotes?, costNotes? }   (null or "" clears a field)
//         200 { status: "UPDATED", program }
//   POST  /api/program-management/programs/:programId/discontinue  body: { version }
//   POST  /api/program-management/programs/:programId/reactivate   body: { version }
//         200 { status: "DISCONTINUED" | "REACTIVATED", program }
//
//   400 INVALID_REQUEST | UNEXPECTED_FIELD   401 NOT_AUTHENTICATED
//   403 USER_NOT_ACTIVE | NOT_AUTHORIZED     404 PROGRAM_NOT_FOUND
//   409 PROGRAM_CHANGED (with `current`) | NO_CHANGE | PROGRAM_RETIRED |
//       ALREADY_IN_STATUS | DEPARTMENT_NOT_ACTIVE
//
// Identity comes only from resolveIdentity(req) (PRD 3.2). No route
// accepts query parameters; any query string is a fixed 400 that does not
// echo the parameter (PRD 10.3, 10.4). Responses are never cached (5.5).

import { randomUUID } from 'node:crypto';
import express from 'express';
import { assertDemoGrantsAllowed } from '../authorization/referralAccess.js';
import { ProgramError, programErrors } from './errors.js';
import { createProgramService } from './programService.js';
import { MAX_BODY_BYTES } from './validateProgramChange.js';

const POSITIVE_INT = /^[1-9][0-9]{0,15}$/;

function toId(text) {
  if (typeof text !== 'string' || !POSITIVE_INT.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

export function createProgramRouter({ store, resolveIdentity, allowDemoGrants = false, nodeEnv }) {
  assertDemoGrantsAllowed(allowDemoGrants, nodeEnv);
  const router = express.Router();
  const service = store ? createProgramService({ store, allowDemoGrants }) : null;

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.use((req, res, next) => {
    const identity = resolveIdentity ? resolveIdentity(req) : null;
    if (!identity || !Number.isSafeInteger(identity.userId)) {
      return next(programErrors.notAuthenticated());
    }
    if (!service) return next(programErrors.storeUnavailable());
    if (Object.keys(req.query ?? {}).length > 0) return next(programErrors.unexpectedField());
    req.userId = identity.userId;
    // Non-sensitive ID linking this request to its audit event (PRD 10.6).
    req.correlationId = randomUUID();
    next();
  });

  router.use(express.json({ limit: MAX_BODY_BYTES }));

  function programIdOf(req) {
    const programId = toId(req.params.programId);
    if (programId === null) throw programErrors.programNotFound();
    return programId;
  }

  router.get('/programs/:programId', async (req, res) => {
    res.json(await service.getProgram(req.userId, programIdOf(req)));
  });

  router.patch('/programs/:programId', async (req, res) => {
    res.json(await service.updateDetails(req.userId, programIdOf(req), req.body, {
      correlationId: req.correlationId,
    }));
  });

  router.post('/programs/:programId/discontinue', async (req, res) => {
    res.json(await service.discontinue(req.userId, programIdOf(req), req.body, {
      correlationId: req.correlationId,
    }));
  });

  router.post('/programs/:programId/reactivate', async (req, res) => {
    res.json(await service.reactivate(req.userId, programIdOf(req), req.body, {
      correlationId: req.correlationId,
    }));
  });

  router.use((err, req, res, next) => {
    if (err instanceof ProgramError) {
      const body = { error: err.message, code: err.code };
      if (err.fields) body.fields = err.fields;
      if (err.current) body.current = err.current;
      return res.status(err.status).json(body);
    }
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      const e = programErrors.invalidRequest();
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    return next(err);
  });

  return router;
}
