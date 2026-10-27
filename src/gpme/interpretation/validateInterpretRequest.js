// Validation for POST /api/gpme/interpret (Task D; PRD 5.4, 10.3, 10.7).
//
// One allowed field: `text`, the staff member's short description. It is
// matching help only. It is not Referral Context or Notes, is never
// stored, logged, or sent anywhere, and is never part of a referral.
// Errors name the field only, never its value (PRD 10.4).

export const MAX_DESCRIPTION_CHARS = 500;
// 500 characters at up to 6 bytes each (a JSON unicode escape), plus JSON overhead.
export const MAX_INTERPRET_BODY_BYTES = 3 * 1024 + 256;

export function validateInterpretRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, fields: [] };
  if (Object.keys(body).some((key) => key !== 'text')) return { ok: false, unexpectedField: true };
  const { text } = body;
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_DESCRIPTION_CHARS) {
    return { ok: false, fields: ['text'] };
  }
  return { ok: true, value: { text } };
}
