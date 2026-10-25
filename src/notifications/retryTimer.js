// Runs notifier.retryPendingDeliveries() on a fixed interval (Task E;
// Final Technical PRD 11.6).
//
// - One run at a time: if a run is still going when the next tick comes,
//   that tick is skipped, so runs never overlap and never pile up.
// - Never throws: retryPendingDeliveries() never rejects, and anything
//   unexpected is caught and logged by kind only (PRD 15.3).
// - The timer does not keep the process alive on its own (unref), and
//   stop() ends it.
// - Bounded and duplicate-safe retries are the notification service's job
//   (maxAttempts, attempt ownership); this only decides when it runs.

import { safeErrorKind } from './errors.js';

const defaultTimers = Object.freeze({
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
});

export function startNotificationRetries({
  notifier,
  intervalMs = 60_000,
  logger = console,
  timers = defaultTimers,
} = {}) {
  if (!notifier || typeof notifier.retryPendingDeliveries !== 'function') {
    throw new Error('startNotificationRetries needs a notifier');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 1) throw new Error('intervalMs must be a positive integer');

  let running = null;

  async function runOnce() {
    if (running) return running;
    running = (async () => {
      try {
        return await notifier.retryPendingDeliveries();
      } catch (err) {
        logger.error(`[notification] event=retry_run_failed error=${safeErrorKind(err)}`);
        return null;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  const handle = timers.setInterval(() => { runOnce(); }, intervalMs);
  handle?.unref?.();

  return Object.freeze({
    // For tests and shutdown: run now (or join the run in progress).
    runOnce,
    stop() { timers.clearInterval(handle); },
  });
}
