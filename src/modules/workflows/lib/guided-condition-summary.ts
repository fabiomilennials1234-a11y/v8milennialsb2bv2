import { GUIDED_TEXT_FIELDS, GUIDED_TEXT_OPERATORS } from '@/contracts/workflows/guided-fields';
import type { GuidedConditionDraft } from '@/types/workflow';

export function summarizeGuidedCondition(condition: GuidedConditionDraft): string {
  if ('children' in condition) return `${condition.match === 'all' ? 'Todas' : 'Qualquer'}: (${condition.children.map(summarizeGuidedCondition).join(condition.match === 'all' ? ' E ' : ' OU ')})`;
  if (condition.field === 'lead.tags') return `${condition.operator === 'has_tag' ? 'Tem tag' : 'Não tem tag'} “${condition.tagLabel || 'Selecione uma tag'}”`;
  const label = GUIDED_TEXT_FIELDS[condition.field].label;
  return condition.operator === 'is_empty' ? `${label} está vazio` : `${label} ${GUIDED_TEXT_OPERATORS[condition.operator]} “${condition.value}”`;
}

export function getGuidedConditionFields(condition: GuidedConditionDraft): Array<keyof typeof GUIDED_TEXT_FIELDS | 'lead.tags'> {
  return 'children' in condition ? [...new Set(condition.children.flatMap(getGuidedConditionFields))] : [condition.field];
}
