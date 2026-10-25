// The synthetic receiving setup used by the dev server and e2e/receiving.spec.js
// (Task A). SYNTHETIC data only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEV_RECEIVING_PROGRAM_ID, DEV_USER_ID, NOT_APPROPRIATE_REASONS, RECEIVING_CAPABILITIES, syntheticSeed,
} from '../scripts/syntheticSeed.js';
import {
  CORRECT_OUTCOME, RECEIVING_VIEW, RECORD_OUTCOME, RESPOND, UPDATE_RECEIVED,
} from '../src/authorization/referralAccess.js';

test('the default seed grants no receiving access and has no reasons', () => {
  const seed = syntheticSeed();
  assert.equal(seed.grants.length, 0);
  assert.equal(seed.notAppropriateReasons, undefined);
});

test('receiving: true grants each receiving capability, on one sample Program only', () => {
  const seed = syntheticSeed({ receiving: true });
  assert.deepEqual([...RECEIVING_CAPABILITIES].sort(),
    [CORRECT_OUTCOME, RECEIVING_VIEW, RECORD_OUTCOME, RESPOND, UPDATE_RECEIVED].sort());
  assert.deepEqual(seed.grants.map((g) => g.permission).sort(), [...RECEIVING_CAPABILITIES].sort());
  for (const grant of seed.grants) {
    assert.deepEqual(
      { userId: grant.userId, scopeType: grant.scopeType, programId: grant.programId, departmentId: grant.departmentId },
      { userId: DEV_USER_ID, scopeType: 'PROGRAM', programId: DEV_RECEIVING_PROGRAM_ID, departmentId: null },
    );
  }
  assert.ok(seed.programs.some((p) => p.programId === DEV_RECEIVING_PROGRAM_ID && p.lifecycleStatus === 'ACTIVE'));
});

test('the sample reasons are exactly the ones in migration 002', () => {
  const sql = readFileSync(new URL('../db/migrations/002_reference_data.sql', import.meta.url), 'utf8');
  const rows = [...sql.matchAll(/\(N'([A-Z_]+)',\s*N'([^']+)',\s*0,\s*(\d+)\)/g)]
    .map((m) => ({ code: m[1], label: m[2], displayOrder: Number(m[3]) }));
  assert.equal(rows.length, 5);
  assert.deepEqual(NOT_APPROPRIATE_REASONS.map(({ code, label, displayOrder }) => ({ code, label, displayOrder })), rows);
});
