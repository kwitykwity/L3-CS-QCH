// Card 17: accessibility regression checks for every page the app serves
// (Final Technical PRD 14.1 to 14.5, 17.7; team target WCAG 2.2 AA).
//
// These are AUTOMATED STRUCTURE checks. They read the HTML and CSS that
// ship in public/ and fail when a page loses something a keyboard or
// screen-reader user depends on. Every new page in public/ is checked
// automatically. They supplement, and do not replace, practical keyboard
// testing (PRD 17.7): see the manual checklist in
// docs/regression-coverage.md.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(import.meta.dirname, '..', '..', 'public');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(PUBLIC);
const pages = files.filter((f) => f.endsWith('.html')).map((f) => ({
  name: path.relative(PUBLIC, f),
  html: readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, ''),
}));
const stylesheets = files.filter((f) => f.endsWith('.css')).map((f) => ({
  name: path.relative(PUBLIC, f),
  css: readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}));

const tags = (html, tag) => [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map((m) => m[1]);
const attr = (attrs, name) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1] ?? null;
const ids = (html) => [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const isFormPage = (html) => /<(input|select|textarea)\b/i.test(html);

describe('every page', () => {
  test('there are pages to check', () => {
    assert.ok(pages.length >= 2, pages.map((p) => p.name).join(', '));
  });

  for (const { name, html } of pages) {
    describe(name, () => {
      test('declares its language, a title and a mobile viewport', () => {
        assert.match(html, /<html lang="en">/);
        assert.match(html, /<title>[^<]+\S[^<]*<\/title>/);
        assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1"/);
      });

      test('has one <main> and exactly one <h1>', () => {
        assert.equal(tags(html, 'main').length, 1);
        assert.equal(tags(html, 'h1').length, 1);
      });

      test('a skip link lands on a <main> that can take focus (Safari; Task R)', () => {
        // Safari moves keyboard focus only to a focusable target. Without
        // tabindex="-1" the next Tab after the skip link went back to the
        // header (heard in the VoiceOver run, docs/screen-reader-check.md A3).
        if (!/class="skip-link"/.test(html)) return;
        // With Safari's default setting, Tab skips plain links; a link with
        // tabindex="0" is still a Tab stop, so keyboard users can reach this
        // skip link (docs/browser-verification.md).
        assert.match(html, /<a class="skip-link" href="#main" tabindex="0">/);
        const [main] = tags(html, 'main');
        assert.match(main, /\bid="main"/);
        assert.match(main, /\btabindex="-1"/);
      });

      test('heading levels never skip (h2 before h3, ...)', () => {
        const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
        for (let i = 1; i < levels.length; i += 1) {
          assert.ok(levels[i] <= levels[i - 1] + 1, `h${levels[i - 1]} followed by h${levels[i]}`);
        }
      });

      test('ids are unique, and every reference points at a real id', () => {
        const all = ids(html);
        assert.deepEqual(all.filter((id, i) => all.indexOf(id) !== i), [], 'duplicate ids');
        const known = new Set(all);
        for (const ref of ['for', 'aria-describedby', 'aria-labelledby', 'aria-controls']) {
          for (const m of html.matchAll(new RegExp(`\\b${ref}="([^"]+)"`, 'g'))) {
            for (const id of m[1].split(/\s+/)) assert.ok(known.has(id), `${ref}="${id}" has no target`);
          }
        }
      });

      test('every input, select and textarea has a persistent label (not a placeholder) (PRD 14.4)', () => {
        for (const tag of ['input', 'select', 'textarea']) {
          for (const a of tags(html, tag)) {
            if (attr(a, 'type') === 'hidden') continue;
            const id = attr(a, 'id');
            assert.ok(id, `<${tag}> without an id cannot have a <label for>`);
            assert.match(html, new RegExp(`<label for="${id}"`), `#${id} has no <label>`);
            assert.equal(attr(a, 'placeholder'), null, `#${id} uses a placeholder`);
          }
        }
      });

      test('every button says what it is (type) and nothing jumps the tab order', () => {
        for (const a of tags(html, 'button')) assert.ok(['button', 'submit'].includes(attr(a, 'type')), `<button${a}>`);
        for (const m of html.matchAll(/tabindex="(-?\d+)"/g)) assert.ok(Number(m[1]) <= 0, `tabindex=${m[1]}`);
      });

      test('images have alt text; links have text', () => {
        for (const a of tags(html, 'img')) assert.notEqual(attr(a, 'alt'), null);
        for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) assert.ok(m[1].replace(/<[^>]+>/g, '').trim(), 'empty link');
      });

      test('status updates are announced to screen readers (PRD 14.4)', () => {
        assert.match(html, /role="status"/);
      });

      if (isFormPage(html)) {
        test('form page: skip link, required-field note, and every required field marked for assistive tech (PRD 14.3)', () => {
          assert.match(html, /<a class="skip-link" href="#main" tabindex="0">/);
          assert.match(html, /id="main"/);
          assert.match(html, /Fields marked <span aria-hidden="true">\*<\/span> are required\./);
          for (const a of [...tags(html, 'input'), ...tags(html, 'select'), ...tags(html, 'textarea')]) {
            if (/\srequired(?=\s|=|\/?$)/.test(a)) assert.match(a, /aria-required="true"/, attr(a, 'id'));
          }
        });

        test('form page: forms validate in the app, not the browser (focus goes to our error, PRD 14.3)', () => {
          for (const a of tags(html, 'form')) assert.match(a, /\bnovalidate\b/);
        });

        test('form page: S / M / L / XL text size control is present (PRD 14.5)', () => {
          for (const size of ['S', 'M', 'L', 'XL']) assert.match(html, new RegExp(`data-size="${size}"`));
          assert.match(html, /role="group" aria-labelledby="text-size-label"/);
        });
      }
    });
  }
});

// --------------------------------------------------------------------------
// Colors (WCAG 1.4.3 text 4.5:1, 1.4.11 control edges and focus 3:1),
// checked in the light and the dark theme of every stylesheet.
// --------------------------------------------------------------------------

function luminance(hex) {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function themes(css) {
  const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
  const read = (block) => Object.fromEntries([...(block ?? '').matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  return { light: read(light), dark: { ...read(light), ...read(dark) } };
}

// [foreground, background, minimum ratio]. A pair is checked when the
// stylesheet defines both colors.
const TEXT = 4.5;
const NON_TEXT = 3;
const PAIRS = [
  ['text', 'bg', TEXT], ['text', 'card', TEXT], ['text', 'focus-bg', TEXT],
  ['muted', 'bg', TEXT], ['muted', 'card', TEXT], ['muted', 'focus-bg', TEXT],
  ['primary', 'card', TEXT], ['primary', 'bg', TEXT], ['primary', 'focus-bg', TEXT],
  ['primary-text', 'primary', TEXT],
  ['error', 'card', TEXT], ['error', 'bg', TEXT], ['success', 'card', TEXT], ['info', 'card', TEXT],
  ['ok', 'card', TEXT], ['down', 'card', TEXT],
  ['link', 'card', TEXT], ['link', 'bg', TEXT],
  ['focus-ring', 'card', NON_TEXT], ['focus-ring', 'bg', NON_TEXT],
  ['control-border', 'card', NON_TEXT], ['control-border', 'bg', NON_TEXT], ['control-border', 'focus-bg', NON_TEXT],
];

describe('color contrast in both themes', () => {
  for (const { name, css } of stylesheets) {
    for (const [theme, colors] of Object.entries(themes(css))) {
      test(`${name} (${theme})`, () => {
        let checked = 0;
        for (const [fg, bg, min] of PAIRS) {
          if (!colors[fg] || !colors[bg]) continue;
          checked += 1;
          const ratio = contrast(colors[fg], colors[bg]);
          assert.ok(ratio >= min, `--${fg} on --${bg}: ${ratio.toFixed(2)} < ${min}`);
        }
        assert.ok(checked >= 4, 'expected the usual color tokens');
      });
    }
  }

  test('every stylesheet colors its own links, so they follow the theme (the browser default fails on dark)', () => {
    for (const { name, css } of stylesheets) {
      assert.match(css, /(^|\})\s*a\s*\{[^}]*\bcolor:\s*var\(--(link|primary)\)/, `${name}: no theme color for links`);
    }
  });

  test('form controls draw their edges with --control-border, never the decorative --border (WCAG 1.4.11)', () => {
    for (const { name, css } of stylesheets) {
      for (const rule of css.split('}')) {
        const [selector, body = ''] = rule.split('{');
        if (!/(^|[\s,])(input|select|textarea|\.text-size__btn)\b/.test(selector ?? '')) continue;
        if (/:disabled/.test(selector)) continue; // disabled controls are exempt
        assert.doesNotMatch(body, /border(-color)?:[^;]*var\(--border\)/, `${name}: ${selector.trim()}`);
      }
    }
  });
});

describe('text size (PRD 14.5)', () => {
  const forms = pages.filter((p) => isFormPage(p.html));

  test('S 12px, M 14px (default), L 18px, XL 24px', async () => {
    const { SIZES, DEFAULT_SIZE } = await import('../../public/referral/textSize.js');
    assert.deepEqual(SIZES, { S: 12, M: 14, L: 18, XL: 24 });
    assert.equal(DEFAULT_SIZE, 'M');
  });

  test('form-page styles size text in rem, so the preference scales labels, inputs, errors and controls', () => {
    const formCss = new Set(forms.flatMap((p) => [...p.html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)]
      .map((m) => path.join(path.dirname(p.name), m[1]))));
    assert.ok(formCss.size > 0);
    for (const { name, css } of stylesheets.filter((s) => formCss.has(s.name))) {
      const pxSizes = [...css.matchAll(/([^{}]+)\{[^}]*font(-size)?:[^;]*\b\d+px/g)].map((m) => m[1].trim());
      assert.deepEqual(pxSizes, [':root'], `${name}: only :root may set a px size`);
    }
  });
});

describe('test tools stay out of the shipped app', () => {
  test('nothing in src/, public/ or scripts/ imports Playwright or axe', () => {
    const root = path.join(import.meta.dirname, '..', '..');
    for (const dir of ['src', 'public', 'scripts']) {
      for (const file of walk(path.join(root, dir)).filter((f) => f.endsWith('.js'))) {
        assert.doesNotMatch(readFileSync(file, 'utf8'), /playwright|axe-core/i, path.relative(root, file));
      }
    }
  });
});
