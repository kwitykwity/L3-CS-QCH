'use strict';

const { loadConfig, ConfigError } = require('./config');
const { createApp } = require('./app');

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    // Fail closed: do not start with invalid configuration (PRD 18.5).
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

createApp().listen(config.port, () => {
  console.log(`QCH Connect listening on port ${config.port} (APP_ENV=${config.appEnv})`);
});
