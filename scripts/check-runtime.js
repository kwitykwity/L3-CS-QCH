import { fileURLToPath } from 'node:url';

const EXPECTED_VERSION = 'v24.15.0';

export function validateRuntime(version = process.version) {
  if (version !== EXPECTED_VERSION) {
    console.warn(
      `Node runtime mismatch: expected ${EXPECTED_VERSION}, received ${version}.`
    );
    return false;
  }

  console.log(`Node runtime validated: ${version}`);
  console.log(
    'Production Azure App Service Node runtime remains pending QCH IT confirmation.'
  );
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(validateRuntime() ? 0 : 1);
}
