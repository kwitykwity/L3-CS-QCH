import { pathToFileURL } from 'node:url';

// Team development baseline (Oct 11 team decision, as stated in PR #5).
//
// OPEN: this exact-version check is stricter than package.json "engines"
// ("24.x") and .nvmrc ("24") inherited from PR #2. The team must decide
// whether the repository pins exactly 24.15.0 everywhere or accepts 24.x.
// Production Node version on Azure App Service is a separate, still-open
// dependency pending QCH IT.
export const EXPECTED_VERSION = 'v24.15.0';

export function validateRuntime(version = process.version) {
  if (version !== EXPECTED_VERSION) {
    console.warn(
      `Node runtime mismatch: expected ${EXPECTED_VERSION}, received ${version}.`,
    );
    return false;
  }

  console.log(`Node runtime validated: ${version}`);
  console.log(
    'Production Azure App Service Node runtime remains pending QCH IT confirmation.',
  );
  return true;
}

// ES-module equivalent of CommonJS "require.main === module": run the check
// only when this file is executed directly, not when it is imported.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exit(validateRuntime() ? 0 : 1);
}
