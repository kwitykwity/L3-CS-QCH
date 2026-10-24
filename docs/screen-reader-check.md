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
| Date | _to fill in_ |
| Tester | _to fill in_ |
| Screen reader and version | VoiceOver, macOS _version_ |
| Browser and version | Safari _version_ (VoiceOver's main browser); optional second run in Chrome _version_ |
| App version | commit _sha_ on `main`, `npm run dev:synthetic` |
| Overall result | _to fill in_ |

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
| A1 | Load the page, press **VO + U**, open the **Headings** list | "New Referral, heading level 1", then the level-2 headings | |
| A2 | Rotor, **Landmarks** list | "banner" and "main" | |
| A3 | Reload; press **Tab** once | "Skip to main content, link"; VO + Space jumps into the page | |
| A4 | Tab to the affiliation dropdown | "Your Program, pop-up button" (or "menu button"); it says it is required | |
| A5 | Tab to the two path buttons | "Help me find a Program … toggle button"; "I know the Program … toggle button" | |
| A6 | Press **VO + Space** on "I know the Program" | "selected" / "pressed"; focus moves to "Direct Referral, heading level 3"; **no "check mark"** is read | |
| A7 | Choose a Program, go to "Continue to referral details", press VO + Space | Focus moves to "2. Referral details, heading level 2" | |
| A8 | Tab to "Participant name" | "Participant name, required, edit text". **Must NOT say "Error"** while the field is fine | |
| A9 | Tab to the contact radios | Group name "Best way to reach them", then each choice, e.g. "Phone call, radio button, 1 of 4" | |
| A10 | Choose Email, Tab to the box | "Email address, required, edit text" | |
| A11 | Tab to "What do they need?" | Name, "required", and the hint "Visible to you and to staff authorized for the receiving Program." | |
| A12 | Clear every field; go to "Send referral", press VO + Space | "Some information needs attention. Nothing was sent." is announced; focus lands on "Participant name" and it says "invalid data" and "Error: Enter the participant's name." | |
| A13 | Type a name | The field stops saying "invalid" / "Error" | |
| A14 | Fill everything, choose "No reliable contact", send | "Sending referral …" (may be cut short), then "Referral received ! Referral ID …" | |
| A15 | Start a new referral, type a name, Tab to **Cancel**, press VO + Space | "Discard this referral ?, dialog", then "The information you entered has not been sent…"; focus on "Keep editing, button" | |
| A16 | Press **Escape** | Dialog closes; focus is back on "Cancel"; the name is still typed | |

## B. New Referral: guided matching

| # | Do | Expect to hear (roughly) | Result |
| --- | --- | --- | --- |
| B1 | Reload; choose "Help me find a Program" | "selected"; focus to "Guided matching, heading level 3" | |
| B2 | Tab into the needs | Group "What does the participant need?", "Choose all that apply.", then each checkbox by name | |
| B3 | Tab to the age boxes | "From, edit text" and "to, edit text", with the hint about a range | |
| B4 | With no need ticked, press "Find Programs" | "Some answers need attention. Nothing was searched." and focus on the first need; the needs say "Choose at least one need." | |
| B5 | Tick "Employment (sample)", press "Find Programs" | Focus moves to "Programs that may fit, heading level 3"; VO + Right reads the note that the order does not rank them, then each Program with "What matching found" | |
| B6 | Tick only "Childcare (sample)", enter age 40 to 45, search | "No plausible match identified. This does not mean QCH has no appropriate Program…" | |

## C. Program Management

Open `http://127.0.0.1:3000/program-management/`.

| # | Do | Expect to hear (roughly) | Result |
| --- | --- | --- | --- |
| C1 | Rotor, **Landmarks** | "Main navigation, navigation" and "main" | |
| C2 | Without choosing, press "Open Program" | "Choose a Program first." | |
| C3 | Tab to the Program dropdown | "Program, required, pop-up button" | |
| C4 | Choose a Program, press "Open Program" | Focus moves to the Program's name, read as a heading | |
| C5 | Tab through the fields | "Site", "Description", "Eligibility notes", "Schedule notes", "Cost notes", each read as an edit field | |
| C6 | Change "Description", press "Save changes" | "Saving…" (may be cut short), then "Changes saved." | |
| C7 | Press "Discontinue Program" | "Confirm action, dialog", the question, focus on "Keep editing" | |
| C8 | Press **Escape** | Dialog closes, focus back on "Discontinue Program", nothing changed | |
| C9 | On **Program fields**, start an edit, then press "Reload" | Safari's own confirm box is read: the question, then "Cancel" and "OK" | |

## D. Text size with VoiceOver on

| # | Do | Expect to hear (roughly) | Result |
| --- | --- | --- | --- |
| D1 | On the referral form, Tab to the text-size buttons | "Text size, group"; "M, selected, toggle button" | |
| D2 | Choose "XL" | "XL, selected"; what you typed is still there | |

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

Both were found by the automated part:

1. **Every field said "Error:" while it was valid.** Each field points at
   its error element, which is hidden and empty until there is an error.
   Screen readers still read it, and the CSS added "⚠ Error: " in front of
   it. The prefix now appears only when there is an error, and readers
   hear just "Error:", without the symbol.
2. **"Check mark" read before the chosen path button.** The ✔ is
   decorative, and the button already says "selected". It is now hidden
   from screen readers.

## Results

_To fill in after the run: what passed, what you heard differently, and
any follow-up cards._
