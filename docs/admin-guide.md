# Administrative guide

**Status: draft.** Part of the handoff documentation. It does not complete production deployment, restore verification, or QCH handoff acceptance.

How QCH staff with administrative permissions keep Programs and the
organization up to date in QCH Connect, as built today. Every action
below is checked on the server, saved together with an audit event, and
refused safely if someone else changed the same record first.

**Not available yet:**

- **Giving or removing permissions** (PRD 3.8). Permissions are stored as
  grants (see [architecture.md](architecture.md#who-may-do-what)), but no
  screen or route changes them yet. Who the first permission
  administrators are is a QCH decision
  ([qch-it-requirements.md](qch-it-requirements.md)).
- **Setting a Program's notification email** (where new-referral emails
  go).
- **Sign-in.** Until Entra sign-in exists, these screens are used with
  synthetic data only (`npm run dev:synthetic`).

## Who can do what

| Task | Permission needed |
| --- | --- |
| Edit a Program's information, discontinue or reactivate it, edit its matching facts, fields and values | `MANAGE_PROGRAM` for that Program |
| Change a shared field's wording or options, replace or discontinue it | `MANAGE_PROGRAM` for **every** Program that uses the field |
| Retire a field | `MANAGE_ORGANIZATION` (organization-wide), and only 90 days after it was discontinued (see the note below) |
| Create a Program, move a Program to another Department, create or rename a Department, discontinue or reactivate a Department | `MANAGE_ORGANIZATION` |

**About the 90 days:** the exact 90-day wait before a field can be retired
is the team's implementation decision (`RETIRE_AFTER_DAYS` in
`src/programs/fieldService.js`), not confirmed QCH policy. QCH may set a
different period.

Creating a Program does **not** give anyone permission to manage it. Its
managers need a `MANAGE_PROGRAM` grant first.

## Program Management (`/program-management/`)

### Edit a Program's information

1. Choose the Program and select **Open Program**. Discontinued Programs
   stay in the list.
2. Edit site, description, eligibility notes, schedule notes or cost
   notes. All are optional; clearing a box removes the saved value.
3. Select **Save changes**.

Name, Department and notification email are not edited here.

### Discontinue or reactivate a Program

Use the status button on the Program. A discontinued Program disappears
from new referral choices but keeps its past referrals. A Program can be
reactivated only while its Department is active.

### Edit matching facts

**Matching information** on a Program sets what Guided Program Matching
checks: the needs it serves, its age limit and its service area (the ZIP
codes where participants must live). Each limit has four states:

| State | Meaning | What matching does |
| --- | --- | --- |
| Set | A limit is on file | Checks it |
| No restriction | Confirmed: no such limit | Never removes the Program for it |
| Not on file | Nobody has entered it | Shows the Program as "possible", never as "no limit" |
| Other limit | A limit these fields cannot express | Treated like Not on file, explained differently |

**Languages of service** are on the same page. Tick every language staff
can serve participants in; a Program can have several. Ticking none means
the languages are **not on file**, which is never read as "English only".
Find a Program shows them on each result ("Languages of service: English,
Spanish" or "not on file"). Matching does not use them: a Program is never
hidden because of its languages. A language that is no longer offered stays
on a Program that already has it, marked "discontinued; existing selection".

### Program fields

**Program fields** holds extra information beyond the common boxes.

| To | Do this |
| --- | --- |
| Add a new kind of information | **Create a Program information field**: label, type (text, number, date, yes or no, choose one, choose several), options for choice types, required or not |
| Use a field another of your Programs already has | **Reuse an existing field**. The definition is shared; saved values are not copied |
| Fix the wording without changing the meaning | **Rename field**. Every Program sharing it sees the new wording |
| Change what the field means | **Replace field meaning**. The old field is discontinued for every Program and keeps its saved values as history; the new field starts empty |
| Stop collecting it | **Discontinue field**. Values stay visible as history |
| End it for good | **Retire field** (organization permission, 90 days after discontinuing; see the note below). Deletes nothing |
| Manage choices | Add, rename, discontinue or reactivate an option. A choice field always keeps at least one active option |

### Departments (`/program-management/organization.html`)

Create, rename, discontinue or reactivate a Department. A Department with
active Programs cannot be discontinued: move or discontinue its Programs
first. Names are unique, ignoring upper and lower case.

### Create or move Programs (`/program-management/organization-programs.html`)

- **Create a Program:** name, an active Department, and optional site and
  information. The same name at the same site is refused; the same name at
  another site is allowed.
- **Move a Program:** choose the Program and an active Department. Past
  referrals keep the Department they had when they were sent, so reports
  do not change.

## When a save is refused

| Message says | What happened | What to do |
| --- | --- | --- |
| "...changed..." / "Reload saved..." | Someone else saved a newer version first. Your typed work is still on screen | Reload, review what is saved now, and make your change again |
| "Save outcome is not confirmed" | The connection dropped; the change may or may not have saved | Reload before trying again, so nothing is saved twice |
| "...permission..." | You do not hold the permission for this record | Ask a permission administrator |
| A field is marked with an error | Something is missing or invalid; focus moves to it | Fix it and save again |
