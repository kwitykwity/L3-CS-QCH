import { pathToFileURL } from 'node:url';

// Team development baseline: exactly Node 24.15.0 (Oct 11 team decision).
// This is settled development policy and matches .nvmrc, package.json
// "engines", and package-lock.json.
//
// The production Node version on Azure App Service is a separate item and
// remains pending QCH IT confirmation.
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
