import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Dependency and licensing information for handoff (PRD 19.2).
// Reads package-lock.json only: no network, no extra packages. Lists every
// installed package with its declared license, then a count per license.
//
//   npm run licenses

export function listLicenses(lockfile) {
  const packages = Object.entries(lockfile.packages ?? {})
    .filter(([key]) => key.startsWith('node_modules/'))
    .map(([key, info]) => ({
      name: key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: info.version ?? 'unknown',
      license: info.license ?? 'UNKNOWN',
      scope: info.dev ? 'development' : 'runtime',
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const counts = {};
  for (const { license } of packages) counts[license] = (counts[license] ?? 0) + 1;

  return { packages, counts };
}

export function formatLicenses({ packages, counts }) {
  const lines = ['License counts:'];
  for (const [license, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${license}: ${count}`);
  }
  lines.push('', 'Packages:');
  for (const p of packages) lines.push(`  ${p.name}@${p.version}  ${p.license}  (${p.scope})`);
  return lines.join('\n');
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const file = path.join(import.meta.dirname, '..', 'package-lock.json');
  console.log(formatLicenses(listLicenses(JSON.parse(readFileSync(file, 'utf8')))));
}
