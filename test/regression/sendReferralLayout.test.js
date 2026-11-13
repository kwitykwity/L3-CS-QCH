// Task 251: Send referral (wireframe 3) and Direct Referral (wireframe 1b).
//
// Layout only. These checks fail if the restyle changes the fields, the
// order a keyboard user meets them, or the "What happens next" wording, or
// if the two-column layout loses its container (a container cannot restyle
// itself, so the query has to live on the step panel).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(import.meta.dirname, '..', '..', 'public', 'referral');
const html = readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const css = readFileSync(path.join(PUBLIC, 'referral.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const details = html.slice(html.indexOf('<section id="step-details"'), html.indexOf('<dialog id="discard-dialog"'));
const direct = html.slice(html.indexOf('<div id="direct"'), html.indexOf('<section id="step-details"'));

// Finds the wide-screen @container rule for .details-layout with any
// whitespace or line ending (a Windows checkout has CRLF), fails clearly
// if it is missing, and checks that it turns the layout into a grid.
function assertWideLayout(source) {
  const query = /@container\s*\(\s*min-width:\s*34rem\s*\)\s*\{\s*\.details-layout\s*\{([^}]*)\}/.exec(source);
  assert.ok(query, 'expected an @container (min-width: 34rem) rule that styles .details-layout');
  assert.match(query[1], /display:\s*grid/);
}

describe('Send referral layout (Task 251)', () => {
  test('the fields keep their order, so the keyboard meets them in the same order as before', () => {
    const ids = ['change-program', 'participantName', 'contactMethod-options', 'contactValue', 'referralContext', 'participantZip', 'notes', 'send', 'send-direct', 'cancel'];
    const at = ids.map((id) => details.indexOf(`id="${id}"`));
    assert.ok(at.every((i) => i > 0), `missing: ${ids.filter((_, i) => at[i] < 0)}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at);
  });

  test('"What happens next" comes after the form, inside the step, and says no participant details are sent', () => {
    const aside = details.slice(details.indexOf('<aside'), details.indexOf('</aside>'));
    assert.ok(details.indexOf('</form>') < details.indexOf('<aside'));
    assert.match(aside, /aria-labelledby="next-heading"/);
    assert.match(aside, /<h3 id="next-heading">What happens next<\/h3>/);
    assert.match(aside, /no participant details/);
    assert.match(aside, /Referrals I sent/);
  });

  test('the two-column layout is queried on the step panel, not on the element it lays out', () => {
    assert.match(details, /<section id="step-details" class="panel details-host"/);
    assert.match(css, /\.details-host\s*\{[^}]*container-type:\s*inline-size/);
    assert.doesNotMatch(css, /\.details-layout\s*\{[^}]*container-type/);
    assertWideLayout(css);
  });

  test('the layout check does not depend on line endings (Windows CRLF checkouts)', () => {
    assertWideLayout(css.replace(/\r?\n/g, '\r\n'));
    assertWideLayout(css.replace(/\r\n/g, '\n'));
  });

  test('the summary is a strip; ZIP and Notes share a row that stacks when narrow', () => {
    assert.match(details, /<dl class="summary summary--strip">/);
    const pair = details.slice(details.indexOf('<div class="field-pair">'), details.indexOf('</fieldset>', details.indexOf('<div class="field-pair">')));
    assert.match(pair, /id="participantZip"/);
    assert.match(pair, /id="notes"/);
    assert.match(css, /\.field-pair\s*\{[^}]*minmax\(min\(14rem, 100%\), 1fr\)/);
  });
});

describe('Direct Referral list (Task 251)', () => {
  test('still a real radio list with nothing chosen, in one bordered box', () => {
    assert.match(direct, /<ul id="program-options" class="program-options program-options--boxed"><\/ul>/);
    assert.doesNotMatch(direct, /checked/);
  });

  test('the chosen Program is shown by weight and background, not color alone', () => {
    assert.match(css, /\.program-options--boxed li:has\(input:checked\)\s*\{[^}]*background:/);
    assert.match(css, /\.program-options--boxed li:has\(input:checked\) label\s*\{[^}]*font-weight:\s*600/);
  });
});
