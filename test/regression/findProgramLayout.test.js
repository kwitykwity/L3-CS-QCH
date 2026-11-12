// Task 249: Find a Program (guided matching) in the wireframe 1 layout.
//
// Layout only. These checks fail if the restyle ever changes what the form
// asks, the order a keyboard user meets the fields, or how the chosen need
// is shown. SYNTHETIC data only; no server needed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(import.meta.dirname, '..', '..', 'public', 'referral');
const html = readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const css = readFileSync(path.join(PUBLIC, 'referral.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const app = readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');

const guided = html.slice(html.indexOf('<div id="guided"'), html.indexOf('<div id="match-message"'));

describe('Find a Program layout (Task 249)', () => {
  test('the fields keep their order, so the keyboard meets them in the same order as before', () => {
    const ids = ['describe', 'describe-go', 'needs-options', 'ageMode-exact', 'ageMode-range', 'ageExact', 'ageMin', 'ageMax', 'matchZip', 'find-programs'];
    const at = ids.map((id) => guided.indexOf(`id="${id}"`));
    assert.ok(at.every((i) => i > 0), `missing: ${ids.filter((_, i) => at[i] < 0)}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at);
  });

  test('each group of questions sits in its own card; age and ZIP share the details card', () => {
    assert.match(guided, /class="field guided-card" id="describe-field"/);
    assert.match(guided, /<div class="guided-card">\s*<fieldset class="field" id="needs"/);
    const details = guided.slice(guided.indexOf('guided-details'), guided.indexOf('guided-footer'));
    assert.match(details, /id="ageRange"/);
    assert.match(details, /id="matchZip"/);
    const footer = guided.slice(guided.indexOf('guided-footer'));
    assert.match(footer, /not saved with the referral/);
    assert.match(footer, /id="find-programs"/);
  });

  test('needs are still real checkboxes inside their labels, shown as chips', () => {
    assert.match(guided, /<div id="needs-options" class="checks checks--chips"><\/div>/);
    assert.match(app, /checkbox\.type = 'checkbox';\s*checkbox\.name = 'need';/);
    assert.match(app, /label\.append\(checkbox, document\.createTextNode\(category\.name\)\)/);
  });

  test('a chosen chip is shown by a ticked box, bold text and a background, not color alone', () => {
    assert.match(css, /\.checks--chips label:has\(input:checked\)\s*\{[^}]*font-weight:\s*600[^}]*\}/);
    assert.match(css, /\.checks--chips label:has\(input:checked\)\s*\{[^}]*background:/);
    assert.match(css, /\.checks--chips label\s*\{[^}]*border:[^;]*var\(--control-border\)/, 'chip edges use --control-border (3:1)');
  });

  test('the Direct Referral shortcut uses the existing path switch, not a new route', () => {
    assert.match(guided, /<button type="button" id="guided-to-direct" class="btn btn--secondary">I already know the Program <span aria-hidden="true">&rarr;<\/span> Direct Referral<\/button>/);
    assert.match(app, /\$\('guided-to-direct'\)\.addEventListener\('click', \(\) => choosePath\('DIRECT'\)\);/);
  });

  test('the guided answers are still read the same way for matching', () => {
    assert.match(app, /needCategoryIds: \[\.\.\.document\.querySelectorAll\('input\[name="need"\]:checked'\)\]\.map\(\(b\) => Number\(b\.value\)\)/);
  });
});
