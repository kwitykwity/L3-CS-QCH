// Page position for referral lists (PRD 9.9).
//
// Lists are ordered newest first by (createdAt DESC, referralId DESC). The
// referralId makes the order total, so rows created in the same instant
// still have one fixed order. A cursor is the position of the last row on
// a page; the next page holds the rows strictly after it. This is keyset
// pagination: no row is skipped or repeated when new referrals arrive
// between pages, because new referrals sort before the cursor.
//
// A cursor is only a position. It carries no identity, scope, filter or
// permission, and authorization is checked again on every page, so a
// cursor copied from someone else (or edited) can never show a referral
// the caller is not allowed to see. It contains no participant data.
//
// Format: base64url of JSON [createdAt, referralId]. createdAt is the
// exact text the store returned (see the store contract), so comparisons
// never lose precision.

const MAX_CURSOR_LENGTH = 120;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
// UTC timestamp with 0 to 7 fractional digits (SQL datetime2 precision).
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$/;

export function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.createdAt, row.referralId]), 'utf8').toString('base64url');
}

// Returns { createdAt, referralId }, or null for anything that is not a
// cursor this server could have produced.
export function decodeCursor(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_CURSOR_LENGTH || !BASE64URL.test(text)) {
    return null;
  }
  let value;
  try {
    value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [createdAt, referralId] = value;
  if (typeof createdAt !== 'string' || !UTC_TIMESTAMP.test(createdAt)) return null;
  if (!Number.isSafeInteger(referralId) || referralId <= 0) return null;
  return { createdAt, referralId };
}
