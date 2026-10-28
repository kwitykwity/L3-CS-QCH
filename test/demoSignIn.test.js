// Trello Task O: demo sign-in and identity switching (Final Technical PRD
// 16.1, 17.4). SYNTHETIC people and data only.
//
// Proves: the demo flow works end to end through the real backend; every
// permission still comes from the backend's grants; and production has no
// demo sign-in at all (fails closed).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryReferralStore } from '../src/referrals/memoryReferralStore.js';
import { createDemoSignIn, DEMO_LABEL } from '../scripts/demoSignIn.js';
import { DEMO_PERSONAS, withDemoPeople } from '../scripts/demoPersonas.js';
import { syntheticSeed } from '../scripts/syntheticSeed.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function demoServer() {
  const store = createMemoryReferralStore(withDemoPeople(syntheticSeed({ receiving: true })));
  const demo = createDemoSignIn({ nodeEnv: 'development' });
  const app = createApp({ affiliationStore: store, referralStore: store, resolveIdentity: demo.resolveIdentity });
  const server = express();
  demo.mount(server);
  server.use(app);
  return { server, store };
}

// A browser: keeps its own cookie, so two of them are two signed-in people.
function browser(server) {
  const agent = request.agent(server);
  return {
    agent,
    signInAs: (person) => agent.post('/demo/api/sign-in').send({ person }),
  };
}

const referral = (receivingProgramId) => ({
  submissionId: randomUUID(), receivingProgramId, participantName: 'Synthetic Demo Participant',
  contactMethod: 'NOT_AVAILABLE', referralContext: 'Synthetic need for the demo check',
});

describe('Task O demo sign-in: the demonstration works', () => {
  test('referring side creates a referral; receiving side answers it and records the outcome; the referrer sees the result', async () => {
    const { server } = demoServer();
    const referrer = browser(server);
    const receiver = browser(server);
    await referrer.signInAs('referring-worker');
    await receiver.signInAs('housing-receiver');

    const created = await referrer.agent.post('/api/referrals').send(referral(4));
    assert.equal(created.status, 201);
    const id = created.body.referral.referralId;

    // Referring side: status, awaiting response. Not a receiver for anything.
    const sent = await referrer.agent.get('/api/referrals/sent');
    assert.equal(sent.body.referrals.length, 1);
    assert.equal((await referrer.agent.get('/api/referrals/received?programId=4')).status, 403);

    // Receiving side: the queue shows it; respond; record the outcome.
    const queue = await receiver.agent.get('/api/referrals/received?programId=4');
    assert.equal(queue.status, 200);
    assert.equal(queue.body.referrals.length, 1);
    assert.equal((await receiver.agent.post(`/api/referrals/${id}/response`).send({ decision: 'ACCEPTED' })).status, 200);
    assert.equal((await receiver.agent.post(`/api/referrals/${id}/outcome`).send({ outcome: 'RESULTED_IN_SERVICE' })).status, 200);

    // The referring side now sees the result.
    const after = await referrer.agent.get('/api/referrals/sent');
    assert.match(JSON.stringify(after.body), /RESULTED_IN_SERVICE/);
  });

  test('Program authorization: a receiver for another Program cannot see or answer the referral', async () => {
    const { server } = demoServer();
    const referrer = browser(server);
    const housing = browser(server);
    const wellness = browser(server);
    await referrer.signInAs('referring-worker');
    await housing.signInAs('housing-receiver');
    await wellness.signInAs('wellness-receiver');
    const id = (await referrer.agent.post('/api/referrals').send(referral(4))).body.referral.referralId;

    assert.equal((await wellness.agent.get('/api/referrals/received?programId=4')).status, 403);
    assert.equal((await wellness.agent.get(`/api/referrals/${id}`)).status, 404);
    assert.equal((await wellness.agent.post(`/api/referrals/${id}/response`).send({ decision: 'ACCEPTED' })).status, 404);
    assert.equal((await housing.agent.get(`/api/referrals/${id}`)).status, 200);
  });

  test('switching person changes who the backend sees, on the same browser', async () => {
    const { server } = demoServer();
    const b = browser(server);
    await b.signInAs('referring-worker');
    assert.equal((await b.agent.get('/api/referrals/received?programId=4')).status, 403);
    await b.signInAs('housing-receiver');
    assert.equal((await b.agent.get('/api/referrals/received?programId=4')).status, 200);
    assert.equal((await b.agent.get('/demo/api/people')).body.current.key, 'housing-receiver');
  });
});

describe('Task O demo sign-in: guardrails', () => {
  test('signed out: the API answers 401 and pages go to the demo sign-in', async () => {
    const { server } = demoServer();
    assert.equal((await request(server).get('/api/referrals/sent')).status, 401);
    assert.equal((await request(server).get('/api/me/affiliation')).status, 401);
    const page = await request(server).get('/referral/');
    assert.equal(page.status, 302);
    assert.equal(page.headers.location, '/demo/');
  });

  test('identity comes only from the server-side session: headers, query, body and made-up cookies grant nothing', async () => {
    const { server } = demoServer();
    const res = await request(server).get('/api/referrals/sent?userId=12')
      .set('X-User-Id', '12').set('X-Demo-User', 'housing-receiver')
      .set('Cookie', 'qch_demo_session=00000000000000000000000000000000; userId=12');
    assert.equal(res.status, 401);
    const bad = await request(server).post('/demo/api/sign-in').send({ person: '12' });
    assert.equal(bad.status, 400);
    assert.equal((await request(server).post('/demo/api/sign-in').send({ person: 'constructor' })).status, 400);
    assert.equal((await request(server).post('/demo/api/sign-in').type('form').send('person=housing-receiver')).status, 400);
  });

  test('sign-out ends the session', async () => {
    const { server } = demoServer();
    const b = browser(server);
    await b.signInAs('referring-worker');
    assert.equal((await b.agent.get('/api/referrals/sent')).status, 200);
    await b.agent.post('/demo/api/sign-out');
    assert.equal((await b.agent.get('/api/referrals/sent')).status, 401);
  });

  test('the session cookie is HttpOnly and SameSite=Strict, and carries no user ID', async () => {
    const { server } = demoServer();
    const res = await request(server).post('/demo/api/sign-in').send({ person: 'referring-worker' });
    const cookie = res.headers['set-cookie'][0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /^qch_demo_session=[0-9a-f]{32};/);
  });

  test('the demo label is on the sign-in page and on every app page, which still show their content', async () => {
    const { server } = demoServer();
    const b = browser(server);
    assert.ok((await b.agent.get('/demo/')).text.includes(DEMO_LABEL));
    await b.signInAs('referring-worker');
    for (const url of ['/', '/referral/', '/sent/', '/receiving/', '/reporting/', '/program-management/']) {
      const page = await b.agent.get(url);
      assert.equal(page.status, 200, url);
      assert.ok(page.text.includes('<script src="/demo/banner.js"></script>'), url);
      assert.equal(page.headers['cache-control'], 'no-store');
    }
    assert.ok(readFileSync(path.join(ROOT, 'scripts/demo-sign-in/banner.js'), 'utf8').includes(DEMO_LABEL));
  });

  test('page serving cannot be walked out of public/', async () => {
    const { server } = demoServer();
    const b = browser(server);
    await b.signInAs('referring-worker');
    for (const url of ['/..%2fpackage.json', '/%2e%2e/package.json', '/.env', '/package.json', '/..%2fsrc%2fserver.js']) {
      const res = await b.agent.get(url);
      assert.ok(res.status === 404 || res.status === 400, `${url} -> ${res.status}`);
      assert.ok(!res.text.includes('"name"'), url);
    }
  });

  test('the demo people are synthetic, marked "(demo)", and hold receiving grants only: no management, admin or underlying-referral rights', () => {
    const seed = withDemoPeople(syntheticSeed({ receiving: true }));
    const demoIds = new Set(DEMO_PERSONAS.map((p) => p.userId));
    for (const g of seed.grants.filter((x) => demoIds.has(x.userId))) {
      assert.equal(g.grantSource, 'IN_APP');
      assert.equal(g.scopeType, 'PROGRAM');
      assert.ok(!/MANAGE|ADMINISTER|UNDERLYING/.test(g.permission), g.permission);
    }
    for (const p of DEMO_PERSONAS) assert.match(p.displayName, /\(demo\)$/);
  });
});

describe('Task O demo sign-in: production rejects it (fail closed)', () => {
  test('it cannot be created outside development', () => {
    for (const nodeEnv of ['production', 'test', 'Development', 'staging', '', undefined, null]) {
      assert.throws(() => createDemoSignIn({ nodeEnv }), /development/, String(nodeEnv));
    }
    assert.throws(() => createDemoSignIn(), /development/);
  });

  test('production source has no demo sign-in code, route or import', () => {
    const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
    for (const file of [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'public'))]) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /demoSignIn|demoPersonas|qch_demo_session|\/demo\//i, file);
    }
  });

  test('the production server rejects the demo path: no pages, no sign-in, no cookie accepted', async () => {
    const port = String(34900 + Math.floor(Math.random() * 90));
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: port, QCH_DEMO_SIGN_IN: 'true', DOTENV_CONFIG_PATH: '/nonexistent' },
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
        child.stdout.on('data', (d) => { if (String(d).includes('listening on')) { clearTimeout(timer); resolve(); } });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`exited ${code}`)); });
      });
      const base = `http://127.0.0.1:${port}`;
      for (const [method, url, body] of [
        ['GET', '/demo/'], ['GET', '/demo/banner.js'], ['GET', '/demo/api/people'],
        ['POST', '/demo/api/sign-in', { person: 'housing-receiver' }],
      ]) {
        const res = await fetch(base + url, {
          method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
        });
        assert.equal(res.status, 404, `${method} ${url}`);
      }
      const page = await (await fetch(`${base}/`)).text();
      assert.ok(!page.includes('demo/banner.js'));
      for (const headers of [{ Cookie: 'qch_demo_session=00000000000000000000000000000000' }, { 'X-User-Id': '12' }]) {
        assert.equal((await fetch(`${base}/api/referrals/sent`, { headers })).status, 401);
      }
    } finally {
      child.kill();
    }
  });

  test('the demo server itself refuses to start outside development, even with demo sign-in requested', async () => {
    const { spawnSync } = await import('node:child_process');
    for (const nodeEnv of ['production', 'test', 'staging', 'Development']) {
      const result = spawnSync(process.execPath, ['scripts/dev-demo-server.js'], {
        cwd: ROOT, env: { PATH: process.env.PATH, NODE_ENV: nodeEnv, PORT: '3996', DOTENV_CONFIG_PATH: '/nonexistent' }, timeout: 5000, encoding: 'utf8',
      });
      assert.equal(result.status, 1, nodeEnv);
    }
  });
});
