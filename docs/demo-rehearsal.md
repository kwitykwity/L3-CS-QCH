# Demo dress rehearsal (Task R)

Trello: **Task R: Full Integrated MVP User Journey / Demo Dress Rehearsal**.
Final Technical PRD 2.1 to 2.4, 3.9, 5.5, 6.1 to 6.5, 7.3, 7.4, 8, 9.4, 11,
12, 13.4, 14, 16.1.

The goal is to show that QCH Connect works as **one product** on integrated
`main`, not only as features that each pass their own tests. One person
runs one connected synthetic journey from start to finish and records the
result. Synthetic data only.

## What runs, and what is still missing

| Journey step | On `main`? |
| --- | --- |
| Demo sign-in, switching between staff | **Yes** (Task O, PR #60): `npm run dev:demo` with three separate demo people. Rehearsed in [Run 3](#run-3-separate-demo-identities-chromium-october-28-2026). `npm run dev:synthetic` still signs in **one** synthetic person who plays every role; Run 1 used that |
| Everything else below | Yes |

The production server (`npm start`) has no sign-in yet and **fails
closed**: every API answers 401 and each page says the person is not
signed in (step 19).

## The script

Start: `npm run dev:synthetic`, then open `http://127.0.0.1:3000/`. Each
server start begins with fresh synthetic data.

| # | Do | Expect |
| --- | --- | --- |
| 1 | Open the home page | Links to New Referral, Program Management, Referrals I sent, Received referrals, Reporting Center |
| 2 | **New Referral**: on first use, choose your Program (Early Childhood Playgroup) and save | Nothing is preselected; "Your Program affiliation is saved" |
| 3 | **Reporting Center**: Scope "One Program", Housing Help Desk, Show report | Note the counts (all 0 on a fresh start) |
| 4 | **Find a Program** with Education, ages 18 to 30 | Adult Evening Classes is listed |
| 5 | **Program Management** → Adult Evening Classes → matching information: minimum age 65, save. Search again | Adult Evening Classes is gone. Put the minimum age back to 18 |
| 6 | Program Management: **Discontinue** Adult Evening Classes. New Referral → "I know the Program" | It is no longer offered. **Reactivate** it: offered again |
| 7 | **Find a Program** with Housing → choose Housing Help Desk. Fill the referral **by keyboard only** (Tab, Space for the "No reliable contact" choice, Enter on Send) | "Referral received ! Referral ID: N" |
| 8 | Press Enter on Send again | Nothing new is sent: Referrals I sent lists it once. (A lost confirmation is checked by Submission ID and shows "Referral already received. Do not resend !"; see Run 1, steps 7–8) |
| 9 | Look at the terminal running the server | One `[notification] … outcome=SENT` line for that Referral ID, with IDs only and no names |
| 10 | **Received referrals**: find it, open it with Enter | "Referral loaded." |
| 11 | Accept, then record **Resulted in service** | Each step is confirmed in the status box |
| 12 | **Stale write**: open the same referral in a second tab. In tab 1, correct the outcome. In tab 2, try a correction | Tab 2: "Your change was not saved", with what is saved now and "Load the latest information". Put the outcome back to Resulted in service |
| 13 | **Referrals I sent** | Shows Complete, Accepted, Resulted in service |
| 14 | Send a second referral to Housing Help Desk with **Direct Referral**. Receive it and mark it **Not appropriate** with a reason | The sender sees "Not appropriate: [reason]" |
| 15 | **Reporting Center**, Housing Help Desk again | Total +2, Accepted +1, Not appropriate +1, Resulted in service +1 |
| 16 | **Unauthorized**: open `/receiving/referral.html?id=999999` | "This referral is not available. It may not exist, or you may not have access to it." |
| 17 | On each page, choose **XL** and make the window phone-narrow | Text grows, nothing scrolls sideways, and typed work is kept |
| 18 | **Privacy**: look at the address bar on every page, and at browser storage (Safari: Develop → Show Web Inspector → Storage) | No participant name or need in any address. Storage holds only `qchConnect.textSize` |
| 19 | Stop the server. Run `NODE_ENV=production npm start` and open `/referral/` | "You are not signed in, so nothing can be shown." No data appears. `NODE_ENV=production npm run dev:synthetic` refuses to start |

## Rehearsal record

### Run 1: automated walk-through (Chromium), October 26, 2026

A one-off script acted as the user on `npm run dev:synthetic`. It wasn't
added to the test suite (that is the existing specs' job). Starting point:
`main` at `36f6e82`, plus the fixes below.

| # | Result |
| --- | --- |
| 1–3 | Pass. Baseline for Housing Help Desk: 0 / 0 / 0 / 0 / 0 |
| 4–5 | Pass. A minimum age of 65 removed Adult Evening Classes from an 18–30 search; restored afterwards |
| 6 | Pass. Discontinued: gone from Direct Referral. Reactivated: back |
| 7–8 | Pass. The first send's answer was cut off on purpose (the server saved it, the browser never heard back). The page checked by Submission ID on its own and showed "Referral already received. Do not resend ! Referral ID: 1." **One** referral was saved |
| 9 | Pass. `[notification] delivery=1 referral=1 type=NEW_REFERRAL attempt=1 correlation=… outcome=SENT`. No participant data anywhere in the server log |
| 10–11 | Pass. Opened by keyboard, accepted, "Resulted in service" recorded |
| 12 | Pass. The second tab was refused: "Someone else changed this referral after you opened it, so your change was not saved…" |
| 13–14 | Pass. The sender saw "Resulted in service", and "Not appropriate: Program criteria not met" |
| 15 | Pass. Housing Help Desk went from 0 / 0 / 0 / 0 / 0 to total 2, accepted 1, not appropriate 1, resulted 1, awaiting 0 |
| 16 | Pass. Missing referral 404; a Program not managed 403; an outcome on a Not appropriate referral refused (409); the page shows "not available" |
| 17 | Pass. XL at 390 px wide: no sideways scroll on any of the six pages |
| 18 | Pass. 286 requests checked: no participant data in any URL. Storage held only `{"qchConnect.textSize":"M"}`. The only console errors were the deliberate 404 (step 16) and the deliberate cut-off (step 7) |
| 19 | Pass after fix 2. Every API 401; every page says the person is not signed in; the dev server refuses `NODE_ENV=production` |

### Run 3: separate demo identities (Chromium), October 28, 2026

Confirms the rest of the rehearsal with Task O's demo sign-in, as asked on
the card: each role is a **different** demo person in their **own**
browser window, signed in through `/demo/` on `npm run dev:demo`. A one-off
script acted as the people (not added to the suite). Starting point:
`main` at `cd22455`, fresh server. Checked against the Handoff MVP
(§4, §11, §16 to §22, §25, §27; §32 gates 1 to 3, 11, 21 to 27, 31, 33, 34).

| # | Who | Result |
| --- | --- | --- |
| 1 | Nobody | Pass. `/referral/` shows "Choose a demo person"; the API answers 401 |
| 2 | Referring Worker | Pass. Signed in from `/demo/`; every page shows "Demo sign-in. Production uses QCH Microsoft sign-in." and the name; lands on New Referral |
| 3 | Referring Worker | Pass. Find a Program: described the need ("Needs help finding housing"), reviewed the proposed answers (Housing), Find Programs, chose Housing Help Desk, sent: "Referral received ! Referral ID: 1" |
| 4 | Referring Worker | Pass. Direct Referral to Housing Help Desk: "Referral received ! Referral ID: 2" |
| 5 | Referring Worker | Pass. Referral 1 opens read-only ("You sent this referral."), no response or outcome panels; a direct response request is refused (403) |
| 6 | Housing Help Desk Staff (second window) | Pass. Both referrals in the queue. Referral 1: Accepted, then Resulted in service. Referral 2: Not appropriate, reason "Program criteria not met" |
| 7 | Older Adult Wellness Center Staff (third window) | Pass. Neither referral in the queue; the detail page says "This referral is not available"; the API answers 404 to reads and corrections |
| 8 | Referring Worker | Pass. Sees Accepted / Resulted in service, and "Reason: Program criteria not met"; referral 1 shows created by "Referring Worker (demo)" |
| 9 | Housing Help Desk Staff, two windows | Pass. A correction from the older window was refused: "Your change was not saved. Review the latest information before trying again." Outcome put back to Resulted in service |
| 10 | Window 1, **Switch person** | Pass. As Housing Help Desk Staff the sent list is empty; back as Referring Worker it has both referrals, so the identity really changes |
| 11 | Referring Worker | Pass. Reporting Center (organization, this month): total 2, accepted 1, not appropriate 1, resulted 1, awaiting 0 |
| 12 | All | Pass. 267 addresses checked across all windows: none with participant data. Browser storage empty; the session cookie is not readable by page script (HttpOnly). Server log: one `[notification] … type=NEW_REFERRAL … outcome=SENT` line per referral, IDs only, no names or needs |
| 13 | All | Pass. axe WCAG 2.2 AA: no violations on the Reporting Center (worker), referral detail (Housing staff), received list (Wellness staff), Referrals I sent (worker) |
| 14 | Reset | Pass. After a restart, the old sign-in cookie answers 401 and a fresh Housing sign-in sees 0 referrals |
| 15 | Production | Pass. `NODE_ENV=production npm start` with `QCH_DEMO_SIGN_IN=true`: `/health` 200, `/demo/` and `/demo/api/sign-in` 404, API 401 with or without a demo cookie. `NODE_ENV=production npm run dev:demo` refuses to start |

Not repeated in Run 3 (Run 1 still applies; nothing in them depends on who
is signed in): Program Management changing Find a Program results and
discontinue/reactivate (Run 1 steps 4 to 6), the cut-off first send
(steps 7 to 8), XL at phone width (step 17). Production email, Entra and
SharePoint remain QCH/QCH IT production dependencies (Handoff MVP §31), not
part of this rehearsal.

### Run 2: by hand on a Mac (to fill in)

| | |
| --- | --- |
| Date / tester | _to fill in_ |
| `main` commit | _to fill in_ |
| Browser | Safari _version_ |
| Steps passed | _to fill in_ |
| Problems | _to fill in_ |

## Found and fixed in this rehearsal

1. **The skip link didn't move the keyboard on five newer pages in
   Safari.** The pages were Received referrals (list and detail),
   Referrals I sent (list and detail) and the Reporting Center. They
   reached `main` after the screen-reader fix (#45), so their `<main>`
   could not take focus. They now can. Two new checks make sure every
   current and future page with a skip link works:
   - `test/regression/accessibility.test.js` checks the page markup.
   - `e2e/screenReader.spec.js` now covers all 13 pages in the browser.
2. **A signed-out person was told to "reload the page to try again" on New
   Referral.** In production without sign-in, reloading can't help. The
   page now says "You are not signed in, so nothing can be shown. Sign in,
   then reload this page." Other errors still suggest reloading. Covered
   by two tests in `e2e/directReferral.spec.js`.

## Not covered here

- **Demo sign-in and identity switching:** covered by Run 3.
- **Describe the need in Find a Program:** covered by Run 3, step 3.
- **Real email, Entra and Azure SQL:** they wait on QCH IT decisions
  ([pending-qch-it-decisions.md](pending-qch-it-decisions.md)).
