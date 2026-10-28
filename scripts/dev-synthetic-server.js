// LOCAL DEVELOPMENT ONLY: runs QCH Connect with an in-memory store full of
// SYNTHETIC data and one fixed synthetic developer identity, so the
// Direct Referral page can be used against the real backend code before
// Entra sign-in and Azure SQL exist.
//
//   npm run dev:synthetic     then open http://127.0.0.1:3000/referral/
//
// Safety (PRD 15.5, 16.1, 16.2, 17.4, 18.5):
// - Refuses to start unless NODE_ENV is exactly "development" (fail closed).
// - Listens on 127.0.0.1 only, so it is not reachable from other machines.
// - Data lives in memory and disappears when the process stops.
// - By default one fixed synthetic identity is used. With QCH_DEMO_SIGN_IN=true
//   (npm run dev:demo) the demo sign-in from PRD 16.1 is used instead: see
//   scripts/demoSignIn.js (Task O).
// - New-referral notifications (Task E) go to the simulated outbox, kept
//   in memory: no email is sent and no mailbox is used. The outbox refuses
//   to start outside development and test. Each delivery is logged as a
//   [notification] line with IDs and the outcome only.

import 'dotenv/config';
import express from 'express';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createNotificationService } from '../src/notifications/notificationService.js';
import { startNotificationRetries } from '../src/notifications/retryTimer.js';
import { createSimulatedOutboxSender } from '../src/notifications/simulatedOutbox.js';
import { DEV_USER_ID, syntheticSeed } from './syntheticSeed.js';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(`dev:synthetic failed to start: ${err.message}`);
  process.exit(1);
}

if (config.nodeEnv !== 'development') {
  console.error('dev:synthetic runs only when NODE_ENV=development. Refusing to start.');
  process.exit(1);
}

// Demo sign-in mode (Task O): QCH_DEMO_SIGN_IN=true (npm run dev:demo). People
// sign in as synthetic demo personas and can switch; nobody is signed in
// until they choose. Without it, the one fixed developer identity is used.
const demoMode = process.env.QCH_DEMO_SIGN_IN === 'true';
let demoSignIn = null;
let seed = syntheticSeed({ programManagement: true, organizationManagement: true, receiving: true });
if (demoMode) {
  const { createDemoSignIn } = await import('./demoSignIn.js');
  const { withDemoPeople } = await import('./demoPersonas.js');
  demoSignIn = createDemoSignIn({ nodeEnv: config.nodeEnv }); // throws unless development
  seed = withDemoPeople(seed);
}
const store = createMemoryReferralStore(seed);
if (process.env.QCH_TASK_C_SYNTHETIC_DEMO === 'true') {
  const { seedSyntheticProgramInformation } = await import('./syntheticProgramInformation.js');
  await seedSyntheticProgramInformation(store, DEV_USER_ID);
}
const notifier = createNotificationService({
  store: store.notificationStore,
  sender: createSimulatedOutboxSender({ nodeEnv: config.nodeEnv }),
});
startNotificationRetries({ notifier });
const app = createApp({
  affiliationStore: store,
  referralStore: store,
  resolveIdentity: demoSignIn ? demoSignIn.resolveIdentity : () => ({ userId: DEV_USER_ID }),
  notifier,
});

let server = app;
if (demoSignIn) {
  server = express();
  demoSignIn.mount(server);
  server.use(app);
}

server.listen(config.port, '127.0.0.1', () => {
  console.log(`QCH Connect (LOCAL DEV, SYNTHETIC DATA ONLY) on http://127.0.0.1:${config.port}/${demoSignIn ? 'demo/' : 'referral/'}`);
});
