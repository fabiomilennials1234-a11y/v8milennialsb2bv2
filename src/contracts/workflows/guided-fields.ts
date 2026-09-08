/** Explicit scalar fields supported by the guided evaluator. Catalogue entries
 * are capabilities, not a list of every column in the lead table. */
export const GUIDED_TEXT_FIELDS = {
  'lead.name': { column: 'name', label: 'Nome', actualLabel: 'Nome do lead' },
  'lead.company': { column: 'company', label: 'Empresa', actualLabel: 'Empresa do lead' },
} as const;
export type GuidedTextField = keyof typeof GUIDED_TEXT_FIELDS;
export function isGuidedTextField(value: unknown): value is GuidedTextField {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GUIDED_TEXT_FIELDS, value);
}
