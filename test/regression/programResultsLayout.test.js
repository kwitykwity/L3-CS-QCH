// Task 250: Programs that may fit, in the wireframe 2 layout.
//
// Layout only. These checks fail if the restyle changes what a result
// says, makes one result look ranked above the others, or renames the
// Choose buttons that many browser tests (and screen reader users) rely on.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(import.meta.dirname, '..', '..', 'public', 'referral');
const html = readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const css = readFileSync(path.join(PUBLIC, 'referral.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const app = readFileSync(path.join(PUBLIC, 'app.js'), 'utf8');
const results = html.slice(html.indexOf('<div id="match-results"'));

describe('Program results layout (Task 250)', () => {
  test('the not-checked note sits above both lists, in an information box', () => {
    const note = results.indexOf('<p id="not-checked-note" class="callout" hidden></p>');
    assert.ok(note > 0, 'note present with the callout style');
    assert.ok(note < results.indexOf('id="plausible-group"') && note < results.indexOf('id="possible-group"'));
    assert.equal((html.match(/id="not-checked-note"/g) ?? []).length, 1);
  });

  test('every result is built the same way: no card or button stands out as a first choice', () => {
    assert.match(app, /choose\.className = 'btn btn--secondary';/);
    assert.match(app, /choose\.textContent = `Choose \$\{item\.name\}`;/);
    assert.doesNotMatch(css, /\.match:first-child|\.match:nth-child|\.match-list > li:first-child/);
  });

  test('the button moves beside the details only when the list is wide, and stays inside its column', () => {
    assert.match(css, /\.match-list\s*\{[^}]*container-type:\s*inline-size/);
    const wide = css.slice(css.indexOf('@container'));
    assert.match(wide, /\.match > button\s*\{[^}]*grid-column:\s*2[^}]*max-width:/);
    assert.match(wide, /\.match > \.match__info\s*\{[^}]*grid-column:\s*1 \/ -1/);
  });

  test('the matching facts are still a list for screen readers; the separator dot is not read out', () => {
    assert.match(app, /why\.className = 'match__why';/);
    assert.match(css, /\.match__why > li \+ li::before\s*\{[^}]*content:\s*" · " \/ ""/);
  });
});
