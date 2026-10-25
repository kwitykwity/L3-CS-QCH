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
// - This is NOT the demo sign-in from PRD 16.1; that is a separate card.
//   The fixed identity here exists only inside this script.

import 'dotenv/config';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
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

const store = createMemoryReferralStore(syntheticSeed({ programManagement: true, organizationManagement: true, receiving: true }));
if (process.env.QCH_TASK_C_SYNTHETIC_DEMO === 'true') {
  const { seedSyntheticProgramInformation } = await import('./syntheticProgramInformation.js');
  await seedSyntheticProgramInformation(store, DEV_USER_ID);
}
const app = createApp({
  affiliationStore: store,
  referralStore: store,
  resolveIdentity: () => ({ userId: DEV_USER_ID }),
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`QCH Connect (LOCAL DEV, SYNTHETIC DATA ONLY) on http://127.0.0.1:${config.port}/referral/`);
});
