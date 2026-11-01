// NON-PRODUCTION demo sign-in and identity switching (Task O, PRD 16.1, 17.4).
//
// Lets the team sign in as one of a few SYNTHETIC people and switch between
// them, so both sides of the referral workflow can be shown on one laptop.
// Production uses Microsoft Entra sign-in only (PRD 3.1, 16.1).
//
// How it stays safe:
// - Lives in scripts/, which production source may not import. The production
//   server (src/server.js) contains no demo sign-in code and no route for it.
// - createDemoSignIn() refuses to build unless nodeEnv is exactly
//   "development" (fail closed: unset, production, test, staging all throw).
// - It only supplies resolveIdentity(req) -> { userId }, the same contract
//   Entra sign-in will fill. Every permission is still decided by the backend
//   from that identity's grants; nothing here grants anything.
// - The browser holds only a random session token in an HttpOnly cookie. The
//   token-to-person table is in server memory, so restarting the demo
//   (the documented reset) signs everyone out.
// - No passwords, no credentials, no header or body can name a user ID.

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { withDevNotice } from './devNotice.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { DEMO_PERSONAS } from './demoPersonas.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, 'demo-sign-in');
const PUBLIC_DIR = path.join(HERE, '..', 'public');

export const DEMO_LABEL = 'Demo sign-in. Production uses QCH Microsoft sign-in.';
const COOKIE = 'qch_demo_session';
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
// Page paths this module will serve: lowercase-safe segments, optional
// trailing .html. No dots otherwise, so nothing can walk out of public/.
const PAGE_PATH = /^\/(?:[A-Za-z0-9_-]+\/)*(?:[A-Za-z0-9_-]+\.html)?$/;

export function createDemoSignIn({ nodeEnv } = {}) {
  if (nodeEnv !== 'development') {
    throw new Error('Demo sign-in can only be created when NODE_ENV is development');
  }

  const sessions = new Map(); // token -> persona

  const tokenOf = (req) => {
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === COOKIE) {
        const value = rest.join('=');
        return TOKEN_PATTERN.test(value) ? value : null;
      }
    }
    return null;
  };
  const personaOf = (req) => {
    const token = tokenOf(req);
    return token ? sessions.get(token) ?? null : null;
  };

  // The authenticated synthetic identity. Null means signed out (401).
  const resolveIdentity = (req) => {
    const persona = personaOf(req);
    return persona ? { userId: persona.userId } : null;
  };

  const publicPerson = (p) => ({ key: p.key, name: p.displayName, description: p.description, landing: p.landing });

  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/', async (req, res, next) => {
    try {
      res.type('html').send(await readFile(path.join(ASSETS, 'page.html'), 'utf8'));
    } catch (err) { next(err); }
  });
  router.get('/page.js', (req, res) => res.type('js').sendFile(path.join(ASSETS, 'page.js')));
  router.get('/banner.js', (req, res) => res.type('js').sendFile(path.join(ASSETS, 'banner.js')));

  router.get('/api/people', (req, res) => {
    const current = personaOf(req);
    res.json({ label: DEMO_LABEL, people: DEMO_PERSONAS.map(publicPerson), current: current ? publicPerson(current) : null });
  });

  router.post('/api/sign-in', express.json({ limit: '1kb' }), (req, res) => {
    // JSON only: a cross-site form post cannot send this content type.
    const persona = req.is('json') ? DEMO_PERSONAS.find((p) => p.key === req.body?.person) : null;
    if (!persona) return res.status(400).json({ error: 'Choose one of the demo people.' });
    const old = tokenOf(req);
    if (old) sessions.delete(old);
    const token = randomBytes(16).toString('hex');
    sessions.set(token, persona);
    res.set('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`);
    res.json({ person: publicPerson(persona) });
  });

  router.post('/api/sign-out', (req, res) => {
    const token = tokenOf(req);
    if (token) sessions.delete(token);
    res.set('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ signedIn: false });
  });

  // Serves each app page with the demo banner added, and sends a signed-out
  // browser to the demo sign-in page. Only GET page paths; assets, the API
  // and everything else fall through untouched.
  async function pages(req, res, next) {
    if (req.method !== 'GET' || !PAGE_PATH.test(req.path)) return next();
    let html;
    try {
      html = await readFile(path.join(PUBLIC_DIR, req.path.endsWith('/') ? `${req.path}index.html` : req.path), 'utf8');
    } catch {
      return next();
    }
    res.set('Cache-Control', 'no-store');
    if (!personaOf(req)) return res.redirect('/demo/');
    const tag = '<script src="/demo/banner.js"></script>';
    html = withDevNotice(html);
    res.type('html').send(/<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tag}</body>`) : html + tag);
  }

  return {
    resolveIdentity,
    // Mount on an outer app BEFORE the real app: it handles /demo and pages,
    // then passes everything else (the API included) on unchanged.
    mount(outer) {
      outer.use('/demo', router);
      outer.use(pages);
    },
  };
}
