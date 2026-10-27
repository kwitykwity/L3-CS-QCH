# Describe-the-need step and PRD 8.2 (proposed reconciliation)

**Status: PROPOSED. Not approved.** This is the team's reading of how the
free-text step (Task D) sits with Final Technical PRD 8.2. A reading in a
pull request is not a reconciliation. It becomes one only when the PRD
owner approves it and the PRD is updated to match. Until then, treat the
free-text step as outside the approved PRD. The PRD text itself is not in
this repository, so the wording of 8.2 below is taken from how the code
cites it.

## What 8.2 is understood to require

Matching reads three approved inputs only: need categories, age range and
participant ZIP. Anything else a caller sends is ignored or refused
(`src/gpme/matchPrograms.js`, `src/gpme/validateMatchRequest.js`).

## What the new step adds

A worker may type up to 500 characters describing the need. That text is a
fourth thing the application receives from the worker. It is not a
matching input:

| Question | Where it is enforced |
| --- | --- |
| Does the text reach `/api/gpme/match`? | No. `toMatchRequest` builds the match body from the three confirmed answers; `validateMatchRequest` refuses any other field. Browser test "the description never rides along with the referral". |
| Does the text reach the referral? | No. The test above reads the real `POST /api/referrals` body and finds neither the text nor any extra key under `gpme`. |
| Is the text stored, logged or returned? | Designed not to be (`ruleBasedInterpreter.js` header, `gpmeService.js`); the text appears in no response, and the browser test finds it in no storage or URL. |
| Who decides the criteria? | The worker. The interpreter only proposes; matching runs after the worker corrects and confirms, using the three approved inputs. |
| Is any external service called? | No. The v1 interpreter is rules in the application. |

## Why this may be consistent with 8.2

8.2 limits what the matching engine may use. The engine is unchanged and
still receives only the three inputs, from a worker who confirmed them.
The free text is used before matching, to pre-fill those inputs.

## What still needs the PRD owner's decision

1. Does 8.2 limit what the application may **collect** from a worker, or
   only what **matching** may use? If the first, this step needs a PRD
   change before release.
2. Is a free-text description acceptable under the rule that participant
   details are kept to what is needed (PRD 5.3, 5.4)? Workers can type
   anything, including participant details, into a free-text box. The code
   does not store the text, but it cannot stop a worker typing sensitive
   information into it.
3. May the interpreter be replaced later by something more capable? The
   layer is built to be replaceable, but any replacement that sends text
   outside the application is a separate decision with QCH IT, covered by
   [ai-interpretation-options.md](ai-interpretation-options.md) when that
   page is on this branch.

Decision, date and approver: **none recorded.**

## Hardening pass (interpreter `interpret-rules-v2`)

- No age range is assumed from words like "teen" or "elderly"; the worker enters it. Two or more ages ("ages 6 and 9") propose none; "and" makes a range only after "between".
- A ZIP is read only straight after ZIP wording ("ZIP 11101"), never from a bare five-digit number.
- A plainly refused service ("doesn't need housing") is not proposed. This is a short list of refusal phrases inside one clause, not a negation engine.
- Everyday wording is attached to a category by its `needCategoryId`, so renaming a category does not change what is recognized. A category with no attachment is read by its current name words only. Attaching wording to QCH's real categories needs their ids and is a QCH / Program Management decision.
- The server validates the whole interpreter output (`validateInterpretation.js`) before the worker sees it: active category ids, whole-number ages 0 to 120, a five-digit ZIP, fixed note codes, short vocabulary terms. Anything else makes the whole interpretation fail as UNABLE_TO_INTERPRET.
- The description limit is 500 characters on the server, in the page, and in the screen logic.
- Language is not a matching criterion, so a language mismatch never excludes a Program. Showing a Program's available languages is not part of this pass.
