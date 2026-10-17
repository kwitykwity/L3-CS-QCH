// Notification failure categories (PRD 11.5, 11.6).
//
// A category is the only failure detail ever stored or logged. It never
// holds message content, a recipient address, or a provider error message,
// any of which could carry PII or secrets (PRD 15.3).
//
// Stored in dbo.notification_deliveries.failure_category.

export const FAILURE_CATEGORIES = Object.freeze({
  // The receiving Program has no notification email configured.
  NO_RECIPIENT: 'NO_RECIPIENT',
  // The sender asked us to slow down (HTTP 429). Retried.
  THROTTLED: 'THROTTLED',
  // The sender could not be reached or had a server error (5xx, network). Retried.
  UNAVAILABLE: 'UNAVAILABLE',
  // The sender rejected our credentials or permissions (401, 403). Not retried.
  AUTH_FAILED: 'AUTH_FAILED',
  // The sender rejected the request itself (other 4xx). Not retried.
  REJECTED: 'REJECTED',
  // Anything we could not classify. Not retried.
  UNKNOWN: 'UNKNOWN',
});

const TRANSIENT = new Set([FAILURE_CATEGORIES.THROTTLED, FAILURE_CATEGORIES.UNAVAILABLE]);

export function isTransient(category) {
  return TRANSIENT.has(category);
}

// Thrown by a sender when a message was not delivered.
// `message` is fixed per category, never the provider's text.
export class NotificationSendError extends Error {
  constructor(category) {
    const known = Object.values(FAILURE_CATEGORIES).includes(category);
    const safeCategory = known ? category : FAILURE_CATEGORIES.UNKNOWN;
    super(`Notification send failed: ${safeCategory}`);
    this.name = 'NotificationSendError';
    this.category = safeCategory;
  }
}

// Maps an HTTP status from the mail provider to a category. The Microsoft
// Graph sender (added once QCH IT provides the shared mailbox) uses this.
export function categoryForHttpStatus(status) {
  if (status === 429) return FAILURE_CATEGORIES.THROTTLED;
  if (status === 401 || status === 403) return FAILURE_CATEGORIES.AUTH_FAILED;
  if (Number.isInteger(status) && status >= 500 && status <= 599) return FAILURE_CATEGORIES.UNAVAILABLE;
  if (Number.isInteger(status) && status >= 400 && status <= 499) return FAILURE_CATEGORIES.REJECTED;
  return FAILURE_CATEGORIES.UNKNOWN;
}

// Turns anything a sender throws into a category. A plain Error, a
// provider SDK error, or a non-Error value all become UNKNOWN unless the
// sender classified it with NotificationSendError.
export function categoryForError(err) {
  return err instanceof NotificationSendError ? err.category : FAILURE_CATEGORIES.UNKNOWN;
}
