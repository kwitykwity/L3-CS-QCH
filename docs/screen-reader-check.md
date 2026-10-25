# Screen-reader check (VoiceOver)

Trello: "Testing: Screen reader" (Final Technical PRD 14.3, 14.4, 17.7).
Done when: the reader and browser used are recorded, and labels, required
fields, errors, status announcements, dialogs and focus changes have been
verified by listening.

Two parts:

1. **Automated** (`e2e/screenReader.spec.js`, runs in `npm run test:e2e`):
   checks what a screen reader is *given*: each control's role, name,
   required and invalid state, description (hint or error), dialog names
   and modality, where focus goes, and every live-region announcement in
   order. It runs in Chromium on every change.
2. **Manual** (this page): a person listens with a real screen reader,
   because how a reader actually speaks and when it interrupts can only
   be checked by ear (PRD 17.7).

Synthetic data only. Never use real participant information.

## Record

| | |
| --- | --- |
| Date | October 24–25, 2026 |
| Tester | Jimmy Ong |
| Screen reader and version | VoiceOver, macOS Tahoe 26.7.1 (Intel MacBook Pro) |
| Browser and version | Safari 27.0 (21625.1.29.18.28) |
| App version | branch `jimmy/screen-reader-check`: first run on `71f861d`; fixes re-checked by ear on `52242b2` and `8bbbf10`; `npm run dev:synthetic` |
| Overall result | **Pass** after four fixes found in this run (see "Found and fixed in the VoiceOver run"). Every step below was heard. |

Write **OK** in the Result column when you heard what is expected, or
write what you heard instead.

## Setup (about 5 minutes)

1. In the project folder: `npm run dev:synthetic`. Leave it running.
2. Open **Safari** at `http://127.0.0.1:3000/referral/`.
3. Turn VoiceOver on: **Cmd + F5** (again to turn it off).
4. Keys used below. **VO** means **Control + Option**, held together.
   - **Tab / Shift+Tab**: next / previous control.
   - **VO + Right / Left arrow**: read the next / previous item.
   - **VO + Space**: press the focused button or choose an item.
   - **VO + U**: the rotor (lists of headings, form controls, landmarks).
     Use Left/Right to change list, Up/Down to move, Escape to close.
   - **Control**: stop speaking.
5. If Safari skips buttons with Tab, turn on Safari > Settings > Advanced >
   "Press Tab to highlight each item on a webpage".

## A. New Referral: Direct Referral

| # | Do | Expect to hear (roughly) | Result |
| --- | --- | --- | --- |
| A1 | Load the page, press **VO + U**, open the **Headings** list | "New Referral, heading level 1", then the level-2 headings || OK |
| A2 | Rotor, **Landmarks** list | "banner" and "main" || OK |
| A3 | Reload; press **Tab** once | "Skip to main content, link"; VO + Space jumps into the page || Fixed, then OK: before the fix the next Tab went back to the Text size buttons |
| A4 | Tab to the affiliation dropdown | "Your Program, pop-up button" (or "menu button"); it says it is required || Fixed, then OK: before the fix it said "invalid data" |
| A5 | Tab to the two path buttons | "Help me find a Program … toggle button"; "I know the Program … toggle button" || OK |
| A6 | Press **VO + Space** on "I know the Program" | "selected" / "pressed"; focus moves to "Direct Referral, heading level 3"; **no "check mark"** is read || OK: "selected" heard when coming back with Shift+Tab; no "check mark" |
| A7 | Choose a Program, go to "Continue to referral details", press VO + Space | Focus moves to "2. Referral details, heading level 2" || OK |
| A8 | Tab to "Participant name" | "Participant name, required, edit text". **Must NOT say "Error"** while the field is fine || Fixed, then OK: before the fix it said "invalid data" |
| A9 | Tab to the contact radios | Group name "Best way to reach them", then each choice, e.g. "Phone call, radio button, 1 of 4" || OK |
| A10 | Choose Email, Tab to the box | "Email address, required, edit text" || OK |
| A11 | Tab to "What do they need?" | Name, "required", and the hint "Visible to you and to staff authorized for the receiving Program." || OK |
| A12 | Clear every field; go to "Send referral", press VO + Space | "Some information needs attention. Nothing was sent." is announced; focus lands on "Participant name" and it says "invalid data" and "Error: Enter the participant's name." || Fixed, then OK: before the fix the summary was not heard |
| A13 | Type a name | The field stops saying "invalid" / "Error" || OK |
| A14 | Fill everything, choose "No reliable contact", send | "Sending referral …" (may be cut short), then "Referral received ! Referral ID …" || OK: "Referral received !" and the ID heard. "Sending referral …" not heard: on a local machine the send takes milliseconds |
| A15 | Start a new referral, type a name, Tab to **Cancel**, press VO + Space | "Discard this referral ?, dialog", then "The information you entered has not been sent…"; focus on "Keep editing, button" || OK |
| A16 | Press **Escape** | Dialog closes; focus is back on "Cancel"; the name is still typed || OK |

## B. New Referral: guided matching

| # | Do | Expect to hear (roughly) | Result |
| --- | --- | --- | --- |
| B1 | Reload; choose "Help me find a Program" | "selected"; focus to "Guided matching, heading level 3" || OK |
| B2 | Tab into the needs | Group "What does the participant need?", "Choose all that apply.", then each checkbox by name || OK |
| B3 | Tab to the age boxes | "From, edit text" and "to, edit text", with the hint about a range || OK |
| B4 | With no need ticked, press "Find Programs" | "Some answers need attention. Nothing was searched." and focus on the first need; the needs say "Choose at least one need." || Fixed, then OK: before the fix "Nothing was searched." was not heard |
| B5 | Tick "Employment (sample)", press "Find Programs" | Focus moves to "Programs that may fit, heading level 3"; VO + Right reads the note that the order does not rank them, then each Program with "What matching found" || OK |
| B6 | Tick only "Childcare (sample)", enter age 40 to 45, search | "No plausible match identified. This does not mean QCH has no appropriate Program…" || OK |

## C. Program Management

Open `http://127.0.0.1:3000/program-management/`.

| # | Do | Expect to hear (roughly) | Result |
| --- | --- | --- | --- |
| C1 | Rotor, **Landmarks** | "Main navigation, navigation" and "main" || OK |
| C2 | Without choosing, press "Open Program" | "Choose a Program first." || OK: no "invalid data" on the Program dropdown |
| C3 | Tab to the Program dropdown | "Program, required, pop-up button" || OK (heard in C2) |
| C4 | Choose a Program, press "Open Program" | Focus moves to the Program's name, read as a heading || OK |
| C5 | Tab through the fields | "Site", "Description", "Eligibility notes", "Schedule notes", "Cost notes", each read as an edit field || OK |
| C6 | Change "Description", press "Save changes" | "Saving…" (may be cut short), then "Changes saved." || OK |
| C7 | Press "Discontinue Program" | "Confirm action, dialog", the question, focus on "Keep editing" || OK |
| C8 | Press **Escape** | Dialog closes, focus back on "Discontinue Program", nothing changed || OK |
| C9 | On **Program fields**, start an edit, then press "Reload" | Safari's own confirm box is read: the question, then "Cancel" and "OK" || OK |

## D. Text size with VoiceOver on

| # | Do | Expect to hear (roughly) | Result |
| --- | --- | --- | --- |
| D1 | On the referral form, Tab to the text-size buttons | "Text size, group"; "M, selected, toggle button" || OK: "M, selected, toggle button" |
| D2 | Choose "XL" | "XL, selected"; what you typed is still there || OK: text gets bigger; "XL, selected" when revisited |

## Listen especially for

- **Announcements from boxes that appear.** "Sending referral …",
  "Saving…" and similar messages appear in a box that was hidden a moment
  before. Some screen readers skip those. If VoiceOver says nothing for A14
  or C6 *until* the final message, note it. The final messages are safe:
  focus moves to them, so they are read.
- **Anything that says "Error" when there is no error** (see Fixed, below).
- **Double reading** of one message (once as an announcement, once as
  focus moves to it). Note it if it is distracting.

## Fixed while preparing this check

Both were found by the automated part, before the listening run:

1. **Every field said "Error:" while it was valid.** Each field points at
   its error element, which is hidden and empty until there is an error.
   Screen readers still read it, and the CSS added "⚠ Error: " in front of
   it. The prefix now appears only when there is an error, and readers
   hear just "Error:", without the symbol.
2. **"Check mark" read before the chosen path button.** The ✔ is
   decorative, and the button already says "selected". It is now hidden
   from screen readers.

## Found and fixed in the VoiceOver run

Chromium-based tests cannot hear these; each now has an automated check
so it cannot come back unnoticed.

1. **"Invalid data" on fields nobody had touched** (A4, A8). Safari
   reports an empty required field as invalid unless the page says
   otherwise. The New Referral fields now say `aria-invalid="false"`
   until there is an error, and go back to it when the error is fixed.
2. **The skip link did not move the keyboard** (A3). Safari only moves
   keyboard focus to a target that can take focus, so the next Tab went
   back to the Text size buttons. `<main>` can now take focus, on New
   Referral and every Program Management page.
3. **"Nothing was sent." was never heard** (A12). The message appears at
   the same moment focus moves to the first problem (PRD 14.3), and
   VoiceOver drops it. The first problem field now also carries the
   message until it is fixed.
4. **"Nothing was searched." was never heard** (B4). On a checkbox or
   radio, VoiceOver reads the group's description rather than the box's,
   so the message goes on the group (needs; best way to reach them).

## Results

- **Pass.** All 33 steps heard as expected on VoiceOver + Safari after
  the fixes above.
- "Sending referral …" (A14) and "Saving…" (C6) are replaced within
  milliseconds on a local machine, so only the final message is heard.
  That is expected; worth one listen on QCH's network once hosted.
- When pressing a button, use Space while the keyboard ring is on it.
  Once, VoiceOver's own cursor was still on "S" and Space chose S
  instead of XL. That is VoiceOver, not the app.
- A server restart shows "Your affiliation was changed elsewhere…
  Choose again." on an open page. That is the designed stale-version
  protection, not a defect (the synthetic server keeps data in memory).

### For follow-up (not changed here)

- **Program Management sub-pages** (Program fields, matching, field reuse
  and replacement, organization): the current text size is announced
  ("selected") but not highlighted on screen. These are #32 pages; raised
  with the owner rather than changed here.
- **Program Management forms** use native required fields and rely on
  the browser's own validity. They read correctly in this run (C2), but
  should get the same `aria-invalid="false"` treatment as New Referral if
  "invalid data" is heard on them before any input.
- **Windows:** Christina ran Windows Narrator with Chrome and Edge on
  selected Program Management workflows (recorded on #32). NVDA, and
  Narrator on New Referral, have not been run. Add a second record if
  QCH staff use Windows screen readers.
- **Screens that reached `main` after this run** were not part of it:
  the receiving screens (Task A, #37), the Reporting Center (#41) and the
  current Program information work (Task C, #44). The receiving and
  Reporting pages' `<main>` cannot take focus yet, so the Safari skip-link
  problem fixed here (A3) may apply to them; worth the same one-line fix
  and a short listening pass.
