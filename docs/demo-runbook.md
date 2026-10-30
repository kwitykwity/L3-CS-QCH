# Nov. 9 demo runbook (Task T)

One page for whoever presents. Follow it top to bottom; nothing else
needs to be known. About **15 minutes** for the main journey, plus
optional extras. Every person, Program and referral in the demo is
**synthetic**. Final Technical PRD 16.4 ("Plan B" demo), 2.1 to 2.4, 6, 8,
11, 12.

Verified on `main` at `36f6e82` (October 26, 2026): every checkpoint below
was run, and the text in the "You should see" column is copied from the
screen.

More detail, if needed: the demo environment's safety checks are in Task S
(PR #55, `docs/demo-environment.md`); the full rehearsal record is in
Task R (PR #56, `docs/demo-rehearsal.md`).

## 1. Before the demo (day before, then again 30 minutes before)

On the presenting laptop (Node.js 24 installed):

```bash
git checkout main
git pull --ff-only
npm ci
cp .env.example .env        # sets NODE_ENV=development; nothing else is read
npm test                    # must end with "fail 0"
```

Then start the demo server and **leave this terminal visible**. The
notification lines appear in it:

```bash
npm run dev:synthetic
```

Open **Safari or Chrome** at `http://127.0.0.1:3000/`. Text size **M**.
Desktop width (see limitation L5).

**Reset** (before the demo, and any time something goes wrong): in the
terminal press `Ctrl+C`, run `npm run dev:synthetic` again, and reload the
browser. Every referral and change is gone, and the app is back to its
starting state. All demo data lives in memory and is rebuilt on every
start. Nothing is written to disk or a database.

## 2. Who you are in the demo

There is **one synthetic person** (user 1). They play every role. Demo
sign-in and switching between people is Task O and is not on `main`.
**Do not click anything to "switch user"; there is nothing to click.**
Instead, **say out loud** which role you are playing at each step:

| Part | Say | What user 1 is allowed to do |
| --- | --- | --- |
| Referral | "I'm a worker at Early Childhood Playgroup" | Send referrals from the Program chosen as affiliation |
| Receiving | "Now I'm the Housing Help Desk team" | Receive, respond and record outcomes for **Housing Help Desk only** |
| Program Management | "Now I'm the Program Director for Adult Evening Classes" | Manage Adult Evening Classes (and the discontinued Retired Sample Program) |
| Reporting | "Anyone with access sees aggregate numbers" | Every signed-in person can see aggregate reports |

Separate people with separate permissions *are* built and tested, but in
automated tests only (`e2e/receivingLifecycle.spec.js`, `test/regression/`).
Say so if asked. Don't demonstrate it.

## 3. The demo journey

| # | Do | You should see |
| --- | --- | --- |
| 1 | Home page | Links: New referral, Program Management, Referrals I sent, Received referrals, Reporting Center. Footer: "Development build. Use synthetic data only." |
| 2 | **New referral**. Under "Your Program affiliation", choose **Early Childhood Playgroup (sample) (Site A)** → Save affiliation | Nothing was preselected. "Your Program affiliation is saved: Early Childhood Playgroup (sample)." |
| 3 | **Help me find a Program**. Need: **Employment (sample)**; ages **20** to **25** → Find Programs | "Programs that may fit … They are not an eligibility decision." **Plausible matches:** Adult Evening Classes (sample): "Offers: Employment (sample) · Serves ages 18 and up · No area limit". **Possible matches:** Job Readiness Workshop (sample): "Age limits not on file". Point out: each result explains itself, and "not on file" is never treated as "no limit" |
| 4 | Change the need: untick Employment, tick **Housing (sample)**, clear the ages → Find Programs | **Possible match:** Housing Help Desk (sample): "Serves residents of a specific area; confirm with the program" |
| 5 | **Choose Housing Help Desk (sample)**. Participant name **Sample Person A**; Phone call **(555) 010-0101**; What do they need: **Needs help with a housing application (sample)** → **Send referral** | "Referral received ! Referral ID: 1." |
| 6 | Point at the **terminal** | `[notification] delivery=1 referral=1 type=NEW_REFERRAL attempt=1 … outcome=SENT`. See section 4 |
| 7 | **Referrals I sent** | Referral 1: Sample Person A. "Awaiting response from Housing Help Desk (sample)." Response: Awaiting response. Decision: No decision yet |
| 8 | Say "Now I'm Housing Help Desk." **Received referrals** → open **Referral 1** | Full detail, with three separate steps: 1. Response, 2. Decision, 3. Service outcome |
| 9 | Decision **Accept** → Send response → confirm | Dialog: "Accept this referral? Accepting does not record that service happened." Then: "Response sent: Accepted. The service outcome is not recorded yet." |
| 10 | Service outcome **Resulted in service** → **Record outcome** → confirm | "Service outcome recorded: Resulted in service." |
| 11 | Say "Back to the worker." **Referrals I sent** | Referral 1: "Complete." Decision Accepted; Service outcome Resulted in service |
| 12 | **New referral** → **I know the Program** → Housing Help Desk (sample) → Continue to referral details. Name **Sample Person B**; contact **No reliable contact**; need **Looking for a shelter bed tonight (sample)** → Send | "Referral received ! Referral ID: 2." |
| 13 | **Received referrals** → Referral 2 → **Not appropriate** → reason **Program criteria not met** → Send → confirm | Dialog: "Mark this referral Not appropriate? The referring worker will see the reason you chose." Then: "Response sent: Not appropriate." |
| 14 | **Referrals I sent** | Referral 2: Decision "Not appropriate: Program criteria not met". Service outcome "Not applicable (the decision is Not appropriate)". Nothing was rerouted automatically |
| 15 | **Reporting Center** (opens on this month, All of QCH) | See section 5 |
| 16 | Say "Now I'm the Program Director." **Program Management** → choose Adult Evening Classes (sample) → **Open Program** → **Manage matching information**. The age rule is already "Limit on file"; change the minimum age to **65** → **Save matching information** | "Matching information saved." |
| 17 | **New referral** → Help me find a Program → Employment, ages 20 to 25 → Find Programs | Adult Evening Classes is **gone**; only Job Readiness Workshop remains (possible). A Program change takes effect on the very next search |

To put step 16 back afterwards, set the minimum age to 18, or reset (section 1).

### Optional extras (if time allows)

- **Failed notification:** Direct Referral to **Job Readiness Workshop (sample)**. The referral is saved ("Referral received ! Referral ID: 3."), and the terminal shows `outcome=FAILED category=NO_RECIPIENT`. That Program deliberately has no notification address: a failed email never loses a referral. Do this **after** step 15, because it adds a referral to the counts.
- **Two people at once:** open Referral 1 in two tabs. Correct the outcome in one tab, then try a correction in the other. The second tab says "Your change was not saved" and shows what is saved now.
- **Text size:** S / M / L / XL at the top of every page; work in progress is kept.
- **Keyboard only:** the whole referral form works with Tab, Space and Enter.

## 4. Notification behavior to expect

- **No email is ever sent.** Notifications go to a simulated outbox inside
  the demo server. Each new referral writes one line to the terminal, with
  IDs only (no names and no need text): `[notification] delivery=N
  referral=N type=NEW_REFERRAL attempt=1 correlation=… outcome=SENT`.
- Job Readiness Workshop shows `outcome=FAILED category=NO_RECIPIENT` on
  purpose.
- **Say:** "In production this becomes a generic email through QCH's
  Microsoft 365 shared mailbox, once QCH IT sets that up. The email never
  contains participant details."

## 5. Reporting result to expect (after steps 1 to 14, from a fresh start)

Reporting Center, **Monthly, All of QCH** (the default):

| Total referrals | Awaiting response | Accepted | Not appropriate | Resulted in service | Did not result |
| --- | --- | --- | --- | --- | --- |
| 2 | 0 | 1 | 1 | 1 | 0 |

- **Acceptance rate 50%** (1 of 2); **Not appropriate rate 50%** (1 of 2);
  **Resulted-in-service rate 100%** (1 of 1).
- **By Program:**
  - Early Childhood Playgroup: made 2.
  - Housing Help Desk: received 2, accepted 1, not appropriate 1, resulted 1.
- **By Department:**
  - Youth Services: made 2.
  - Adult Services: received 2.
- **Times** (time to first response, time to recorded service) are real
  elapsed times between the steps during the demo, so they depend on the
  presenter's pace: often "Under 1 minute" or a few minutes. Any value is
  correct. A different time does **not** mean the server wasn't reset.
- The page says "Incomplete period". That is correct: the month isn't over.

If the **counts** differ (total, accepted, not appropriate, resulted), the
server wasn't reset before the demo. Reset and repeat, or explain that the
counts include earlier practice referrals.

## 6. If something fails

| Problem | Do this |
| --- | --- |
| Find a Program shows "Unable to perform matching right now. This is a technical problem, not a result." (step 3 or 4) | That is the designed fallback (PRD 8.8); say so. Click **Use Direct Referral**, tick **Housing Help Desk (sample)**, **Continue to referral details**, then do **step 5** as written from "Participant name". It is still Referral ID 1, and steps 6 to 16 and section 5 stay exactly the same. The only difference is that the referral is saved as a Direct Referral instead of Find a Program, which the Reporting counts don't show. If matching is still down at step 17, skip step 17 and say the Program change applies to the next search once matching is back |
| The browser asks "Leave page?" when you change pages | That's the unsaved-work protection (PRD 7.6). Choose **Leave** |
| A send says "Referral not confirmed !" | Click **Check whether it was received**. It confirms without sending twice. Never press Send again until it answers |
| A list or report won't load | Click the page's **Try again** or **Reload** button. If it still fails, reset (section 1) and resume from step 2 |
| No notification line appears | Not critical. The referral is still in Received referrals; continue |
| Reporting numbers are off | See section 5 |
| The demo laptop fails | A second laptop prepared with section 1 the day before. Start from step 1 |
| Anything else | Reset, and resume the journey from step 2 (about 1 minute) |

Never improvise a feature that isn't in this runbook. Never show data that
isn't synthetic.

## 7. Known limitations: say them plainly if asked

- **L1** One synthetic person plays every role. Demo sign-in and switching
  between staff is Task O.
- **L2** The demo runs on the presenting laptop only (`127.0.0.1`). Data is
  in memory and vanishes on reset. That is intended for a demo.
- **L3** Notifications are simulated (section 4).
- **L4** "Describe the need in your own words" (PR #43) is **not on `main`**.
  Don't present it unless it has merged and this runbook has been updated.
  The requirement is recorded as confirmed by QCH, but two team decisions
  about it are still open: R3 and R4 in
  [requirements-reconciliation-register.md](requirements-reconciliation-register.md).
- **L5** Known issue #46: at XL text on a phone-width screen, the New
  Referral entry screen doesn't fit. Present at desktop width.
- **L6** Matching uses need, age range and ZIP only. Results are
  suggestions, not eligibility decisions.

## 8. QCH IT items that must NOT be presented as done

The production architecture is **confirmed** by the Frozen Handoff PRD, but
QCH and QCH IT have **not provisioned it**, and the demo shows none of it.
Nobody should say any of these is finished. Full list:
[production-architecture.md](production-architecture.md).

1. **Data:** SharePoint Lists in a private QCH Connect site, no separate
   database (confirmed, not provisioned). The demo uses in-memory synthetic
   data. The Azure SQL schema in `db/` is an earlier-plan design, not the
   production store.
2. **Server side:** Azure Functions with a managed identity (confirmed, not
   provisioned). Where the frontend is hosted is still a QCH IT decision.
3. **SharePoint site access:** direct access for QCH IT administrators only,
   Graph `Sites.Selected` (confirmed, not provisioned).
4. **Archive behavior:** confirmed (2,500 active referrals, archive the 500
   oldest eligible closed ones, never open or Awaiting Response), not built.
5. **QCH Microsoft (Entra) sign-in with MFA:** confirmed, not configured or
   built. Production currently refuses every request without sign-in (it
   fails closed). The demo's own sign-in is synthetic and never used in
   production.
6. **Email through Microsoft Graph and the shared mailbox, restricted through
   Exchange RBAC:** confirmed, not connected.
7. **Any AI or language-processing service:** not part of the MVP, not used.
   The app sends nothing to an outside service.
8. **Retention/deletion policy:** still a QCH decision.

Also not done: production deployment, QCH handoff acceptance, and real
QCH Program data. The app has never run in QCH's environment.

**Safe wording:** "This is the working application on synthetic data. The
production architecture is agreed with QCH IT (SharePoint, Azure Functions,
Microsoft sign-in and email), and it still has to be set up in QCH's
environment; we have not connected it."
