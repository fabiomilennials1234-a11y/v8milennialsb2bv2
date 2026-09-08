/** Explicit scalar fields supported by the guided evaluator. Catalogue entries
 * are capabilities, not a list of every column in the lead table. */
export const GUIDED_TEXT_FIELDS = {
  'lead.name': { column: 'name', label: 'Nome', actualLabel: 'Nome do lead' },
  'lead.email': { column: 'email', label: 'Email', actualLabel: 'Email do lead' },
  'lead.phone': { column: 'phone', label: 'Telefone', actualLabel: 'Telefone do lead' },
  'lead.company': { column: 'company', label: 'Empresa', actualLabel: 'Empresa do lead' },
} as const;
export type GuidedTextField = keyof typeof GUIDED_TEXT_FIELDS;
export function isGuidedTextField(value: unknown): value is GuidedTextField {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GUIDED_TEXT_FIELDS, value);
}

export const GUIDED_TEXT_OPERATORS = {
  equals: 'é igual a',
  not_equals: 'é diferente de',
  contains: 'contém',
  not_contains: 'não contém',
  starts_with: 'começa com',
  ends_with: 'termina com',
} as const;
export type GuidedTextOperator = keyof typeof GUIDED_TEXT_OPERATORS;
export type GuidedTextComparison = { operator: GuidedTextOperator; value: string } | { operator: 'is_empty' };
export function isGuidedTextOperator(value: unknown): value is GuidedTextOperator {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GUIDED_TEXT_OPERATORS, value);
}
