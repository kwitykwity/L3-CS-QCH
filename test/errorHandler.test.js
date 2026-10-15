import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/errorHandler.js';

// Values that must never reach the client or the logs.
const SECRET_MESSAGE = 'db password=hunter2 for participant Jane Doe';
const LEAK_MARKERS = [
  'hunter2',
  'Jane Doe',
  'password',
  'stack',
  '    at ',            // stack-trace frame prefix
  'errorHandler.test',  // file path from a stack trace
  'node_modules',
];

// A small app with routes that fail on purpose, wired to the REAL handler.
function buildFailingApp() {
  const app = express();

  app.get('/sync-throw', () => {
    throw new Error(SECRET_MESSAGE);
  });

  app.get('/async-reject', async () => {
    throw new Error(SECRET_MESSAGE);
  });

  app.get('/client-error', () => {
    const err = new Error(SECRET_MESSAGE);
    err.status = 400;
    throw err;
  });

  app.get('/bogus-status', () => {
    const err = new Error(SECRET_MESSAGE);
    err.status = 200; // not an error status; must not be trusted
    throw err;
  });

  app.get('/headers-already-sent', (req, res, next) => {
    res.status(200).set('Content-Type', 'text/plain');
    res.write('partial');
    next(new Error(SECRET_MESSAGE));
  });

  app.use(errorHandler);
  return app;
}

function assertNoLeaks(text, where) {
  for (const marker of LEAK_MARKERS) {
    assert.ok(!text.includes(marker), `${where} must not contain "${marker}"`);
  }
}

function captureConsoleError(t) {
  const lines = [];
  t.mock.method(console, 'error', (...args) => {
    lines.push(args.map(String).join(' '));
  });
  return lines;
}

test('createApp registers the hardened error handler last', () => {
  const app = createApp();
  const layers = app.router.stack;
  assert.equal(layers.at(-1).handle, errorHandler);
});

test('a thrown error returns a generic 500 with no stack or internal details', async (t) => {
  const logs = captureConsoleError(t);
  const response = await request(buildFailingApp()).get('/sync-throw');

  assert.equal(response.status, 500);
  assert.match(response.headers['content-type'], /application\/json/);
  assert.deepEqual(response.body, { error: 'Internal Server Error' });
  assertNoLeaks(response.text, 'response body');

  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[error\] GET \/sync-throw -> 500 \(Error\)$/);
  assertNoLeaks(logs[0], 'log line');
});

test('a rejected async handler is caught the same way', async (t) => {
  const logs = captureConsoleError(t);
  const response = await request(buildFailingApp()).get('/async-reject');

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'Internal Server Error' });
  assertNoLeaks(response.text, 'response body');
  assertNoLeaks(logs.join('\n'), 'log line');
});

test('a 4xx error keeps its status but returns only the standard status text', async (t) => {
  captureConsoleError(t);
  const response = await request(buildFailingApp()).get('/client-error');

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Bad Request' });
  assertNoLeaks(response.text, 'response body');
});

test('a non-error status on an error is replaced with 500', async (t) => {
  captureConsoleError(t);
  const response = await request(buildFailingApp()).get('/bogus-status');

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'Internal Server Error' });
});

test('if headers were already sent, the connection is closed and nothing leaks', async (t) => {
  const logs = captureConsoleError(t);

  await assert.rejects(request(buildFailingApp()).get('/headers-already-sent'));

  assert.equal(logs.length, 1);
  assert.match(logs[0], /-> 500 \(Error\)$/);
  assertNoLeaks(logs[0], 'log line');
});
