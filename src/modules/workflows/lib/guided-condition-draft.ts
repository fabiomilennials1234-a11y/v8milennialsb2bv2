import { isGuidedCalendarDate } from '@/contracts/workflows/guided-dates';
import { GUIDED_CONDITION_LIMITS } from '@/contracts/workflows/guided-limits';
import type { GuidedConditionDraft } from '@/types/workflow';

export const normalizeGuidedExpressionKey = (value: string) => value.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export function guidedDraftComplexity(condition: GuidedConditionDraft): number {
  if ('kind' in condition && condition.kind === 'business_exists') return 1 + condition.children.length;
  return 'children' in condition ? 1 + condition.children.reduce((total, child) => total + guidedDraftComplexity(child), 0) : 1;
}

export function isIncompleteGuidedDraft(condition: GuidedConditionDraft): boolean {
  if (guidedDraftComplexity(condition) > GUIDED_CONDITION_LIMITS.maxComplexity) return true;
  if ('kind' in condition && condition.kind === 'business_exists') return !condition.children.length || condition.children.some(child =>
    child.field === 'business.stage' ? !child.pipelineId || !child.stageId
      : child.operator !== 'is_empty' && child.operator !== 'is_not_empty' && (child.value === '' || !Number.isFinite(child.value)));
  return 'children' in condition ? !condition.children.length || condition.children.some(isIncompleteGuidedDraft)
    : condition.field === 'business.trigger.stage' ? !condition.pipelineId || !condition.stageId
    : condition.field === 'business.trigger.value' ? condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty'
      && (condition.value === '' || !Number.isFinite(condition.value))
    : condition.field === 'business.trigger.stage_elapsed' ? condition.value === '' || !Number.isFinite(condition.value) || condition.value < 0
    : condition.field === 'business.last_won_date' ? condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && !isGuidedCalendarDate(condition.value)
    : condition.field === 'message.trigger.text' ? (condition.conversation.kind === 'explicit' && (!condition.conversation.boxId || !condition.conversation.provider))
      || (condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && !condition.value)
    : condition.field === 'message.period.exists' ? (condition.conversation.kind === 'explicit' && (!condition.conversation.boxId || !condition.conversation.provider))
      || !condition.from || !condition.to || !Number.isFinite(Date.parse(condition.from)) || !Number.isFinite(Date.parse(condition.to))
      || Date.parse(condition.from) >= Date.parse(condition.to) || Date.parse(condition.to) - Date.parse(condition.from) > 366 * 86_400_000
    : condition.field === 'message.search.text' ? (condition.conversation.kind === 'explicit' && (!condition.conversation.boxId || !condition.conversation.provider))
      || (condition.source.kind === 'trigger' && condition.conversation.kind !== 'trigger')
      || (condition.source.kind === 'period' && (!condition.source.from || !condition.source.to
        || !Number.isFinite(Date.parse(condition.source.from)) || !Number.isFinite(Date.parse(condition.source.to))
        || Date.parse(condition.source.from) >= Date.parse(condition.source.to)
        || Date.parse(condition.source.to) - Date.parse(condition.source.from) > 366 * 86_400_000))
      || condition.expressions.length < 1 || condition.expressions.length > 20
      || condition.expressions.some(expression => !normalizeGuidedExpressionKey(expression) || expression.length > 120)
      || new Set(condition.expressions.map(normalizeGuidedExpressionKey)).size !== condition.expressions.length
      || condition.expressions.reduce((total, expression) => total + normalizeGuidedExpressionKey(expression).length, 0) > 1000
    : condition.field === 'message.waiting.elapsed' ? (condition.conversation.kind === 'explicit' && (!condition.conversation.boxId || !condition.conversation.provider))
      || condition.value === '' || !Number.isFinite(condition.value) || condition.value < 0
    : condition.field === 'activity.follow_up' ? condition.dateOperator === 'any'
      ? condition.date !== undefined : !isGuidedCalendarDate(condition.date)
    : condition.field === 'product.relationship' ? !condition.productId
    : condition.field === 'lead.custom' && !condition.fieldId ? true
    : condition.field === 'lead.custom' && condition.fieldType === 'date' ? condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && !isGuidedCalendarDate(condition.value)
    : (condition.field === 'lead.pre_sale_responsible_id' || condition.field === 'lead.sale_responsible_id') ? condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && !condition.memberId
    : condition.field === 'lead.origin' ? condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && !condition.originId
    : condition.field === 'lead.tags' ? !condition.tagId : condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty' && (condition.value === '' || (typeof condition.value === 'number' && !Number.isFinite(condition.value)));
}
