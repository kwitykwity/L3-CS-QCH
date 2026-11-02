// Current Program information shown with Find a Program results (Task X;
// fixed fields added in Task 204).
//
// QCH confirmed (Kyle) that Programs with limited availability or a wait
// list still appear, with that information visible, and that the primary
// Program contact may be shown while staff still send the referral through
// QCH Connect first.
//
// Reuses the Task C read model (readCurrentProgramInformation). Two kinds
// of rows are shown, in this order:
//   1. Fixed Program fields the frozen documents name (Handoff PRD 8, 9;
//      Handoff MVP 10): Program Description, Schedule, Eligibility notes.
//      A blank one is OMITTED, never shown as "none" or guessed.
//   2. Flexible fields, with the label staff maintain. Field meaning is
//      never inferred from a label.
// The fixed costNotes property is not displayed here. This is a Task 204
// scoping decision, not a prohibition: Handoff PRD 8, 9 and Handoff MVP 10
// name description, schedule and eligibility information but not cost, and
// no approval for cost is recorded. A flexible field that staff label
// "Cost notes" is shown like any other flexible field.
//
// This is descriptive only: it is attached AFTER matching and never adds,
// removes, or reorders a result. A full, limited, or wait-listed Program
// stays in the results.
//
// Allowlisted projection: label and display value only. No field IDs,
// versions, option IDs, notification routing, permissions, or participant
// or referral data.
import { readCurrentProgramInformation } from '../programs/currentProgramInformation.js';

// The fixed fields that may appear, in display order. The eligibility label
// says plainly that this is information: QCH Connect never decides
// eligibility (Handoff PRD 6.6).
export const FIXED_INFORMATION = Object.freeze([
  { key: 'description', label: 'Program Description' },
  { key: 'scheduleNotes', label: 'Schedule' },
  { key: 'eligibilityNotes', label: 'Eligibility notes (information only, not an eligibility decision)' },
]);

function optionLabels(field, ids) {
  const labels = new Map(field.options.map((option) => [option.optionId, option.label]));
  return ids.map((id) => labels.get(id)).filter((label) => typeof label === 'string');
}

// Display text for one field, or null when nothing is on file. A missing
// value stays unknown: it is never shown as "available" or "none".
export function displayValue(field) {
  const { dataType, value } = field;
  if (value === null || value === undefined) return null;
  switch (dataType) {
    case 'TEXT': return value.trim() === '' ? null : value;
    case 'NUMBER': return Number.isFinite(value) ? String(value) : null;
    case 'DATE': return typeof value === 'string' ? value : null;
    case 'BOOLEAN': return value === true ? 'Yes' : value === false ? 'No' : null;
    case 'SINGLE_SELECT': return optionLabels(field, [value])[0] ?? null;
    case 'MULTI_SELECT': {
      const labels = optionLabels(field, Array.isArray(value) ? value : []);
      return labels.length > 0 ? labels.join(', ') : null;
    }
    default: return null;
  }
}

function noteText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function toResultInformation(information) {
  const fixed = FIXED_INFORMATION
    .map(({ key, label }) => ({ label, value: noteText(information[key]) }))
    .filter((row) => row.value !== null);
  const flexible = information.fields.map((field) => ({ label: field.label, value: displayValue(field) }));
  return [...fixed, ...flexible];
}

// Adds programInformation to every result item: an array of
// { label, value } (value null = not on file), or null when the
// information could not be read. A read failure never fails matching.
export async function attachProgramInformation(store, result, { logFailure } = {}) {
  const items = [...result.plausible, ...result.possible];
  if (items.length === 0) return result;

  let byProgram = null;
  try {
    byProgram = await store.withTransaction(async (tx) => {
      const found = new Map();
      for (const item of items) {
        const program = await tx.getProgram(item.programId);
        if (program) found.set(item.programId, toResultInformation(await readCurrentProgramInformation(tx, program)));
      }
      return found;
    });
  } catch (err) {
    logFailure?.(err);
  }

  const withInformation = (item) => ({ ...item, programInformation: byProgram?.get(item.programId) ?? null });
  return {
    ...result,
    plausible: result.plausible.map(withInformation),
    possible: result.possible.map(withInformation),
  };
}
