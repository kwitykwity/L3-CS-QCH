// Trello Task 221: development-only wording stays out of production pages
// (Handoff PRD §34 environment separation). SYNTHETIC data only.
//
// Starts each real server process, as a person would:
//   - NODE_ENV=production npm start: /, /referral/ and /reporting/ must not
//     say "Development build" (verified defect before this task);
//   - npm run dev:synthetic and npm run dev:demo (NODE_ENV=development):
//     the same pages still carry the synthetic-data notice.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_NOTICE_TEXT, withDevNotice } from '../scripts/devNotice.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['/', '/referral/', '/reporting/'];
const DEV_WORDING = /development build/i;
// The notice on each page, with the page's own style class.
const NOTICE = {
  '/': `<p class="note">${DEV_NOTICE_TEXT}</p>`,
  '/referral/': `<p class="footnote">${DEV_NOTICE_TEXT}</p>`,
  '/reporting/': `<p class="help">${DEV_NOTICE_TEXT}</p>`,
};

async function start(script, nodeEnv, extraEnv = {}) {
  const port = String(36000 + Math.floor(Math.random() * 900));
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: nodeEnv, PORT: port, DOTENV_CONFIG_PATH: '/nonexistent', ...extraEnv },
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${script} did not start`)), 10000);
    child.stdout.on('data', (d) => {
      if (/listening on|SYNTHETIC DATA ONLY/.test(String(d))) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`${script} exited ${code}: ${stderr}`)); });
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function stop({ child }) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
}

async function page(base, pagePath, headers = {}) {
  const res = await fetch(`${base}${pagePath}`, { headers, redirect: 'manual' });
  assert.equal(res.status, 200, `${pagePath} -> ${res.status}`);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  return res.text();
}

describe('Task 221: development-only wording and environment separation', () => {
  test('production (NODE_ENV=production npm start): /, /referral/ and /reporting/ do not say "Development build"', async (t) => {
    const server = await start('src/server.js', 'production');
    t.after(() => stop(server));
    for (const pagePath of PAGES) {
      const html = await page(server.base, pagePath);
      assert.match(html, /<h1/, `${pagePath} is the real page`);
      assert.doesNotMatch(html, DEV_WORDING, pagePath);
      assert.ok(!html.includes(DEV_NOTICE_TEXT), pagePath);
      assert.doesNotMatch(html, /use synthetic data only/i, pagePath);
    }
  });

  test('development (npm run dev:synthetic): the same pages still show the synthetic-data notice', async (t) => {
    const server = await start('scripts/dev-synthetic-server.js', 'development');
    t.after(() => stop(server));
    for (const pagePath of PAGES) {
      const html = await page(server.base, pagePath);
      assert.ok(html.includes(NOTICE[pagePath]), `${pagePath} has the notice`);
      assert.ok(!html.includes('qch:dev-notice'), `${pagePath}: no placeholder left`);
    }
  });

  test('demo (npm run dev:demo): signed-in pages show the notice as well as the demo sign-in banner', async (t) => {
    const server = await start('scripts/dev-demo-server.js', 'development');
    t.after(() => stop(server));
    const signIn = await fetch(`${server.base}/demo/api/sign-in`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person: 'referring-worker' }),
    });
    assert.equal(signIn.status, 200);
    const cookie = signIn.headers.get('set-cookie').split(';')[0];
    for (const pagePath of PAGES) {
      const html = await page(server.base, pagePath, { cookie });
      assert.ok(html.includes(NOTICE[pagePath]), `${pagePath} has the notice`);
      assert.ok(html.includes('<script src="/demo/banner.js"></script>'), `${pagePath} has the demo banner`);
      assert.ok(!html.includes('qch:dev-notice'), `${pagePath}: no placeholder left`);
    }
  });

  test('the placeholder becomes the notice, with the page class; text without one is unchanged', () => {
    assert.equal(withDevNotice('<main><!-- qch:dev-notice class="footnote" --></main>'),
      `<main><p class="footnote">${DEV_NOTICE_TEXT}</p></main>`);
    assert.equal(withDevNotice('<!-- qch:dev-notice -->'), `<p>${DEV_NOTICE_TEXT}</p>`);
    assert.equal(withDevNotice('<p>Aggregate reporting only.</p>'), '<p>Aggregate reporting only.</p>');
  });
});
