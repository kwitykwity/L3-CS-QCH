// What the page does after "Save affiliation" (PRD 3.9, 9.4, 13.4).
//
// Pure function: no DOM access, so this module also runs under Node for
// tests. app.js applies the result.
//
// Result:
//   state       - SAVED | CHANGED_ELSEWHERE | NOT_SELECTABLE | FAILED
//   affiliation - the authoritative affiliation to show from now on, or
//                 null to keep the one already on the page
//   message     - text for the status area (replaces any earlier message)
//   tone        - 'success' | 'info' | 'error'
//   fieldError  - text for the affiliation field, or null

// response: { networkError: true } or { status, body } from
// PUT /api/me/affiliation.
export function interpretAffiliationSave(response) {
  if (response && !response.networkError) {
    const { status, body } = response;

    if (status === 200 && body?.status === 'SET' && body.program && typeof body.version === 'string') {
      return {
        state: 'SAVED',
        affiliation: body,
        message: `Your Program affiliation is saved: ${body.program.name}.`,
        tone: 'success',
        fieldError: null,
      };
    }

    if (status === 409 && body?.code === 'AFFILIATION_CHANGED' && body.current) {
      // Changed elsewhere (another tab or device). Nothing was saved. Show
      // the current affiliation and let the worker decide again.
      const now = body.current.program?.name;
      const message = now
        ? `Your affiliation was changed elsewhere and is now ${now}. Nothing was saved. Choose again if you want to change it.`
        : 'Your affiliation was changed elsewhere. Nothing was saved. Choose again.';
      return { state: 'CHANGED_ELSEWHERE', affiliation: body.current, message, tone: 'info', fieldError: message };
    }

    if (body?.code === 'PROGRAM_NOT_SELECTABLE') {
      const message = 'That Program cannot be selected. Choose another Program.';
      return { state: 'NOT_SELECTABLE', affiliation: null, message, tone: 'error', fieldError: message };
    }
  }

  const message = 'Your affiliation was not saved. Try again.';
  return { state: 'FAILED', affiliation: null, message, tone: 'error', fieldError: message };
}
