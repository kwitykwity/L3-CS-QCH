// Task 253: referral detail page in the wireframe 7 and 7b layout.
//
// Layout only. These checks fail if the restyle moves an action box before
// the details, lets the browser decide which box shows, loses the stage pill
// cleanup, or puts the two-column query on the grid it lays out (a container
// cannot restyle itself).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(import.meta.dirname, '..', '..', 'public');
const read = (...p) => readFileSync(path.join(PUBLIC, ...p), 'utf8');
const receivingHtml = read('receiving', 'referral.html').replace(/<!--[\s\S]*?-->/g, '');
const sentHtml = read('sent', 'referral.html').replace(/<!--[\s\S]*?-->/g, '');
const receivingJs = read('receiving', 'detail.js');
const sentJs = read('sent', 'detail.js');
const css = read('referral', 'referral.css').replace(/\/\*[\s\S]*?\*\//g, '');

describe('Referral detail layout (Task 253)', () => {
  test('details come first, then every action box, in reading and Tab order', () => {
    const at = (s) => {
      const i = receivingHtml.indexOf(s);
      assert.ok(i > -1, `missing ${s}`);
      return i;
    };
    const order = ['class="detail-main"', 'id="info"', 'id="progress"', 'class="detail-actions"', 'id="conflict"', 'id="readonly-note"',
      'id="respond-panel"', 'id="outcome-panel"', 'id="correct-outcome-panel"', 'id="correct-decision-panel"', 'id="reload"'].map(at);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });

  test('which action box shows still comes from the server', () => {
    for (const rule of ["'respond-panel': access.canRespond === true", "'outcome-panel': access.canRecordOutcome === true",
      "'correct-outcome-panel': access.canCorrectOutcome === true", "'correct-decision-panel': access.canCorrectResponse === true"]) {
      assert.ok(receivingJs.includes(rule), rule);
    }
  });

  test('both views show the stage pill and clear it whenever the referral is hidden', () => {
    for (const [name, html, js, clear] of [['receiving', receivingHtml, receivingJs, 'function hideReferral() {'], ['sent', sentHtml, sentJs, 'function clearReferral(']]) {
      assert.match(html, /<div class="detail-head">\s*<h1 id="referral-heading" tabindex="-1">[^<]+<\/h1>\s*<p id="stage-line" class="detail-head__stage" hidden><\/p>/, name);
      assert.match(js, /\$\('stage-line'\)\.replaceChildren\(stagePill\(referral\)\);\s*\$\('stage-line'\)\.hidden = false;/, name);
      const body = js.slice(js.indexOf(clear), js.indexOf('\n}\n', js.indexOf(clear)));
      assert.match(body, /\$\('stage-line'\)\.replaceChildren\(\);\s*\$\('stage-line'\)\.hidden = true;/, `${name} clears the pill`);
    }
  });

  test('the sender view has no action box', () => {
    assert.doesNotMatch(sentHtml, /detail-actions|respond-panel|outcome-panel/);
  });

  test('the two columns are queried on the wrapper in em, so XL text stacks them sooner', () => {
    assert.match(css, /\.detail-host\s*\{[^}]*container-type:\s*inline-size/);
    assert.doesNotMatch(css, /\.detail-layout\s*\{[^}]*container-type/);
    const query = /@container\s*\(\s*min-width:\s*(\d+)em\s*\)\s*\{\s*\.detail-layout\s*\{([^}]*)\}/.exec(css);
    assert.ok(query, 'expected an em-based @container rule that styles .detail-layout');
    assert.match(query[2], /grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  test('"Sent by" shows only the staff display name the view already returns', () => {
    assert.match(receivingJs, /summaryRow\('Sent by', referral\.createdBy\.displayName\)/);
    assert.doesNotMatch(receivingJs, /createdByUserId/);
  });
});
