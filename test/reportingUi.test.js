import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { createApp } from '../src/app.js';

test('Reporting Center UI route static serving', async () => {
  const app = createApp();
  const client = supertest(app);

  const res = await client.get('/reporting/').expect(200);
  assert.match(res.text, /<title>QCH Connect - Reporting Center<\/title>/);
  assert.match(res.text, /Reporting Center/);
});

test('Reporting Center UI script serving', async () => {
  const app = createApp();
  const client = supertest(app);

  const res = await client.get('/reporting/app.js').expect(200);
  assert.match(res.text, /QCH Reporting Center - Frontend Application/);
  assert.match(res.text, /\/api\/reports\/referral-activity/);
});
