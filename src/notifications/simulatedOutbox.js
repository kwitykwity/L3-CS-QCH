// Simulated notification outbox for development, tests, and demos only
// (PRD 16.4, Plan B). Messages are kept in memory instead of being emailed.
// It holds no shared-mailbox credentials and talks to no outside service.
//
// It fails closed: it refuses to start unless NODE_ENV is exactly
// 'development' or 'test', so it can never stand in for real email in
// production.
//
// Sender contract (the Microsoft Graph sender must meet it too):
//   send({ to, subject, body }) -> resolves when the message is accepted,
//   throws NotificationSendError(category) when it is not.

const ALLOWED_ENVS = Object.freeze(['development', 'test']);

export function createSimulatedOutboxSender({ nodeEnv } = {}) {
  if (!ALLOWED_ENVS.includes(nodeEnv)) {
    throw new Error(`The simulated outbox runs only when NODE_ENV is ${ALLOWED_ENVS.join(' or ')}`);
  }

  const messages = [];

  return {
    async send({ to, subject, body }) {
      messages.push(Object.freeze({ to, subject, body, acceptedAt: new Date() }));
    },

    list() {
      return messages.slice();
    },

    clear() {
      messages.length = 0;
    },
  };
}
