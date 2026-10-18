const assert = require('assert');
const { createProgram, updateProgram, setProgramActiveState } = require('../src/services/programService');

async function runTests() {
  console.log('Running Program Management Service Unit Tests...');

  // Mock DB setup
  const mockDb = {
    query: async () => ({ insertId: 501 })
  };

  // Test 1: Authorized Creation
  const created = await createProgram(mockDb, { name: 'Youth Counseling', description: 'Youth services', departmentId: 'DEP-01' }, 'Program Director');
  assert.strictEqual(created.programId, 501);
  assert.strictEqual(created.isActive, true);
  console.log('✔ Test 1 Passed: Authorized Program Creation');

  // Test 2: Discontinue / Reactivate State Toggle
  const discontinued = await setProgramActiveState(mockDb, 501, false, 'Designated Staff');
  assert.strictEqual(discontinued.programId, 501);
  assert.strictEqual(discontinued.isActive, false);
  console.log('✔ Test 2 Passed: Program Discontinue (Soft-Disable)');

  // Test 3: Unauthorized Role Rejection
  try {
    await createProgram(mockDb, { name: 'Unauthorized Program', departmentId: 'DEP-02' }, 'Standard User');
    assert.fail('Should have thrown 403 error');
  } catch (err) {
    assert.strictEqual(err.statusCode, 403);
    console.log('✔ Test 3 Passed: Unauthorized Role Blocked (403)');
  }

  console.log('All Program Management tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});