// Task 252: Referrals I sent and Received referrals (wireframes 4 and 6).
//
// The status pill repeats the stage in words. Its color must never make a
// closed referral look like a success it was not: green only for Resulted
// in service. Each list item keeps its link, "where it stands" line and
// the Response / Decision / Service outcome list that tests and screen
// reader users rely on.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pillTone } from '../../public/receiving/pill.js';

const PUBLIC = path.join(import.meta.dirname, '..', '..', 'public');
const read = (f) => readFileSync(path.join(PUBLIC, f), 'utf8');

describe('referral list status pill (Task 252)', () => {
  test('tone follows what actually happened', () => {
    assert.equal(pillTone({ stage: 'AWAITING_RESPONSE' }), 'neutral');
    assert.equal(pillTone({ stage: 'ACCEPTED_OUTCOME_PENDING', decision: 'ACCEPTED', serviceOutcome: 'NOT_RECORDED' }), 'info');
    assert.equal(pillTone({ stage: 'COMPLETE', decision: 'ACCEPTED', serviceOutcome: 'RESULTED_IN_SERVICE' }), 'success');
    assert.equal(pillTone({ stage: 'COMPLETE', decision: 'ACCEPTED', serviceOutcome: 'DID_NOT_RESULT_IN_SERVICE' }), 'neutral');
    assert.equal(pillTone({ stage: 'COMPLETE', decision: 'NOT_APPROPRIATE', serviceOutcome: 'NOT_RECORDED' }), 'warning');
    assert.equal(pillTone({ stage: 'SOMETHING_NEW' }), 'neutral');
  });

  test('the pill says the stage words the pages already use, with the tone from pill.js', () => {
    const common = read('receiving/common.js');
    assert.match(common, /import \{ pillTone \} from '\.\/pill\.js';/);
    assert.match(common, /element\('span', STAGE_LABELS\[referral\.stage\] \?\? 'Unknown', `pill pill--\$\{pillTone\(referral\)\}`\)/);
    assert.match(common, /AWAITING_RESPONSE: 'Awaiting response',\s*ACCEPTED_OUTCOME_PENDING: 'Accepted, service outcome not recorded',\s*COMPLETE: 'Complete',/);
  });

  for (const file of ['sent/list.js', 'receiving/list.js']) {
    test(`${file}: the pill sits beside the heading, not inside it, so the link name is unchanged`, () => {
      const js = read(file);
      assert.match(js, /head\.append\(heading, stagePill\(referral\)\);/);
      assert.match(js, /li\.append\(head, /);
      assert.match(js, /summaryRow\('Response'[\s\S]*summaryRow\('Decision'[\s\S]*summaryRow\('Service outcome'/);
    });
  }

  for (const file of ['sent/index.html', 'receiving/index.html']) {
    test(`${file}: the filter keeps its select and Show referrals button, in one row`, () => {
      const html = read(file);
      assert.match(html, /<form id="filter-form" class="filters-inline" novalidate>/);
      assert.match(html, /<select id="stage-filter">/);
      assert.match(html, /<button type="submit" id="show" class="btn btn--primary">Show referrals<\/button>/);
    });
  }
});
