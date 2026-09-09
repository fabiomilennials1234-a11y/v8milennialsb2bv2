import { GUIDED_DATE_OPERATORS, isGuidedCalendarDate } from '@/contracts/workflows/guided-dates';
import { GUIDED_RESPONSIBLE_FIELDS, GUIDED_SCALAR_FIELDS, GUIDED_TEXT_OPERATORS, GUIDED_NUMBER_OPERATORS } from '@/contracts/workflows/guided-fields';
import type { GuidedBusinessExistenceChildDraft, GuidedConditionDraft } from '@/types/workflow';

function summarizeBusinessFilter(condition: GuidedBusinessExistenceChildDraft): string {
  if (condition.field === 'business.stage') return `Etapa ${condition.operator === 'equals' ? 'é' : 'não é'} “${condition.pipelineLabel && condition.stageLabel
    ? `${condition.pipelineLabel} · ${condition.stageLabel}` : 'Selecione funil e etapa'}”`;
  return condition.operator === 'is_empty' ? 'Valor está vazio' : condition.operator === 'is_not_empty' ? 'Valor está preenchido'
    : `Valor ${GUIDED_NUMBER_OPERATORS[condition.operator]} ${condition.value === '' ? '…' : condition.value}`;
}

export function summarizeGuidedCondition(condition: GuidedConditionDraft): string {
  if ('kind' in condition && condition.kind === 'business_exists') {
    const lifecycle = { open: 'Em aberto', won: 'Ganho', lost: 'Perdido', all: 'Todos' }[condition.lifecycle];
    return `Existe negócio · ${lifecycle} · ${condition.match === 'all' ? 'Todas' : 'Qualquer'}: (${condition.children.map(summarizeBusinessFilter).join(condition.match === 'all' ? ' E ' : ' OU ')})`;
  }
  if ('children' in condition) return `${condition.match === 'all' ? 'Todas' : 'Qualquer'}: (${condition.children.map(summarizeGuidedCondition).join(condition.match === 'all' ? ' E ' : ' OU ')})`;
  if (condition.field === 'lead.pre_sale_responsible_id' || condition.field === 'lead.sale_responsible_id') return condition.operator === 'is_empty'
    ? `${GUIDED_RESPONSIBLE_FIELDS[condition.field].label} está vazio`
    : condition.operator === 'is_not_empty' ? `${GUIDED_RESPONSIBLE_FIELDS[condition.field].label} está preenchido`
    : `${GUIDED_RESPONSIBLE_FIELDS[condition.field].label} ${condition.operator === 'equals' ? 'é' : 'não é'} “${condition.memberLabel || 'Selecione um responsável'}”`;
  if (condition.field === 'lead.origin') return condition.operator === 'is_empty' ? 'Origem está vazia'
    : condition.operator === 'is_not_empty' ? 'Origem está preenchida'
    : `Origem ${condition.operator === 'equals' ? 'é' : 'não é'} “${condition.originLabel || 'Selecione uma origem'}”`;
  if (condition.field === 'lead.tags') return `${condition.operator === 'has_tag' ? 'Tem tag' : 'Não tem tag'} “${condition.tagLabel || 'Selecione uma tag'}”`;
  if (condition.field === 'business.trigger.stage') return `Negócio do gatilho · Etapa ${condition.operator === 'equals' ? 'é' : 'não é'} “${condition.pipelineLabel && condition.stageLabel
    ? `${condition.pipelineLabel} · ${condition.stageLabel}` : 'Selecione funil e etapa'}”`;
  if (condition.field === 'business.trigger.value') return condition.operator === 'is_empty' ? 'Negócio do gatilho · Valor está vazio'
    : condition.operator === 'is_not_empty' ? 'Negócio do gatilho · Valor está preenchido'
    : `Negócio do gatilho · Valor ${GUIDED_NUMBER_OPERATORS[condition.operator]} ${condition.value === '' ? '…' : condition.value}`;
  if (condition.field === 'business.trigger.stage_elapsed') {
    const unit = condition.unit === 'minutes' ? condition.value === 1 ? 'minuto' : 'minutos'
      : condition.unit === 'hours' ? condition.value === 1 ? 'hora' : 'horas' : condition.value === 1 ? 'dia' : 'dias';
    return `Negócio do gatilho · Tempo na etapa ${GUIDED_NUMBER_OPERATORS[condition.operator]} ${condition.value === '' ? '…' : condition.value} ${unit}`;
  }
  if (condition.field === 'lead.custom' && condition.fieldType === 'select') {
    const label = condition.fieldLabel || 'Campo personalizado';
    return condition.operator === 'is_empty' ? `${label} está vazio` : condition.operator === 'is_not_empty' ? `${label} está preenchido`
      : `${label} ${condition.operator === 'equals' ? 'é' : 'não é'} “${condition.value || 'Selecione uma opção'}”`;
  }
  if (condition.field === 'lead.custom' && condition.fieldType === 'date') {
    const label = condition.fieldLabel || 'Campo personalizado';
    return condition.operator === 'is_empty' ? `${label} está vazio` : condition.operator === 'is_not_empty' ? `${label} está preenchido`
      : `${label} ${GUIDED_DATE_OPERATORS[condition.operator]} ${isGuidedCalendarDate(condition.value) ? condition.value.split('-').reverse().join('/') : '…'}`;
  }
  if (condition.field === 'lead.custom' && condition.fieldType === 'boolean') {
    const label = condition.fieldLabel || 'Campo personalizado';
    return condition.operator === 'is_empty' ? `${label} está vazio` : condition.operator === 'is_not_empty' ? `${label} está preenchido`
      : `${label} ${condition.operator === 'equals' ? 'é' : 'não é'} ${condition.value === '' ? '…' : condition.value ? 'Sim' : 'Não'}`;
  }
  if (condition.field === 'lead.qualification_score' || (condition.field === 'lead.custom' && condition.fieldType === 'number')) {
    const label = condition.field === 'lead.custom' ? condition.fieldLabel || 'Campo personalizado' : GUIDED_SCALAR_FIELDS[condition.field].label;
    return condition.operator === 'is_empty' ? `${label} está vazio` : condition.operator === 'is_not_empty' ? `${label} está preenchido` : `${label} ${GUIDED_NUMBER_OPERATORS[condition.operator]} ${condition.value === '' ? '…' : condition.value}`;
  }
  const label = condition.field === 'lead.custom' ? condition.fieldLabel || 'Campo personalizado' : GUIDED_SCALAR_FIELDS[condition.field].label;
  return condition.operator === 'is_empty' ? `${label} está vazio` : condition.operator === 'is_not_empty' ? `${label} está preenchido` : `${label} ${GUIDED_TEXT_OPERATORS[condition.operator]} “${condition.value}”`;
}

export function getGuidedConditionFields(condition: GuidedConditionDraft): string[] {
  if ('kind' in condition && condition.kind === 'business_exists') return ['business.exists.lifecycle',
    ...new Set(condition.children.map(child => child.field === 'business.stage' ? 'business.exists.stage' : 'business.exists.value'))];
  return 'children' in condition ? [...new Set(condition.children.flatMap(getGuidedConditionFields))] : [condition.field === 'lead.custom' ? `lead.custom:${condition.fieldId.toLowerCase()}` : condition.field];
}
