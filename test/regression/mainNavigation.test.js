// Task 248: one main navigation on every app page.
//
// The navigation is written into each page's HTML (there is no template
// step), so it was copied by hand and drifted: some pages had four links,
// Program Management had two, Reporting and Permissions had none. These
// checks keep every app page on the same links, in the same order, with the
// current page marked. Links are not hidden by permission: every page still
// checks access on the server (permission-based links are version 2 work).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(import.meta.dirname, '..', '..', 'public');

const LINKS = [
  ['New referral', '/referral/'],
  ['Referrals I sent', '/sent/'],
  ['Received referrals', '/receiving/'],
  ['Program Management', '/program-management/'],
  ['Reporting', '/reporting/'],
  ['Help', '/help/'],
];

// Which link each page marks: "page" for the section's own page, "true"
// for a page inside that section (a referral, a Program's fields).
const CURRENT = {
  'referral/index.html': ['New referral', 'page'],
  'sent/index.html': ['Referrals I sent', 'page'],
  'sent/referral.html': ['Referrals I sent', 'true'],
  'receiving/index.html': ['Received referrals', 'page'],
  'receiving/referral.html': ['Received referrals', 'true'],
  'program-management/index.html': ['Program Management', 'page'],
  'program-management/fields.html': ['Program Management', 'true'],
  'program-management/matching.html': ['Program Management', 'true'],
  'program-management/organization.html': ['Program Management', 'true'],
  'program-management/organization-programs.html': ['Program Management', 'true'],
  'program-management/replace-field.html': ['Program Management', 'true'],
  'program-management/reuse-field.html': ['Program Management', 'true'],
  'reporting/index.html': ['Reporting', 'page'],
  'help/index.html': ['Help', 'page'],
  'permissions/index.html': null,
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// The home page is the list of every area, not a workflow page, so it has
// no main navigation.
const pages = walk(PUBLIC).filter((f) => f.endsWith('.html')).map((f) => ({
  name: path.relative(PUBLIC, f).split(path.sep).join('/'),
  html: readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, ''),
})).filter((p) => p.name !== 'index.html');

const navOf = (html) => [...html.matchAll(/<nav aria-label="Main navigation"[^>]*>([\s\S]*?)<\/nav>/g)].map((m) => m[1]);
const linksOf = (nav) => [...nav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)]
  .map(([, href, rest, name]) => ({ href, name: name.trim(), current: rest.match(/aria-current="([^"]+)"/)?.[1] ?? null }));

describe('main navigation (Task 248)', () => {
  test('every app page is listed here, so a new page cannot skip the check', () => {
    assert.deepEqual(pages.map((p) => p.name).sort(), Object.keys(CURRENT).sort());
  });

  for (const page of pages) {
    describe(page.name, () => {
      const navs = navOf(page.html);

      test('has exactly one main navigation, inside the page banner', () => {
        assert.equal(navs.length, 1);
        assert.match(page.html, /<header class="topbar">[\s\S]*<nav aria-label="Main navigation"[\s\S]*<\/header>/);
      });

      test('has the same links, in the same order, as every other page', () => {
        assert.deepEqual(linksOf(navs[0]).map(({ name, href }) => [name, href]), LINKS);
      });

      test('marks only its own section as current', () => {
        const marked = linksOf(navs[0]).filter((l) => l.current).map((l) => [l.name, l.current]);
        assert.deepEqual(marked, CURRENT[page.name] ? [CURRENT[page.name]] : []);
      });
    });
  }

  test('Organization management stays reachable from Program Management', () => {
    const pm = pages.find((p) => p.name === 'program-management/index.html').html;
    assert.match(pm.replace(/<nav[\s\S]*?<\/nav>/, ''), /<a href="organization\.html">Organization management<\/a>/);
  });

  test('the current page is shown by weight and background as well as color, in every stylesheet the pages use', () => {
    for (const file of ['referral/referral.css', 'reporting/reporting.css']) {
      const css = readFileSync(path.join(PUBLIC, file), 'utf8');
      assert.match(css, /\.main-nav a\[aria-current\]\s*\{[^}]*font-weight:\s*600[^}]*\}/, file);
      assert.match(css, /\.main-nav a\[aria-current\]\s*\{[^}]*background:/, file);
      assert.match(css, /\.main-nav\s*\{[^}]*flex-wrap:\s*wrap/, `${file}: links must wrap at large text sizes`);
    }
  });
});
