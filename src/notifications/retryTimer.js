// Runs notifier.retryPendingDeliveries() on a fixed interval (Task E;
// Final Technical PRD 11.6).
//
// - One run at a time: if a run is still going when the next tick comes,
//   that tick joins it instead of starting another, so runs never overlap
//   and never pile up.
// - The "run in progress" marker is set before the run can finish and is
//   cleared only by that same run, however it ends: resolved, rejected, or
//   a notifier that throws synchronously (review fix on #42). A failed run
//   never blocks the next one.
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

  // One run. Never rejects: a synchronous throw inside an async function
  // becomes a rejection, which is caught here.
  async function execute() {
    try {
      return await notifier.retryPendingDeliveries();
    } catch (err) {
      logger.error(`[notification] event=retry_run_failed error=${safeErrorKind(err)}`);
      return null;
    }
  }

  // Returns the run's promise (the same one to every caller while it is in
  // progress). The marker is assigned before the cleanup can run, because
  // .finally() callbacks always run on a later tick, and the cleanup only
  // clears the marker if it still points at this run.
  function runOnce() {
    if (running) return running;
    const run = execute().finally(() => {
      if (running === run) running = null;
    });
    running = run;
    return run;
  }

  const handle = timers.setInterval(() => { runOnce(); }, intervalMs);
  handle?.unref?.();

  return Object.freeze({
    // For tests and shutdown: run now (or join the run in progress).
    runOnce,
    stop() { timers.clearInterval(handle); },
  });
}
