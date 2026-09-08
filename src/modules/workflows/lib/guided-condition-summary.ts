import { GUIDED_TEXT_FIELDS } from '@/contracts/workflows/guided-fields';
import type { GuidedConditionDraft } from '@/types/workflow';

export function summarizeGuidedCondition(condition: GuidedConditionDraft): string {
  if ('children' in condition) return `${condition.match === 'all' ? 'Todas' : 'Qualquer'}: (${condition.children.map(summarizeGuidedCondition).join(condition.match === 'all' ? ' E ' : ' OU ')})`;
  const label = GUIDED_TEXT_FIELDS[condition.field].label;
  return condition.operator === 'is_empty' ? `${label} está vazio` : `${label} é igual a “${condition.value}”`;
}
