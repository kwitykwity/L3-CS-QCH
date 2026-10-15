import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

test('GET /health returns 200 and exactly { status: "ok" }', async () => {
  const response = await request(app).get('/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('GET /health exposes no secrets, config, or error details', async () => {
  const response = await request(app).get('/health');
  const payload = JSON.stringify(response.body).toLowerCase();

  const forbidden = [
    'secret',
    'password',
    'token',
    'connection',
    'database_url',
    'tenant',
    'client_id',
    'key_vault',
    'keyvault',
    'mailbox',
    'provided_by_qch_it',
    'stack',
    'node_env',
    'nodeenv',
    'env',
  ];

  for (const term of forbidden) {
    assert.ok(
      !payload.includes(term),
      `/health response must not contain "${term}"`,
    );
  }
});

test('GET /health does not advertise the server framework', async () => {
  const response = await request(app).get('/health');

  assert.equal(response.headers['x-powered-by'], undefined);
});
