// Task 255: Program Management in the wireframe 9 look.
//
// Layout only. These checks fail if a status loses its words, the common
// fields change order or labels, or the grid can be wider than a phone.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { lifecycleTone } from '../../public/program-management/lifecycle.js';

const PM = path.join(import.meta.dirname, '..', '..', 'public', 'program-management');
const html = readFileSync(path.join(PM, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const app = readFileSync(path.join(PM, 'app.js'), 'utf8');
const fields = readFileSync(path.join(PM, 'fieldValues.js'), 'utf8');
const lifecycle = readFileSync(path.join(PM, 'lifecycle.js'), 'utf8');
const css = readFileSync(path.join(PM, '..', 'referral', 'referral.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('Program Management layout (Task 255)', () => {
  test('a status pill keeps the status word; only ACTIVE is green', () => {
    assert.equal(lifecycleTone('ACTIVE'), 'success');
    assert.equal(lifecycleTone('DISCONTINUED'), 'neutral');
    assert.equal(lifecycleTone('RETIRED'), 'neutral');
    assert.match(lifecycle, /pill\.textContent = status;/);
    assert.doesNotMatch(lifecycle, /innerHTML/);
  });

  test('the Program and every field show their status as a pill', () => {
    assert.match(app, /\$\('program-status'\)\.replaceChildren\(lifecyclePill\(row\.lifecycleStatus\)\);/);
    assert.match(fields, /head\.append\(element\('h2', field\.label\), lifecyclePill\(field\.lifecycleStatus\)\);/);
  });

  test('the common fields keep their order and labels inside the grid', () => {
    const grid = html.slice(html.indexOf('<div class="field-grid">'), html.indexOf('</fieldset>', html.indexOf('<div class="field-grid">')));
    const labels = [...grid.matchAll(/<label for="(\w+)">([^<]+)<\/label>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(labels, [['site', 'Site'], ['description', 'Description'], ['eligibilityNotes', 'Eligibility notes'],
      ['scheduleNotes', 'Schedule notes'], ['costNotes', 'Cost notes']]);
    assert.match(grid, /<div class="field field--wide">\s*<label for="description">/);
  });

  test('the grid stacks on a phone: its column minimum never exceeds the screen', () => {
    assert.match(css, /\.field-grid\s*\{[^}]*repeat\(auto-fill, minmax\(min\(18em, 100%\), 1fr\)\)/);
    assert.match(css, /\.field-grid > \.field--wide\s*\{[^}]*grid-column:\s*1 \/ -1/);
  });

  test('the empty state is a visible note with the same words', () => {
    assert.match(html, /<p id="programs-empty" class="callout" hidden>No Programs are currently assigned to you for management\.<\/p>/);
  });
});
