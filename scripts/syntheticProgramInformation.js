// Optional Task C examples. Synthetic data only; never imported by production.
import { createFieldService } from '../src/programs/fieldService.js';

export async function seedSyntheticProgramInformation(store, userId, programId = 3) {
  const fields = createFieldService({ store });
  // Example labels and wording, not a mandatory QCH vocabulary or schema.
  const examples = [
    ['Current Program information', 'Synthetic update: evening sessions are offered this cycle.'],
    ['Current availability', 'Synthetic example: accepting inquiries; confirm an opening with the Program.'],
    ['Wait-list information', 'Synthetic example: a wait list is available. No participant waitlist records are held here.'],
    ['Estimated wait time', 'Synthetic estimate: two to four weeks; confirm with the Program.'],
    ['Additional locations', 'Synthetic North Site: Monday evenings.\nSynthetic South Site: Saturday mornings.'],
    ['Primary Program contact', 'Synthetic Program desk: program-demo@example.invalid. This is not notification routing.'],
    ['Enrollment and cycle information', 'Synthetic cycle: January through March; contact the Program for the next intake.'],
  ];
  for (let index = 0; index < examples.length; index += 1) {
    const [label, value] = examples[index];
    const created = await fields.createField(userId, programId, {
      label, dataType: 'TEXT', isRequired: false, displayOrder: index,
    });
    await fields.setFieldValue(userId, programId, created.field.fieldId, {
      version: created.field.applicability.version, value,
    });
  }
}
