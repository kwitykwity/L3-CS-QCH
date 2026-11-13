// Task 254: Reporting Center in the wireframe 8 layout.
//
// Layout only. These checks fail if the restyle changes what the report
// asks the server for, drops a table's caption or headers, or shows a
// status by color alone. Every number still comes from the server.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, '..', '..', 'public', 'reporting');
const html = readFileSync(path.join(DIR, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const css = readFileSync(path.join(DIR, 'reporting.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const app = readFileSync(path.join(DIR, 'app.js'), 'utf8');

// The rule body for a selector, with any whitespace or line ending.
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const found = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(found, `expected a CSS rule for ${selector}`);
  return found[1];
}

describe('Reporting Center layout (Task 254)', () => {
  test('the period type is four labelled radio buttons in a fieldset, with the old explanations kept', () => {
    const group = html.slice(html.indexOf('<fieldset class="field period-choice"'), html.indexOf('</fieldset>'));
    assert.match(group, /aria-describedby="period-help"/);
    assert.match(group, /<legend>Period<\/legend>/);
    const labels = [...group.matchAll(/<label for="(period-[a-z]+)"><input type="radio" id="\1" name="period" value="([A-Z]+)"[^>]*\/> (\w+)<\/label>/g)];
    assert.deepEqual(labels.map((m) => [m[2], m[3]]), [['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly'], ['QUARTERLY', 'Quarterly'], ['YEARLY', 'Yearly']]);
    assert.match(group, /id="period-help" class="help">[^<]*Sunday to Saturday[^<]*calendar month[^<]*fiscal year, July 1 to June 30/);
    assert.doesNotMatch(html, /<select id="period"/);
  });

  test('the script sends the checked radio button as the period, and nothing else changed in what it asks for', () => {
    assert.match(app, /period: els\.filters\.elements\.namedItem\('period'\)\.value/);
    assert.doesNotMatch(app, /\$\('period'\)/);
    assert.doesNotMatch(app, /els\.period\b/);
  });

  test('the chosen period shows a filled circle, bold text and a thicker border, not color alone', () => {
    const chosen = rule('.segmented label:has(input:checked)');
    assert.match(chosen, /font-weight:\s*600/);
    assert.match(chosen, /border:\s*2px solid/);
    assert.match(rule('.segmented input'), /accent-color/);
    assert.doesNotMatch(rule('.segmented input'), /opacity:\s*0|display:\s*none|clip/);
  });

  test('the partial period note is orange text that still starts with "Note:"', () => {
    assert.match(html, /<p id="partial-note" class="message message--warn" hidden>/);
    assert.match(rule('.message--warn'), /color:\s*var\(--warn\)/);
    assert.match(rule('.message--warn::before'), /content:\s*"Note: "/);
  });

  test('number cards keep one width per row, so a short row does not stretch', () => {
    assert.match(rule('.grid'), /repeat\(auto-fill, minmax\(min\(11rem, 100%\), 1fr\)\)/);
    assert.match(rule('.metric h3'), /color:\s*var\(--muted\)/);
  });

  test('both breakdown tables are cards that keep their caption, column headers and scrolling region', () => {
    for (const id of ['programs', 'departments']) {
      const start = html.indexOf(`<section class="card table-card" aria-labelledby="${id}-heading">`);
      assert.ok(start > -1, `${id} table is in a card`);
      const section = html.slice(start, html.indexOf('</section>', start));
      assert.match(section, new RegExp(`<h2 id="${id}-heading">`));
      assert.match(section, new RegExp(`class="table-wrap" role="region" aria-labelledby="${id}-heading" tabindex="0"`));
      assert.match(section, /<caption>/);
      assert.equal((section.match(/<th scope="col">/g) ?? []).length, 9);
    }
    assert.match(rule('.table-card .table-wrap'), /border:\s*0/);
  });
});
