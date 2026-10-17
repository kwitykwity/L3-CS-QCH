const assert = require("assert");
const { getTotalReferrals } = require("../src/services/reportingService");

async function runTests() {
  console.log("Running Total Referrals Reporting Unit Tests...");

  // Mock DB
  let executedQuery = "";
  let executedParams = {};
  const mockDb = {
    query: async (sql, params) => {
      executedQuery = sql;
      executedParams = params;
      return [{ total_referrals: 5 }];
    }
  };

  // Test 1: QCH-Wide Date Range Query
  const res1 = await getTotalReferrals(mockDb, {
    startDate: "2026-10-01T00:00:00Z",
    endDate: "2026-10-14T23:59:59Z"
  });
  assert.strictEqual(res1.totalReferrals, 5, "Total referrals should match mock count");
  assert(executedQuery.includes("created_at_utc >= @startDate"), "Must check created_at_utc start");
  assert(executedQuery.includes("created_at_utc <= @endDate"), "Must check created_at_utc end");
  console.log("✔ Test 1 Passed: QCH-Wide Date Range Query");

  // Test 2: Program-Specific Filter Query
  await getTotalReferrals(mockDb, {
    startDate: "2026-10-01T00:00:00Z",
    endDate: "2026-10-14T23:59:59Z",
    programId: 12
  });
  assert(executedQuery.includes("referring_program_id = @programId OR receiving_program_id = @programId"), "Must filter by referring or receiving program");
  assert.strictEqual(executedParams.programId, 12, "Must pass programId parameter");
  console.log("✔ Test 2 Passed: Program-Specific Filter Query");

  // Test 3: Department-Specific Filter Query
  await getTotalReferrals(mockDb, {
    startDate: "2026-10-01T00:00:00Z",
    endDate: "2026-10-14T23:59:59Z",
    departmentId: 3
  });
  assert(executedQuery.includes("referring_department_id = @departmentId OR receiving_department_id = @departmentId"), "Must filter by referring or receiving department");
  assert.strictEqual(executedParams.departmentId, 3, "Must pass departmentId parameter");
  console.log("✔ Test 3 Passed: Department-Specific Filter Query");

  console.log("All Total Referrals tests passed successfully!");
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
