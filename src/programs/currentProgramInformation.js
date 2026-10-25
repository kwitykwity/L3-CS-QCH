// Internal read model for current Program information (Task C).
// No eligibility decisions, label-based interpretation, or browser exposure.
// Call inside the caller's existing service/store boundary.
// Store operations:
//   listProgramApplicability(programId), getField(fieldId),
//   listFieldOptions(fieldId), listFieldValues(programId, fieldId).
import { valueFromRows } from './validateFieldChange.js';

export async function readCurrentProgramInformation(tx, program) {
  const fields = [];
  const uses = await tx.listProgramApplicability(program.programId);
  for (const use of uses) {
    const field = await tx.getField(use.fieldId);
    if (!field || field.appliesTo !== 'PROGRAM_INFO'
        || field.lifecycleStatus !== 'ACTIVE') continue;

    const options = await tx.listFieldOptions(field.fieldId);
    const rows = await tx.listFieldValues(program.programId, field.fieldId);
    const selected = new Set(rows.map((row) => row.optionId).filter((id) => id != null));
    fields.push({
      fieldId: field.fieldId,
      label: field.label,
      dataType: field.dataType,
      version: field.version,
      isRequired: use.isRequired,
      displayOrder: use.displayOrder,
      applicabilityVersion: use.version,
      value: valueFromRows(field.dataType, rows),
      options: options
        .filter((option) => option.lifecycleStatus === 'ACTIVE'
          || selected.has(option.optionId))
        .map((option) => ({
          optionId: option.optionId,
          label: option.label,
          displayOrder: option.displayOrder,
          lifecycleStatus: option.lifecycleStatus,
        }))
        .sort((a, b) => a.displayOrder - b.displayOrder || a.optionId - b.optionId),
    });
  }
  fields.sort((a, b) => a.displayOrder - b.displayOrder || a.fieldId - b.fieldId);

  return {
    programId: program.programId,
    version: program.version,
    updatedAt: program.updatedAt ?? null,
    description: program.description ?? null,
    site: program.site ?? null,
    eligibilityNotes: program.eligibilityNotes ?? null,
    scheduleNotes: program.scheduleNotes ?? null,
    costNotes: program.costNotes ?? null,
    fields,
  };
}
