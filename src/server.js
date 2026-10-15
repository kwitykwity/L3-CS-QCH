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

const app = createApp();

app.listen(config.port, () => {
  console.log(
    `QCH Connect listening on http://localhost:${config.port} (${config.nodeEnv})`,
  );
});
