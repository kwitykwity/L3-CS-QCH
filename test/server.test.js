import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const PORT = '34567';

function waitForListening(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(
      () => reject(new Error(`server did not start within ${timeoutMs}ms`)),
      timeoutMs,
    );

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes('listening on')) {
        clearTimeout(timer);
        resolve(stdout);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code}): ${stderr}`));
    });
  });
}

test('the server process starts and serves /health over HTTP', async (t) => {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => child.kill());

  const log = await waitForListening(child);
  assert.match(log, /listening on http:\/\/localhost:34567/);

  const response = await fetch(`http://localhost:${PORT}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});
