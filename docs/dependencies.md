# Dependencies and licenses

Handoff deliverable from PRD 19.2. The app has 2 direct runtime dependencies and 3
direct development dependencies.

The license information below is the **license metadata each package declares
in `package-lock.json`**. It has not been checked against each package's actual
license files and is not a legal review. At the time of writing, every declared
**runtime** license is MIT, ISC, BSD-2-Clause, or BSD-3-Clause. Two
development-only test tools (card 17, approved by the Team Lead on October
20, 2026) declare Apache-2.0 and MPL-2.0; see below.

## Direct dependencies

A test (`test/docs.test.js`) fails if `package.json` gains or drops a direct
dependency that this table does not match.

| Package | Used for | Scope | License |
| --- | --- | --- | --- |
| `express` | Web server and routing | Runtime | MIT |
| `dotenv` | Loads `.env` on developer machines | Runtime | BSD-2-Clause |
| `supertest` | HTTP tests | Development | MIT |
| `@playwright/test` | Browser tests: keyboard, focus, text size (`npm run test:e2e`) | Development | Apache-2.0 |
| `@axe-core/playwright` | Automatic accessibility scan inside the browser tests | Development | MPL-2.0 |

## Development-only test tools (card 17)

`@playwright/test` and `@axe-core/playwright` run only on developer
machines and in test pipelines, through `npm run test:e2e`. Nothing in
`src/` or `public/` imports them, the production start command never
loads them, and a production install (`npm ci --omit=dev`) leaves them
out. They are pinned to exact versions, and `package.json` pins
`playwright-core` (installed with them) to the same Playwright version.

- `@playwright/test` brings `playwright` and `playwright-core`, all
  Apache-2.0.
- `@axe-core/playwright` brings `axe-core`, both MPL-2.0. MPL-2.0 is a
  file-level copyleft license; it applies to changes made to those
  packages' own files, which this project does not make.

The browser itself is installed separately, once per machine:
`npx playwright install chromium`.

## Full list

Every package entry in `package-lock.json`, with its version and its
lockfile-declared license:

```bash
npm run licenses
```

The output marks each package runtime or development and counts each
declared license. A package with no declared license shows as `UNKNOWN`.
Run it again after any dependency change.

## Open item

The repository has no license file of its own. Which license, if any, QCH
Connect's source carries is a QCH decision for handoff (PRD 19.3).
