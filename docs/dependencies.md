# Dependencies and licenses

Handoff deliverable from PRD 19.2. The app has 2 direct runtime dependencies and 1
direct development dependency. All installed packages use permissive open-source
licenses (MIT, ISC, BSD-2-Clause, BSD-3-Clause).

## Direct dependencies

A test (`test/docs.test.js`) fails if `package.json` gains or drops a direct
dependency that this table does not match.

| Package | Used for | Scope | License |
| --- | --- | --- | --- |
| `express` | Web server and routing | Runtime | MIT |
| `dotenv` | Loads `.env` on developer machines | Runtime | BSD-2-Clause |
| `supertest` | HTTP tests | Development | MIT |

## Full list

Every installed package, with its version and declared license, comes from
`package-lock.json`:

```bash
npm run licenses
```

The output lists runtime and development packages separately and counts
each license. Run it again after any dependency change.

## Open item

The repository has no license file of its own. Which license, if any, QCH
Connect's source carries is a QCH decision for handoff (PRD 19.3).
