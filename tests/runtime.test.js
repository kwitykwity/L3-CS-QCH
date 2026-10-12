const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { validateRuntime } = require("../scripts/check-runtime");

const result = validateRuntime();
assert.strictEqual(
  result,
  true,
  `Expected Node v24.15.0, received ${process.version}`
);

const packageJson = require("../package.json");
assert.strictEqual(
  packageJson.engines.node,
  ">=24.15.0 <25.0.0"
);

const nvmrc = fs
  .readFileSync(path.join(__dirname, "..", ".nvmrc"), "utf8")
  .trim();

assert.strictEqual(nvmrc, "v24.15.0");

console.log("All runtime tests passed.");