import { config } from './config.js';
import { createApp } from './app.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(
    `QCH Connect listening on http://localhost:${config.port} (${config.nodeEnv})`,
  );
});
