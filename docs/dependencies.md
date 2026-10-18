# Dependencies and licenses

Handoff deliverable from PRD 19.2. The app has 2 direct runtime dependencies and 1
direct development dependency.

The license information below is the **license metadata each package declares
in `package-lock.json`**. It has not been checked against each package's actual
license files and is not a legal review. At the time of writing, every declared
license is MIT, ISC, BSD-2-Clause, or BSD-3-Clause.

## Direct dependencies

A test (`test/docs.test.js`) fails if `package.json` gains or drops a direct
dependency that this table does not match.

| Package | Used for | Scope | License |
| --- | --- | --- | --- |
| `express` | Web server and routing | Runtime | MIT |
| `dotenv` | Loads `.env` on developer machines | Runtime | BSD-2-Clause |
| `supertest` | HTTP tests | Development | MIT |

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
