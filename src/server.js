import 'dotenv/config';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  // Fail closed: never start with missing or invalid configuration.
  console.error(`QCH Connect failed to start: ${err.message}`);
  process.exit(1);
}

// Production wiring uses only validated configuration (PRD 18.5). DEMO
// grants stay off here; createApp refuses them outside development/test.
const app = createApp({ nodeEnv: config.nodeEnv, allowDemoGrants: false });

app.listen(config.port, () => {
  console.log(
    `QCH Connect listening on http://localhost:${config.port} (${config.nodeEnv})`,
  );
});
