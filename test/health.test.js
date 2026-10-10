'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../src/app');

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await once(server, 'close');
});

test('GET /health returns 200 with availability only', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('responses are not cacheable and do not advertise the framework', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('/health does not accept state-changing methods', async () => {
  const res = await fetch(`${baseUrl}/health`, { method: 'POST' });
  assert.notEqual(res.status, 200);
});

test('static frontend is served', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(await res.text(), /QCH Connect/);

  for (const asset of ['/css/styles.css', '/js/app.js']) {
    assert.equal((await fetch(`${baseUrl}${asset}`)).status, 200, `${asset} should be served`);
  }
});

test('unknown routes return 404', async () => {
  const res = await fetch(`${baseUrl}/does-not-exist`);
  assert.equal(res.status, 404);
});
