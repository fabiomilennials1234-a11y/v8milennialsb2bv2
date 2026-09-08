/** Explicit scalar fields supported by the guided evaluator. Catalogue entries
 * are capabilities, not a list of every column in the lead table. */
export const GUIDED_TEXT_FIELDS = {
  'lead.name': { column: 'name', label: 'Nome', actualLabel: 'Nome do lead' },
  'lead.email': { column: 'email', label: 'Email', actualLabel: 'Email do lead' },
  'lead.phone': { column: 'phone', label: 'Telefone', actualLabel: 'Telefone do lead' },
  'lead.utm_source': { column: 'utm_source', label: 'UTM Source', actualLabel: 'UTM Source do lead' },
  'lead.utm_medium': { column: 'utm_medium', label: 'UTM Medium', actualLabel: 'UTM Medium do lead' },
  'lead.utm_content': { column: 'utm_content', label: 'UTM Content', actualLabel: 'UTM Content do lead' },
  'lead.utm_term': { column: 'utm_term', label: 'UTM Term', actualLabel: 'UTM Term do lead' },
  'lead.utm_campaign': { column: 'utm_campaign', label: 'UTM Campaign', actualLabel: 'UTM Campaign do lead' },
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

export const GUIDED_NUMBER_FIELDS = {
  'lead.qualification_score': { column: 'qualification_score', label: 'Pontuação de qualificação', actualLabel: 'Pontuação de qualificação do lead' },
} as const;
export type GuidedNumberField = keyof typeof GUIDED_NUMBER_FIELDS;
export function isGuidedNumberField(value: unknown): value is GuidedNumberField {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GUIDED_NUMBER_FIELDS, value);
}
export const GUIDED_NUMBER_OPERATORS = {
  equals: 'é igual a', not_equals: 'é diferente de', greater_than: 'é maior que',
  greater_than_or_equal: 'é maior ou igual a', less_than: 'é menor que', less_than_or_equal: 'é menor ou igual a',
} as const;
export type GuidedNumberOperator = keyof typeof GUIDED_NUMBER_OPERATORS;
export type GuidedNumberComparison = { operator: GuidedNumberOperator; value: number } | { operator: 'is_empty' };
export function isGuidedNumberOperator(value: unknown): value is GuidedNumberOperator {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GUIDED_NUMBER_OPERATORS, value);
}
export const GUIDED_SCALAR_FIELDS = { ...GUIDED_TEXT_FIELDS, ...GUIDED_NUMBER_FIELDS };
export function isGuidedScalarField(value: unknown): value is keyof typeof GUIDED_SCALAR_FIELDS {
  return isGuidedTextField(value) || isGuidedNumberField(value);
}


/** Canonical assignment slots; these are relationships, not free-text fields. */
export const GUIDED_RESPONSIBLE_FIELDS = {
  'lead.pre_sale_responsible_id': { column: 'pre_sale_responsible_id', label: 'Responsável de pré-vendas' },
  'lead.sale_responsible_id': { column: 'sale_responsible_id', label: 'Responsável de vendas' },
} as const;
export type GuidedResponsibleField = keyof typeof GUIDED_RESPONSIBLE_FIELDS;
export function isGuidedResponsibleField(value: unknown): value is GuidedResponsibleField {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GUIDED_RESPONSIBLE_FIELDS, value);
}
