# Demo environment and reset (Task S)

**Status: verified on `main` at `36f6e82`, October 26, 2026.** Everything
below was run, not just read. Two items wait on Task O (demo sign-in,
Richard): see [What waits on Task O](#what-waits-on-task-o).

This is the team-controlled "Plan B" demo from Final Technical PRD 16.4:
synthetic people, referrals and Programs only, a simulated notification
outbox, no QCH data and no production credentials. It is never promoted to
production (PRD 16.4, 18.1).

## Start the demo

From a fresh copy of the repository, on the presenting laptop:

1. `npm ci`
2. `cp .env.example .env` (this sets `NODE_ENV=development`; nothing else
   in the file is read)
3. `npm run dev:synthetic`
4. Open <http://127.0.0.1:3000/>

The server listens on `127.0.0.1` only, so it can only be opened on the
laptop that runs it. That fits a demo presented from one laptop. Hosting
the demo somewhere else would be a separate decision.

Optional: start with `QCH_TASK_C_SYNTHETIC_DEMO=true npm run dev:synthetic`
to add synthetic examples of current Program information (availability,
wait list, contact, extra locations) to Adult Evening Classes.

## Reset the demo

1. In the terminal running the server, press `Ctrl+C`.
2. Run `npm run dev:synthetic` again.
3. Reload the browser.

Everything a demo run created or changed is gone, and the app is back to
the starting state below. This works because all demo data lives in the
server's memory and is rebuilt from `scripts/syntheticSeed.js` on every
start. Nothing is written to disk or to any database.

Why this reset is safe (PRD 16.2, 17.4):

- **Synthetic only.** The only data it can produce is the invented seed.
- **Environment-guarded and fail closed.** The demo server refuses to start
  unless `NODE_ENV` is exactly `development`. Production, test, unset, a
  typo like `Development`, or an unknown value like `staging` all stop it.
- **All or nothing.** A restart rebuilds the whole state at once; there is
  no partial reset.
- **Not in production.** The production server (`npm start`) has no reset
  route and never loads the synthetic seed or the demo server.

## Starting state

Every fresh start shows exactly this (proved by `test/demoEnvironment.test.js`):

- **No Program affiliation chosen**, so the first-use "Your Program
  affiliation" step appears on the New Referral page.
- **No referrals.** Sent, received and Reporting all start at zero.
- **One synthetic user** (user 1) who can:
  - send referrals from whichever Program they choose as their affiliation
  - receive, respond to and record outcomes for **Housing Help Desk** only
  - manage Programs 3 and 7, and manage the organization
- **3 Departments, 7 Programs (6 active), 5 need categories**, every name
  marked "(sample)":

| Program | Need | Age | Service area | Notification |
| --- | --- | --- | --- | --- |
| 1 Early Childhood Playgroup | Childcare | 0 to 5 | No limit | Simulated |
| 2 After-School Homework Club | Education | 6 to 13 | ZIPs 99901, 99902 | Simulated |
| 3 Adult Evening Classes | Education, Employment | 18 and up | No limit | Simulated |
| 4 Housing Help Desk | Housing | No limit | Other limit (not checkable) | Simulated |
| 5 Job Readiness Workshop | Employment | Not on file | No limit | **None on purpose**: shows a failed notification |
| 6 Older Adult Wellness Center | Older adult support | 60 and up | No limit | Simulated |
| 7 Retired Sample Program | Older adult support | No limit | No limit | Discontinued: not offered |

The ZIP codes are from outside New York on purpose.

### What the sample Programs can show in Find a Program

| Search | Result |
| --- | --- |
| Education, ages 30 to 35 | Strong match: Adult Evening Classes |
| Housing | Possible match: Housing Help Desk (area rule the app cannot check) |
| Employment, ages 20 to 25 | Strong and possible together: Adult Evening Classes, Job Readiness Workshop. **Best single search to show** |
| Childcare, ages 30 to 35 | No match found |
| Education, ages 8 to 10, ZIP 99901 | Strong match: After-School Homework Club |
| Education, ages 8 to 10, ZIP 11375 | No match found (outside the service area) |

### Notifications in the demo

No email is ever sent. Each new referral writes one line to the server's
terminal, for example
`[notification] delivery=1 referral=1 type=NEW_REFERRAL ... outcome=SENT`.
A referral to Job Readiness Workshop logs `outcome=FAILED
category=NO_RECIPIENT` on purpose; the referral itself is still saved.
For the smoothest demo, send to **Housing Help Desk**: the user can then
also play the receiving Program.

## Safety checks

| Card item | Result | Evidence |
| --- | --- | --- |
| Starts from a known synthetic state | Pass | 3 fresh starts compared field by field: identical. `test/demoEnvironment.test.js` |
| Synthetic referring and receiving identities exist | **Partly.** One user plays both sides | Separate referring and receiving users wait on Task O |
| Programs vary enough for Direct Referral and Find a Program | Pass | 6 Programs to choose from; every matching result above. `test/demoEnvironment.test.js` |
| Safe reset procedure | Pass | [Reset the demo](#reset-the-demo); restart proved to undo a full demo run |
| Reset cannot run in production | Pass | Demo server refused `production`, `test`, unset, `Development`, `staging`. `test/securityPass.test.js` ("the synthetic dev server refuses every environment except development") |
| Production rejects demo sign-in | Pass | `npm start` in production: `/health` works; every API answers 401, including with faked `X-User-Id`, `X-Demo-User`, cookie and `Authorization` headers. `test/securityPass.test.js` ("the production server starts with no sign-in fallback") |
| No production QCH credentials needed | Pass | Started from a fresh copy with only `.env.example`, whose QCH IT values are placeholders no code reads |
| No real QCH participant or Program Directory data | Pass | No spreadsheet, CSV, PDF or Word file is committed. No real QCH Program or place names, QCH email addresses or New York phone numbers in code or seeds. All emails use `example.org`, `example.test` or `example.invalid` |
| Screen says "Demo sign-in. Production uses QCH Microsoft sign-in." | **Not yet** | Part of Task O. Today every page says "Development build. Use synthetic data only." |
| Reset and demo journey run more than once | Pass | Reset plus a full demo run, 3 times: same results each time. The demo journey browser tests (`mvpJourney`, `sentReferrals`, `receiving`, 35 tests) passed twice in a row on fresh servers |

## What waits on Task O

Task O (demo sign-in and switching between people) is in progress. When it
lands, re-check:

1. **Separate synthetic people** for the referring side and the receiving
   side, and switching between them during the demo.
2. **The on-screen label** "Demo sign-in. Production uses QCH Microsoft
   sign-in." on every page that shows the demo sign-in.
3. **Production still refuses it.** The demo sign-in must fail closed
   outside `development`, like the demo server does today. The existing
   production tests should keep passing unchanged.
4. **Reset still clears everything**, including who is signed in.
   `test/demoEnvironment.test.js` should keep passing; add the new people to
   its starting-state check.

## Found while checking (not fixed here)

- **Home page label.** The first link says "Make a Direct Referral", but
  that page also offers "Help me find a Program". For the demo, a label such
  as "Make a referral" would match what the page does. (Demo fix, for Task
  R or T.)
- **Report error wording.** A report request with a bad period answers
  "The referral is not valid." The Reporting Center page shows its own
  messages, so staff do not see this, but the wording is wrong for a
  report. (Minor, for Task V.)
