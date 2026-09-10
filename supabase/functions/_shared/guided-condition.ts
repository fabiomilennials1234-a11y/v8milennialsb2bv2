import { isGuidedCalendarDate, isGuidedDateOperator, type GuidedDateComparison } from '../../../src/contracts/workflows/guided-dates.ts';
import { GUIDED_RESPONSIBLE_FIELDS, isGuidedResponsibleField, type GuidedResponsibleField, GUIDED_SCALAR_FIELDS, isGuidedScalarField, isGuidedNumberField, isGuidedNumberOperator, type GuidedNumberField, type GuidedNumberComparison, isGuidedTextField, isGuidedTextOperator, type GuidedTextComparison, type GuidedTextField } from '../../../src/contracts/workflows/guided-fields.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GUIDED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeGuidedMessageSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function guidedMessageTextMatches(text: string, expressions: string[], mode: 'whole_phrase' | 'substring', match: 'any' | 'all'): boolean {
  const haystack = normalizeGuidedMessageSearch(text);
  const checks = expressions.map(expression => {
    const needle = normalizeGuidedMessageSearch(expression);
    return mode === 'substring' ? haystack.includes(needle) : ` ${haystack} `.includes(` ${needle} `);
  });
  return match === 'all' ? checks.every(Boolean) : checks.some(Boolean);
}

export type GuidedScalarRule = {
  version: 1;
  id: string;
  field: GuidedTextField;
} & GuidedTextComparison;

export type GuidedOriginRule = { version: 1; id: string; field: 'lead.origin' } & (
  { operator: 'equals' | 'not_equals'; originId: string } | { operator: 'is_empty' } | { operator: 'is_not_empty' }
);

export type GuidedResponsibleRule = { [Field in GuidedResponsibleField]: { version: 1; id: string; field: Field } & (
  { operator: 'equals' | 'not_equals'; memberId: string } | { operator: 'is_empty' } | { operator: 'is_not_empty' }
) }[GuidedResponsibleField];

export type GuidedCustomTextRule = { version: 1; id: string; field: 'lead.custom'; fieldId: string; fieldType: 'text' } & GuidedTextComparison;

export type GuidedCustomNumberRule = { version: 1; id: string; field: 'lead.custom'; fieldId: string; fieldType: 'number' } & GuidedNumberComparison;

export type GuidedCustomBooleanRule = { version: 1; id: string; field: 'lead.custom'; fieldId: string; fieldType: 'boolean' }
  & ({ operator: 'equals' | 'not_equals'; value: boolean } | { operator: 'is_empty' } | { operator: 'is_not_empty' });

export type GuidedCustomDateRule = { version: 1; id: string; field: 'lead.custom'; fieldId: string; fieldType: 'date' } & GuidedDateComparison;

export type GuidedCustomSelectRule = { version: 1; id: string; field: 'lead.custom'; fieldId: string; fieldType: 'select' }
  & ({ operator: 'equals' | 'not_equals'; value: string } | { operator: 'is_empty' } | { operator: 'is_not_empty' });

export type GuidedTriggerBusinessStageRule = {
  version: 1;
  id: string;
  field: 'business.trigger.stage';
  operator: 'equals' | 'not_equals';
  pipelineId: string;
  stageId: string;
};

export type GuidedTriggerBusinessValueRule = { version: 1; id: string; field: 'business.trigger.value' }
  & GuidedNumberComparison;
export type GuidedElapsedUnit = 'minutes' | 'hours' | 'days';
export type GuidedTriggerBusinessStageElapsedRule = { version: 1; id: string; field: 'business.trigger.stage_elapsed';
  operator: Exclude<GuidedNumberComparison['operator'], 'is_empty' | 'is_not_empty'>; value: number; unit: GuidedElapsedUnit };
export type GuidedBusinessExistenceChild = ({ version: 1; id: string; field: 'business.stage'; operator: 'equals' | 'not_equals';
  pipelineId: string; stageId: string } | ({ version: 1; id: string; field: 'business.value' } & GuidedNumberComparison));
export type GuidedBusinessExistence = { version: 1; id: string; kind: 'business_exists'; lifecycle: 'open' | 'won' | 'lost' | 'all';
  match: 'all' | 'any'; children: GuidedBusinessExistenceChild[] };
export type GuidedLastWonDateRule = { version: 1; id: string; field: 'business.last_won_date' } & GuidedDateComparison;
export type GuidedTriggerMessageTextRule = { version: 1; id: string; field: 'message.trigger.text';
  conversation: { kind: 'trigger' } | { kind: 'explicit'; storage: 'whatsapp_messages' | 'channel_messages';
    boxId: string; provider: string } } & GuidedTextComparison;
export type GuidedMessagePeriodRule = { version: 1; id: string; field: 'message.period.exists';
  conversation: { kind: 'trigger' } | { kind: 'explicit'; storage: 'whatsapp_messages' | 'channel_messages'; boxId: string; provider: string };
  operator: 'exists' | 'not_exists'; from: string; to: string };
export type GuidedMessageSearchRule = { version: 1; id: string; field: 'message.search.text';
  conversation: { kind: 'trigger' } | { kind: 'explicit'; storage: 'whatsapp_messages' | 'channel_messages'; boxId: string; provider: string };
  source: { kind: 'trigger' } | { kind: 'last_received' } | { kind: 'period'; from: string; to: string };
  operator: 'matches' | 'not_matches'; expressionMatch: 'any' | 'all'; matchMode: 'whole_phrase' | 'substring'; expressions: string[] };
export type GuidedMessageWaitingRule = { version: 1; id: string; field: 'message.waiting.elapsed';
  conversation: { kind: 'trigger' } | { kind: 'explicit'; storage: 'whatsapp_messages' | 'channel_messages'; boxId: string; provider: string };
  waitingFor: 'lead' | 'company'; operator: GuidedNumberComparison['operator']; value: number; unit: GuidedElapsedUnit };
export type GuidedFollowUpRule = { version: 1; id: string; field: 'activity.follow_up';
  relation: 'lead' | 'trigger_business'; state: 'pending' | 'completed'; operator: 'exists' | 'not_exists';
  dateOperator: 'any' | GuidedDateComparison['operator']; date?: string };
export type GuidedProductRule = { version: 1; id: string; field: 'product.relationship';
  relation: 'trigger_business_item' | 'lead_association' | 'won_deal_history';
  productId: string; operator: 'has_product' | 'not_has_product' };

export type GuidedRule = GuidedProductRule | GuidedFollowUpRule | GuidedMessageWaitingRule | GuidedMessageSearchRule | GuidedMessagePeriodRule | GuidedTriggerMessageTextRule | GuidedLastWonDateRule | GuidedTriggerBusinessStageElapsedRule | GuidedTriggerBusinessValueRule | GuidedTriggerBusinessStageRule | GuidedCustomSelectRule | GuidedCustomDateRule | GuidedCustomBooleanRule | GuidedCustomNumberRule | GuidedCustomTextRule | GuidedResponsibleRule | GuidedOriginRule | GuidedScalarRule | ({ version: 1; id: string; field: GuidedNumberField } & GuidedNumberComparison) | {
  version: 1; id: string; field: 'lead.tags'; operator: 'has_tag' | 'not_has_tag'; tagId: string;
};

export interface GuidedConditionRequest {
  organizationId: string;
  leadId: string;
  entryId?: string | null;
  messageContext?: { storage: 'whatsapp_messages' | 'channel_messages'; messageId: string; boxId: string;
    provider: string; participantId: string } | null;
  condition: unknown;
  authorization?: { kind: 'organization'; workflowId: string };
}

export type GuidedCondition = GuidedRule | GuidedBusinessExistence | {
  version: 1; id: string; kind: 'group'; match: 'all' | 'any'; children: GuidedCondition[];
};

export function isGuidedCondition(value: unknown): value is GuidedCondition {
  const ids = new Set<string>();
  function valid(value: unknown, groupDepth: number): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const rule = value as Record<string, unknown>;
    if (rule.version !== 1 || typeof rule.id !== 'string' || !rule.id || ids.has(rule.id)) return false;
    ids.add(rule.id);
    if (rule.kind === 'business_exists') {
      if ((rule.lifecycle !== 'open' && rule.lifecycle !== 'won' && rule.lifecycle !== 'lost' && rule.lifecycle !== 'all')
        || (rule.match !== 'all' && rule.match !== 'any') || !Array.isArray(rule.children)
        || rule.children.length === 0 || rule.children.length > 256) return false;
      return rule.children.every(child => {
        if (!child || typeof child !== 'object' || Array.isArray(child)) return false;
        const candidate = child as Record<string, unknown>;
        if (candidate.version !== 1 || typeof candidate.id !== 'string' || !candidate.id || ids.has(candidate.id)) return false;
        ids.add(candidate.id);
        if (candidate.field === 'business.stage') return (candidate.operator === 'equals' || candidate.operator === 'not_equals')
          && typeof candidate.pipelineId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate.pipelineId)
          && typeof candidate.stageId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate.stageId);
        return candidate.field === 'business.value' && (candidate.operator === 'is_empty' || candidate.operator === 'is_not_empty'
          || (isGuidedNumberOperator(candidate.operator) && typeof candidate.value === 'number' && Number.isFinite(candidate.value)));
      });
    }
    if (rule.kind === 'group') {
      return groupDepth < 3 && (rule.match === 'all' || rule.match === 'any')
        && Array.isArray(rule.children) && rule.children.length > 0
        && rule.children.every(child => valid(child, groupDepth + 1));
    }
    if ('children' in rule || 'match' in rule || 'kind' in rule) return false;
    if (rule.field === 'business.trigger.stage') return (rule.operator === 'equals' || rule.operator === 'not_equals')
      && typeof rule.pipelineId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rule.pipelineId)
      && typeof rule.stageId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rule.stageId);
    if (rule.field === 'business.trigger.value') return rule.operator === 'is_empty' || rule.operator === 'is_not_empty'
      || (isGuidedNumberOperator(rule.operator) && typeof rule.value === 'number' && Number.isFinite(rule.value));
    if (rule.field === 'business.trigger.stage_elapsed') return isGuidedNumberOperator(rule.operator)
      && typeof rule.value === 'number' && Number.isFinite(rule.value) && rule.value >= 0
      && (rule.unit === 'minutes' || rule.unit === 'hours' || rule.unit === 'days');
    if (rule.field === 'business.last_won_date') return rule.operator === 'is_empty' || rule.operator === 'is_not_empty'
      || (isGuidedDateOperator(rule.operator) && isGuidedCalendarDate(rule.value));
    if (rule.field === 'activity.follow_up') return (rule.relation === 'lead' || rule.relation === 'trigger_business')
      && (rule.state === 'pending' || rule.state === 'completed')
      && (rule.operator === 'exists' || rule.operator === 'not_exists')
      && (rule.dateOperator === 'any' ? rule.date === undefined
        : isGuidedDateOperator(rule.dateOperator) && isGuidedCalendarDate(rule.date));
    if (rule.field === 'product.relationship') return (rule.relation === 'trigger_business_item'
      || rule.relation === 'lead_association' || rule.relation === 'won_deal_history')
      && (rule.operator === 'has_product' || rule.operator === 'not_has_product')
      && typeof rule.productId === 'string' && GUIDED_UUID.test(rule.productId);
    if (rule.field === 'message.trigger.text') {
      const conversation = rule.conversation as Record<string, unknown> | undefined;
      const validConversation = conversation?.kind === 'trigger' || (conversation?.kind === 'explicit'
        && (conversation.storage === 'whatsapp_messages' || conversation.storage === 'channel_messages')
        && typeof conversation.boxId === 'string' && GUIDED_UUID.test(conversation.boxId)
        && typeof conversation.provider === 'string' && conversation.provider.trim().length > 0);
      return validConversation && (rule.operator === 'is_empty' || rule.operator === 'is_not_empty'
        || (isGuidedTextOperator(rule.operator) && typeof rule.value === 'string' && rule.value.length > 0));
    }
    if (rule.field === 'message.period.exists') {
      const conversation = rule.conversation as Record<string, unknown> | undefined;
      const validConversation = conversation?.kind === 'trigger' || (conversation?.kind === 'explicit'
        && (conversation.storage === 'whatsapp_messages' || conversation.storage === 'channel_messages')
        && typeof conversation.boxId === 'string' && GUIDED_UUID.test(conversation.boxId)
        && typeof conversation.provider === 'string' && conversation.provider.trim().length > 0);
      const from = typeof rule.from === 'string' ? Date.parse(rule.from) : Number.NaN;
      const to = typeof rule.to === 'string' ? Date.parse(rule.to) : Number.NaN;
      return validConversation && (rule.operator === 'exists' || rule.operator === 'not_exists')
        && Number.isFinite(from) && Number.isFinite(to) && from < to && to - from <= 366 * 86_400_000;
    }
    if (rule.field === 'message.search.text') {
      const conversation = rule.conversation as Record<string, unknown> | undefined;
      const validConversation = conversation?.kind === 'trigger' || (conversation?.kind === 'explicit'
        && (conversation.storage === 'whatsapp_messages' || conversation.storage === 'channel_messages')
        && typeof conversation.boxId === 'string' && GUIDED_UUID.test(conversation.boxId)
        && typeof conversation.provider === 'string' && conversation.provider.trim().length > 0);
      const source = rule.source as Record<string, unknown> | undefined;
      let validSource = source?.kind === 'last_received' || (source?.kind === 'trigger' && conversation?.kind === 'trigger');
      if (source?.kind === 'period') {
        const from = typeof source.from === 'string' ? Date.parse(source.from) : Number.NaN;
        const to = typeof source.to === 'string' ? Date.parse(source.to) : Number.NaN;
        validSource = Number.isFinite(from) && Number.isFinite(to) && from < to && to-from<=366*86_400_000;
      }
      if (!Array.isArray(rule.expressions) || rule.expressions.length<1 || rule.expressions.length>20
        || rule.expressions.some(value => typeof value!=='string' || !normalizeGuidedMessageSearch(value) || value.length>120)) return false;
      const normalized = rule.expressions.map(value => normalizeGuidedMessageSearch(value));
      return validConversation && validSource && new Set(normalized).size===normalized.length && normalized.join('').length<=1000
        && (rule.operator==='matches' || rule.operator==='not_matches') && (rule.expressionMatch==='any' || rule.expressionMatch==='all')
        && (rule.matchMode==='whole_phrase' || rule.matchMode==='substring');
    }
    if (rule.field === 'message.waiting.elapsed') {
      const conversation = rule.conversation as Record<string, unknown> | undefined;
      const validConversation = conversation?.kind === 'trigger' || (conversation?.kind === 'explicit'
        && (conversation.storage === 'whatsapp_messages' || conversation.storage === 'channel_messages')
        && typeof conversation.boxId === 'string' && GUIDED_UUID.test(conversation.boxId)
        && typeof conversation.provider === 'string' && conversation.provider.trim().length > 0);
      return validConversation && (rule.waitingFor === 'lead' || rule.waitingFor === 'company')
        && isGuidedNumberOperator(rule.operator)
        && typeof rule.value === 'number' && Number.isFinite(rule.value) && rule.value >= 0
        && (rule.unit === 'minutes' || rule.unit === 'hours' || rule.unit === 'days');
    }
    if (isGuidedResponsibleField(rule.field)) return rule.operator === 'is_empty' || rule.operator === 'is_not_empty'
      || ((rule.operator === 'equals' || rule.operator === 'not_equals') && typeof rule.memberId === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rule.memberId));
    if (rule.field === 'lead.custom') return (rule.fieldType === 'text' || rule.fieldType === 'number' || rule.fieldType === 'boolean' || rule.fieldType === 'date' || rule.fieldType === 'select') && typeof rule.fieldId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rule.fieldId)
      && (rule.operator === 'is_empty' || rule.operator === 'is_not_empty'
        || (rule.fieldType === 'select'
          ? (rule.operator === 'equals' || rule.operator === 'not_equals') && typeof rule.value === 'string' && rule.value.length > 0
          : rule.fieldType === 'date'
          ? isGuidedDateOperator(rule.operator) && isGuidedCalendarDate(rule.value)
          : rule.fieldType === 'boolean'
          ? (rule.operator === 'equals' || rule.operator === 'not_equals') && typeof rule.value === 'boolean'
          : rule.fieldType === 'number'
          ? isGuidedNumberOperator(rule.operator) && typeof rule.value === 'number' && Number.isFinite(rule.value)
          : isGuidedTextOperator(rule.operator) && typeof rule.value === 'string' && rule.value.length > 0));
    if (rule.field === 'lead.origin') return rule.operator === 'is_empty' || rule.operator === 'is_not_empty'
      || ((rule.operator === 'equals' || rule.operator === 'not_equals') && typeof rule.originId === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rule.originId));
    if (rule.field === 'lead.tags') return (rule.operator === 'has_tag' || rule.operator === 'not_has_tag')
      && typeof rule.tagId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rule.tagId);
    if (isGuidedNumberField(rule.field)) return rule.operator === 'is_empty' || rule.operator === 'is_not_empty'
      || (isGuidedNumberOperator(rule.operator) && typeof rule.value === 'number' && Number.isFinite(rule.value));
    return isGuidedTextField(rule.field) && (rule.operator === 'is_empty' || rule.operator === 'is_not_empty'
      || (isGuidedTextOperator(rule.operator) && typeof rule.value === 'string' && rule.value.length > 0));
  }
  return valid(value, 0);
}

export function guidedConditionFields(condition: GuidedCondition): string[] {
  if ('kind' in condition && condition.kind === 'business_exists') return ['business.exists.lifecycle', ...new Set(condition.children.map(child => child.field === 'business.stage' ? 'business.exists.stage' : 'business.exists.value'))];
  return 'children' in condition ? [...new Set(condition.children.flatMap(guidedConditionFields))]
    : [condition.field === 'lead.custom' ? `lead.custom:${condition.fieldId.toLowerCase()}`
      : condition.field === 'product.relationship' ? `product.${condition.relation}` : condition.field];
}

// Canonical decimal spelling permits harmless trailing zeroes/scientific
// notation, but detects rounding or underflow across the numeric API boundary.
function decimalIdentity(value: string): string {
  const [mantissa, exponent = '0'] = value.toLowerCase().split('e');
  const negative = mantissa.startsWith('-');
  const unsigned = mantissa.replace(/^[+-]/, '');
  const [integer, fraction = ''] = unsigned.split('.');
  const digits = (integer + fraction).replace(/^0+/, '');
  if (!digits) return '0';
  const significant = digits.replace(/0+$/, '');
  return `${negative ? '-' : ''}${significant}e${Number(exponent) - fraction.length + digits.length - significant.length}`;
}

type GuidedSourceErrorCode = 'context_unavailable' | 'reference_unavailable' | 'access_denied'
  | 'temporarily_unavailable' | 'source_unavailable';

function classifyGuidedSourceError(error: { code?: string }, status: number): GuidedSourceErrorCode {
  if (error.code === 'PT404') return 'context_unavailable';
  if (error.code === 'PT422') return 'reference_unavailable';
  if (status === 401 || status === 403 || error.code === '42501') return 'access_denied';
  if (status === 0 || status === 429 || status >= 500
    || ['57014', '40001', '40P01', '53300', '57P01'].includes(error.code ?? '')) return 'temporarily_unavailable';
  return 'source_unavailable';
}

/** Evaluate with a caller-scoped client. Never pass a service-role client for
 * a personal test: PostgreSQL enforces that caller's current record access.
 * Organization is resolved by the authenticated server boundary. Organizational
 * execution uses the service-only RPC which checks the current grant atomically
 * with the data read; it never falls back to an unrestricted service query.
 */
export async function evaluateGuidedCondition(
  caller: SupabaseClient,
  request: GuidedConditionRequest,
) {
  if (request.authorization !== undefined && (
    !request.authorization || request.authorization.kind !== 'organization'
    || typeof request.authorization.workflowId !== 'string' || !request.authorization.workflowId
  )) {
    return { status: 'error' as const, code: 'access_denied' as const };
  }
  if (!isGuidedCondition(request.condition)) {
    return { status: 'error' as const, code: 'invalid_configuration' as const };
  }
  const requestedFields = guidedConditionFields(request.condition);
  if (requestedFields.length > 256) return { status: 'error' as const, code: 'invalid_configuration' as const };
  const responsibleFields = requestedFields.filter(isGuidedResponsibleField);
  const customIds = new Set<string>();
  const customExpectedTypes = new Map<string, Set<string>>();
  const customOptionReferences = new Map<string, Set<string>>();
  const memberIds = new Set<string>();
  const originIds = new Set<string>();
  const tagIds = new Set<string>();
  const businessStageReferences = new Map<string, { pipelineId: string; stageId: string }>();
  const businessExistenceStageReferences = new Map<string, { pipelineId: string; stageId: string }>();
  const businessExistenceQueries: GuidedBusinessExistence[] = [];
  const messageSearchRules: GuidedMessageSearchRule[] = [];
  const messageWaitingRules: GuidedMessageWaitingRule[] = [];
  const followUpRules: GuidedFollowUpRule[] = [];
  const productRules: GuidedProductRule[] = [];
  function collect(current: GuidedCondition): void {
    if ('kind' in current && current.kind === 'business_exists') {
      businessExistenceQueries.push(current);
      current.children.forEach(child => {
        if (child.field === 'business.stage') businessExistenceStageReferences.set(
          `${child.pipelineId.toLowerCase()}:${child.stageId.toLowerCase()}`,
          { pipelineId: child.pipelineId.toLowerCase(), stageId: child.stageId.toLowerCase() },
        );
      });
    }
    else if ('children' in current) current.children.forEach(collect);
    else if (current.field === 'lead.custom') {
      const id = current.fieldId.toLowerCase();
      customIds.add(id);
      const types = customExpectedTypes.get(id) ?? new Set<string>();
      types.add(current.fieldType);
      customExpectedTypes.set(id, types);
      if (current.fieldType === 'select' && current.operator !== 'is_empty' && current.operator !== 'is_not_empty') {
        const options = customOptionReferences.get(id) ?? new Set<string>();
        options.add(current.value);
        customOptionReferences.set(id, options);
      }
    }
    else if (isGuidedResponsibleField(current.field) && current.operator !== 'is_empty' && current.operator !== 'is_not_empty' && 'memberId' in current) memberIds.add(current.memberId.toLowerCase());
    else if (current.field === 'lead.origin' && current.operator !== 'is_empty' && current.operator !== 'is_not_empty') originIds.add(current.originId.toLowerCase());
    else if (current.field === 'lead.tags') tagIds.add(current.tagId.toLowerCase());
    else if (current.field === 'business.trigger.stage') businessStageReferences.set(
      `${current.pipelineId.toLowerCase()}:${current.stageId.toLowerCase()}`,
      { pipelineId: current.pipelineId.toLowerCase(), stageId: current.stageId.toLowerCase() },
    );
    else if (current.field === 'message.search.text') messageSearchRules.push(current);
    else if (current.field === 'message.waiting.elapsed') messageWaitingRules.push(current);
    else if (current.field === 'activity.follow_up') followUpRules.push(current);
    else if (current.field === 'product.relationship') productRules.push(current);
  }
  collect(request.condition);
  if (messageSearchRules.length > 20) return { status: 'error' as const, code: 'invalid_configuration' as const };
  const leadRequestedFields = requestedFields.filter(field => !field.startsWith('business.') && !field.startsWith('message.')
    && !field.startsWith('activity.') && !field.startsWith('product.'));
  const usesCustomReader = Boolean(request.authorization && customIds.size);
  const fields = leadRequestedFields.filter(isGuidedScalarField);
  const usesFieldReader = fields.some(field => field !== 'lead.name');
  const usesResponsibleReader = Boolean(request.authorization && responsibleFields.length);
  const usesOriginReader = Boolean(request.authorization && leadRequestedFields.includes('lead.origin'));
  const usesTagReader = Boolean(request.authorization && tagIds.size);
  const businessFields = requestedFields.filter(field => field === 'business.trigger.stage' || field === 'business.trigger.value' || field === 'business.trigger.stage_elapsed');
  const usesLastWonDate = requestedFields.includes('business.last_won_date');
  const usesTriggerMessage = requestedFields.includes('message.trigger.text') || messageSearchRules.some(rule => rule.source.kind==='trigger');
  const usesMessagePeriod = requestedFields.includes('message.period.exists');
  const usesMessageSearch = messageSearchRules.some(rule => rule.source.kind!=='trigger');
  const usesMessageWaiting = requestedFields.includes('message.waiting.elapsed');
  const usesFollowUps = requestedFields.includes('activity.follow_up');
  const usesProducts = requestedFields.some(field => field.startsWith('product.'));
  const hasNoLeadData = leadRequestedFields.length === 0;
  const { data, error, status } = request.authorization?.kind === 'organization'
    ? hasNoLeadData ? { data: { id: request.leadId, organization_id: request.organizationId, name: null }, error: null, status: 200 }
    : usesCustomReader ? await caller.rpc('read_guided_condition_custom_data', {
      p_workflow_id: request.authorization.workflowId, p_organization_id: request.organizationId,
      p_lead_id: request.leadId, p_fields: leadRequestedFields, p_tag_ids: [...tagIds], p_origin_ids: [...originIds], p_member_ids: [...memberIds],
    }).returns<Array<{ id: string; organization_id: string; field_values: Record<string, unknown> }>>().maybeSingle()
    : usesResponsibleReader ? await caller.rpc('read_guided_condition_data', {
      p_workflow_id: request.authorization.workflowId, p_organization_id: request.organizationId,
      p_lead_id: request.leadId, p_fields: leadRequestedFields, p_tag_ids: [...tagIds], p_origin_ids: [...originIds], p_member_ids: [...memberIds],
    }).returns<Array<{ id: string; organization_id: string; field_values: Record<string, unknown> }>>().maybeSingle()
    : usesOriginReader ? await caller.rpc('read_guided_condition_data', {
      p_workflow_id: request.authorization.workflowId, p_organization_id: request.organizationId,
      p_lead_id: request.leadId, p_fields: leadRequestedFields, p_tag_ids: [...tagIds], p_origin_ids: [...originIds],
    }).returns<Array<{ id: string; organization_id: string; field_values: Record<string, unknown> }>>().maybeSingle()
    : usesTagReader ? await caller.rpc('read_guided_condition_data', {
      p_workflow_id: request.authorization.workflowId, p_organization_id: request.organizationId,
      p_lead_id: request.leadId, p_fields: leadRequestedFields, p_tag_ids: [...tagIds],
    }).returns<Array<{ id: string; organization_id: string; field_values: Record<string, unknown> }>>().maybeSingle()
    : usesFieldReader ? await caller.rpc('read_guided_condition_lead_fields', {
      p_workflow_id: request.authorization.workflowId, p_organization_id: request.organizationId,
      p_lead_id: request.leadId, p_fields: fields,
    }).returns<Array<{ id: string; organization_id: string; field_values: Record<string, unknown> }>>().maybeSingle()
    : await caller.rpc('read_guided_condition_lead', {
      p_workflow_id: request.authorization.workflowId,
      p_organization_id: request.organizationId, p_lead_id: request.leadId,
    }).returns<Array<{ id: string; organization_id: string; name: string | null }>>().maybeSingle()
    : await caller.from('leads')
      .select(['id', 'organization_id', ...fields.map(field => GUIDED_SCALAR_FIELDS[field].column)].join(', '))
      .eq('organization_id', request.organizationId)
      .eq('id', request.leadId)
      .is('deleted_at', null)
      .maybeSingle();
  if (error) {
    return { status: 'error' as const, code: classifyGuidedSourceError(error, status) };
  }
  if (!data) return { status: 'error' as const, code: 'context_unavailable' as const };
  type BusinessStageData = {
    entry: { id: string; pipeline_id: string; stage_id: string; value: number | null; stage_elapsed_seconds: number | null };
    pipeline: { id: string; name: string };
    stages: Array<{ id: string; name: string; pipeline_id: string }>;
  };
  let businessStageData: BusinessStageData | null = null;
  if (businessFields.length) {
    if (!request.entryId) return { status: 'error' as const, code: 'context_unavailable' as const };
    const response = await caller.rpc(request.authorization?.kind === 'organization'
      ? 'read_guided_condition_trigger_business_data' : 'test_guided_condition_trigger_business_data', {
      ...(request.authorization?.kind === 'organization' ? { p_workflow_id: request.authorization.workflowId } : {}),
      p_organization_id: request.organizationId,
      p_lead_id: request.leadId,
      p_entry_id: request.entryId,
      p_fields: businessFields,
      p_references: [...businessStageReferences.values()],
    });
    if (response.error) {
      return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
    }
    const payload = response.data as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { status: 'error' as const, code: 'source_unavailable' as const };
    const candidate = payload as BusinessStageData;
    if (!candidate.entry || typeof candidate.entry.id !== 'string' || typeof candidate.entry.pipeline_id !== 'string'
      || typeof candidate.entry.stage_id !== 'string' || (candidate.entry.value !== null && (typeof candidate.entry.value !== 'number' || !Number.isFinite(candidate.entry.value)))
      || (candidate.entry.stage_elapsed_seconds !== null && (typeof candidate.entry.stage_elapsed_seconds !== 'number' || !Number.isFinite(candidate.entry.stage_elapsed_seconds)))
      || !candidate.pipeline || typeof candidate.pipeline.id !== 'string' || typeof candidate.pipeline.name !== 'string' || !Array.isArray(candidate.stages)
      || candidate.stages.some(stage => !stage || typeof stage.id !== 'string' || typeof stage.name !== 'string' || typeof stage.pipeline_id !== 'string')) {
      return { status: 'error' as const, code: 'source_unavailable' as const };
    }
    businessStageData = candidate;
    const stagePairs = new Set(candidate.stages.map(stage => `${stage.pipeline_id.toLowerCase()}:${stage.id.toLowerCase()}`));
    if (candidate.pipeline.id.toLowerCase() !== candidate.entry.pipeline_id.toLowerCase()
      || [...businessStageReferences.values()].some(reference => !stagePairs.has(`${reference.pipelineId}:${reference.stageId}`))) {
      return { status: 'error' as const, code: 'source_unavailable' as const };
    }
    if (businessFields.includes('business.trigger.stage_elapsed')
      && (candidate.entry.stage_elapsed_seconds === null || candidate.entry.stage_elapsed_seconds < 0)) {
      return { status: 'error' as const, code: 'source_unavailable' as const };
    }
  }
  type BusinessCandidate = { id: string; pipeline_id: string | null; pipeline_name: string | null; stage_id: string | null;
    value: number | null; outcome: 'open' | 'won' | 'lost' };
  let businessCandidates: BusinessCandidate[] = [];
  if (businessExistenceQueries.length) {
    const existenceFields = requestedFields.filter(field => field.startsWith('business.exists.'));
    const response = await caller.rpc(request.authorization?.kind === 'organization'
      ? 'read_guided_condition_business_candidates' : 'test_guided_condition_business_candidates', {
      ...(request.authorization?.kind === 'organization' ? { p_workflow_id: request.authorization.workflowId } : {}),
      p_organization_id: request.organizationId, p_lead_id: request.leadId, p_fields: existenceFields,
      p_stage_references: [...businessExistenceStageReferences.values()],
    });
    if (response.error) {
      return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
    }
    if (!Array.isArray(response.data) || response.data.some(candidate => !candidate || typeof candidate.id !== 'string'
      || (candidate.pipeline_id !== null && typeof candidate.pipeline_id !== 'string')
      || (candidate.pipeline_name !== null && typeof candidate.pipeline_name !== 'string')
      || (candidate.stage_id !== null && typeof candidate.stage_id !== 'string')
      || (existenceFields.includes('business.exists.stage')
        && (typeof candidate.pipeline_id !== 'string' || typeof candidate.pipeline_name !== 'string' || typeof candidate.stage_id !== 'string'))
      || (candidate.value !== null && (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value)))
      || (candidate.outcome !== 'open' && candidate.outcome !== 'won' && candidate.outcome !== 'lost'))) {
      return { status: 'error' as const, code: 'source_unavailable' as const };
    }
    businessCandidates = response.data as BusinessCandidate[];
  }
  type LastWon = { deal_id: string; title: string; won_at: string; won_date: string };
  let lastWon: LastWon | null = null;
  if (usesLastWonDate) {
    const response = await caller.rpc(request.authorization?.kind === 'organization'
      ? 'read_guided_condition_last_won' : 'test_guided_condition_last_won', {
      ...(request.authorization?.kind === 'organization' ? { p_workflow_id: request.authorization.workflowId } : {}),
      p_organization_id: request.organizationId, p_lead_id: request.leadId,
    });
    if (response.error) {
      return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
    }
    if (!Array.isArray(response.data) || response.data.length > 1) return { status: 'error' as const, code: 'source_unavailable' as const };
    if (response.data.length) {
      const candidate = response.data[0];
      if (!candidate || typeof candidate.deal_id !== 'string' || typeof candidate.title !== 'string'
        || typeof candidate.won_at !== 'string' || !Number.isFinite(Date.parse(candidate.won_at))
        || !isGuidedCalendarDate(candidate.won_date)) return { status: 'error' as const, code: 'source_unavailable' as const };
      lastWon = candidate as LastWon;
    }
  }
  type TriggerMessage = { message_id: string; text: string | null; text_source: string | null; text_state?: string;
    text_provider: string | null; text_created_at: string | null; provider: string; box_id: string; participant_id: string };
  let triggerMessage: TriggerMessage | null = null;
  if (usesTriggerMessage) {
    if (!request.messageContext) return { status: 'error' as const, code: 'context_unavailable' as const };
    const locator = request.messageContext;
    if ((locator.storage !== 'whatsapp_messages' && locator.storage !== 'channel_messages')
      || typeof locator.messageId !== 'string' || !GUIDED_UUID.test(locator.messageId)
      || typeof locator.boxId !== 'string' || !GUIDED_UUID.test(locator.boxId)
      || typeof locator.provider !== 'string' || !locator.provider.trim()
      || typeof locator.participantId !== 'string' || !locator.participantId.trim()) {
      return { status: 'error' as const, code: 'context_unavailable' as const };
    }
    const messageRules: GuidedTriggerMessageTextRule[] = [];
    const collectMessageRules = (current: GuidedCondition): void => {
      if ('kind' in current && current.kind === 'business_exists') return;
      if ('children' in current) current.children.forEach(collectMessageRules);
      else if (!('kind' in current) && current.field === 'message.trigger.text') messageRules.push(current);
    };
    collectMessageRules(request.condition);
    if (messageRules.some(rule => rule.conversation.kind === 'explicit' && (
      rule.conversation.storage !== locator.storage || rule.conversation.boxId.toLowerCase() !== locator.boxId.toLowerCase()
      || rule.conversation.provider.toLowerCase() !== locator.provider.toLowerCase()))) {
      return { status: 'error' as const, code: 'context_unavailable' as const };
    }
    const response = await caller.rpc(request.authorization?.kind === 'organization'
      ? 'read_guided_condition_trigger_message' : 'test_guided_condition_trigger_message', {
      ...(request.authorization?.kind === 'organization' ? { p_workflow_id: request.authorization.workflowId } : {}),
      p_organization_id: request.organizationId, p_lead_id: request.leadId, p_locator: locator,
    });
    if (response.error) {
      return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
    }
    const candidate = response.data as TriggerMessage | null;
    if (!candidate) return { status: 'error' as const, code: 'context_unavailable' as const };
    if (candidate.text_state === 'media_without_text') return { status: 'error' as const, code: 'message_text_unavailable' as const };
    if (typeof candidate.message_id !== 'string' || (candidate.text !== null && typeof candidate.text !== 'string')
      || (candidate.text_source !== null && typeof candidate.text_source !== 'string') || typeof candidate.provider !== 'string'
      || (candidate.text_provider !== null && typeof candidate.text_provider !== 'string')
      || (candidate.text_created_at !== null && (typeof candidate.text_created_at !== 'string' || !Number.isFinite(Date.parse(candidate.text_created_at))))
      || (candidate.text !== null && (!candidate.text_source || !candidate.text_provider || !candidate.text_created_at))
      || typeof candidate.box_id !== 'string' || typeof candidate.participant_id !== 'string') {
      return { status: 'error' as const, code: 'source_unavailable' as const };
    }
    triggerMessage = candidate;
  }
  type MessagePeriodData = { matched_message_id: string | null; matched_at: string | null;
    coverage_status: 'complete' | 'in_progress' | 'gapped' };
  const messagePeriods = new Map<string, MessagePeriodData>();
  if (usesMessagePeriod) {
    const periodRules: GuidedMessagePeriodRule[] = [];
    const collectPeriodRules = (current: GuidedCondition): void => {
      if ('kind' in current && current.kind === 'business_exists') return;
      if ('children' in current) current.children.forEach(collectPeriodRules);
      else if (!('kind' in current) && current.field === 'message.period.exists') periodRules.push(current);
    };
    collectPeriodRules(request.condition);
    if (periodRules.length > 20) return { status: 'error' as const, code: 'invalid_configuration' as const };
    for (const rule of periodRules) {
      const conversation = rule.conversation.kind === 'trigger' ? request.messageContext : rule.conversation;
      if (!conversation) return { status: 'error' as const, code: 'context_unavailable' as const };
      const response = await caller.rpc(request.authorization?.kind === 'organization'
        ? 'read_guided_condition_message_period' : 'test_guided_condition_message_period', {
        ...(request.authorization?.kind === 'organization' ? { p_workflow_id: request.authorization.workflowId } : {}),
        p_organization_id: request.organizationId, p_lead_id: request.leadId,
        p_conversation: conversation, p_from: rule.from, p_to: rule.to,
      });
      if (response.error) {
        return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
      }
      const candidate = response.data as MessagePeriodData | null;
      if (!candidate || !['complete', 'in_progress', 'gapped'].includes(candidate.coverage_status)
        || (candidate.matched_message_id !== null && (typeof candidate.matched_message_id !== 'string' || !GUIDED_UUID.test(candidate.matched_message_id)))
        || (candidate.matched_at !== null && (typeof candidate.matched_at !== 'string' || !Number.isFinite(Date.parse(candidate.matched_at))))) {
        return { status: 'error' as const, code: 'source_unavailable' as const };
      }
      if (!candidate.matched_message_id && candidate.coverage_status !== 'complete') return { status: 'error' as const,
        code: candidate.coverage_status === 'in_progress' ? 'history_sync_in_progress' as const : 'history_insufficient' as const };
      messagePeriods.set(rule.id, candidate);
    }
  }
  type MessageSearchData = { matched_message_id: string | null; matched_at: string | null; matched_text: string | null;
    text_source: string | null; text_provider: string | null; provider?: string; box_id?: string; participant_id?: string;
    text_state?: string; coverage_status: 'complete' | 'in_progress' | 'gapped' };
  const messageSearchResults = new Map<string, MessageSearchData>();
  if (usesMessageSearch) {
    const searchable = messageSearchRules.filter(rule => rule.source.kind!=='trigger');
    for (const rule of searchable) {
      const conversation = rule.conversation.kind==='trigger' ? request.messageContext : rule.conversation;
      if (!conversation) return { status: 'error' as const, code: 'context_unavailable' as const };
      const response = await caller.rpc(request.authorization?.kind==='organization'
        ? 'read_guided_condition_message_search' : 'test_guided_condition_message_search', {
        ...(request.authorization?.kind==='organization' ? { p_workflow_id: request.authorization.workflowId } : {}),
        p_organization_id: request.organizationId, p_lead_id: request.leadId, p_conversation: conversation,
        p_source: rule.source, p_expressions: rule.expressions, p_match_mode: rule.matchMode, p_expression_match: rule.expressionMatch,
      });
      if (response.error) {
        return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
      }
      const candidate=response.data as MessageSearchData|null;
      if (!candidate || !['complete','in_progress','gapped'].includes(candidate.coverage_status)
        || (candidate.matched_message_id!==null && (typeof candidate.matched_message_id!=='string' || !GUIDED_UUID.test(candidate.matched_message_id)))
        || (candidate.matched_text!==null && typeof candidate.matched_text!=='string')) return { status:'error' as const,code:'source_unavailable' as const };
      if (candidate.text_state==='media_without_text') return { status:'error' as const,code:'message_text_unavailable' as const };
      if (candidate.matched_message_id && (!candidate.matched_text || !candidate.text_source || !candidate.text_provider
        || !guidedMessageTextMatches(candidate.matched_text,rule.expressions,rule.matchMode,rule.expressionMatch)))
        return { status:'error' as const,code:'source_unavailable' as const };
      if (!candidate.matched_message_id && candidate.coverage_status!=='complete') return { status:'error' as const,
        code:candidate.coverage_status==='in_progress' ? 'history_sync_in_progress' as const : 'history_insufficient' as const };
      messageSearchResults.set(rule.id,candidate);
    }
  }
  type MessageWaitingData = { waiting: boolean; elapsed_seconds: number | null; anchor_message_id: string | null;
    anchor_at: string | null; direction: 'incoming' | 'outgoing' | null; provider: string; box_id: string; participant_id: string;
    coverage_status: 'complete' | 'in_progress' | 'gapped' };
  const messageWaitingResults = new Map<string, MessageWaitingData>();
  if (usesMessageWaiting) {
    if (messageWaitingRules.length > 20) return { status: 'error' as const, code: 'invalid_configuration' as const };
    for (const rule of messageWaitingRules) {
      const conversation = rule.conversation.kind === 'trigger' ? request.messageContext : rule.conversation;
      if (!conversation) return { status: 'error' as const, code: 'context_unavailable' as const };
      const response = await caller.rpc(request.authorization?.kind === 'organization'
        ? 'read_guided_condition_message_waiting' : 'test_guided_condition_message_waiting', {
        ...(request.authorization?.kind === 'organization' ? { p_workflow_id: request.authorization.workflowId } : {}),
        p_organization_id: request.organizationId, p_lead_id: request.leadId, p_conversation: conversation,
        p_waiting_for: rule.waitingFor,
      });
      if (response.error) {
        return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
      }
      const candidate = response.data as MessageWaitingData | null;
      if (!candidate || typeof candidate.waiting !== 'boolean' || !['complete', 'in_progress', 'gapped'].includes(candidate.coverage_status)
        || typeof candidate.provider !== 'string' || typeof candidate.box_id !== 'string' || typeof candidate.participant_id !== 'string'
        || (candidate.elapsed_seconds !== null && (typeof candidate.elapsed_seconds !== 'number' || !Number.isFinite(candidate.elapsed_seconds) || candidate.elapsed_seconds < 0))
        || (candidate.anchor_message_id !== null && (typeof candidate.anchor_message_id !== 'string' || !GUIDED_UUID.test(candidate.anchor_message_id)))
        || (candidate.anchor_at !== null && (typeof candidate.anchor_at !== 'string' || !Number.isFinite(Date.parse(candidate.anchor_at))))
        || (candidate.direction !== null && candidate.direction !== 'incoming' && candidate.direction !== 'outgoing')
        || (candidate.waiting && (!candidate.anchor_message_id || !candidate.anchor_at || candidate.elapsed_seconds === null || !candidate.direction))
        || (!candidate.waiting && (candidate.anchor_message_id !== null || candidate.anchor_at !== null || candidate.elapsed_seconds !== null || candidate.direction !== null))) {
        return { status: 'error' as const, code: 'source_unavailable' as const };
      }
      if (candidate.coverage_status !== 'complete') return { status: 'error' as const,
        code: candidate.coverage_status === 'in_progress' ? 'history_sync_in_progress' as const : 'history_insufficient' as const };
      messageWaitingResults.set(rule.id, candidate);
    }
  }
  type FollowUpData = { rule_id: string; matched: boolean; follow_up_id: string | null; title: string | null; event_date: string | null };
  const followUpResults = new Map<string, FollowUpData>();
  if (usesFollowUps) {
    if (followUpRules.length > 20) return { status: 'error' as const, code: 'invalid_configuration' as const };
    for (const rule of followUpRules) {
      if (rule.relation === 'trigger_business' && !request.entryId) {
        return { status: 'error' as const, code: 'context_unavailable' as const };
      }
      const response = await caller.rpc(request.authorization?.kind === 'organization'
        ? 'read_guided_condition_follow_up' : 'test_guided_condition_follow_up', {
        ...(request.authorization?.kind === 'organization' ? { p_workflow_id: request.authorization.workflowId } : {}),
        p_organization_id: request.organizationId,
        p_lead_id: request.leadId,
        p_entry_id: request.entryId ?? null,
        p_rule_id: rule.id,
        p_relation: rule.relation,
        p_state: rule.state,
        p_date_operator: rule.dateOperator,
        p_date: rule.dateOperator === 'any' ? null : rule.date,
      });
      if (response.error) {
        return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
      }
      const rows = response.data as FollowUpData[] | null;
      const candidate = rows?.[0];
      if (!Array.isArray(rows) || rows.length !== 1 || !candidate || candidate.rule_id !== rule.id
        || typeof candidate.matched !== 'boolean'
        || (candidate.follow_up_id !== null && (typeof candidate.follow_up_id !== 'string' || !GUIDED_UUID.test(candidate.follow_up_id)))
        || (candidate.title !== null && typeof candidate.title !== 'string')
        || (candidate.event_date !== null && !isGuidedCalendarDate(candidate.event_date))
        || (candidate.matched && (!candidate.follow_up_id || !candidate.title || !candidate.event_date))
        || (!candidate.matched && (candidate.follow_up_id !== null || candidate.title !== null || candidate.event_date !== null))) {
        return { status: 'error' as const, code: 'source_unavailable' as const };
      }
      followUpResults.set(rule.id, candidate);
    }
  }
  type ProductData = { rule_id: string; matched: boolean; product_id: string; product_name: string };
  const productResults = new Map<string, ProductData>();
  if (usesProducts) {
    if (productRules.length > 20) return { status: 'error' as const, code: 'invalid_configuration' as const };
    for (const rule of productRules) {
      if (rule.relation === 'trigger_business_item' && !request.entryId) {
        return { status: 'error' as const, code: 'context_unavailable' as const };
      }
      const response = await caller.rpc(request.authorization?.kind === 'organization'
        ? 'read_guided_condition_product_relation' : 'test_guided_condition_product_relation', {
        ...(request.authorization?.kind === 'organization' ? { p_workflow_id: request.authorization.workflowId } : {}),
        p_organization_id: request.organizationId,
        p_lead_id: request.leadId,
        p_entry_id: request.entryId ?? null,
        p_rule_id: rule.id,
        p_relation: rule.relation,
        p_product_id: rule.productId,
      });
      if (response.error) {
        return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
      }
      const rows = response.data as ProductData[] | null;
      const candidate = rows?.[0];
      if (!Array.isArray(rows) || rows.length !== 1 || !candidate || candidate.rule_id !== rule.id
        || typeof candidate.matched !== 'boolean' || typeof candidate.product_id !== 'string'
        || candidate.product_id.toLowerCase() !== rule.productId.toLowerCase()
        || typeof candidate.product_name !== 'string' || !candidate.product_name.trim()) {
        return { status: 'error' as const, code: 'source_unavailable' as const };
      }
      productResults.set(rule.id, candidate);
    }
  }
  const customFields = new Map<string, { id: string; name: string; value: string | number | boolean | null }>();
  if (customIds.size) {
    const response = usesCustomReader ? {
      data: (data as unknown as { field_values?: Record<string, unknown> }).field_values?.custom_fields, error: null, status: 200,
    } : await caller.rpc([...customExpectedTypes.values()].some(types => types.has('select')) ? 'test_guided_condition_custom_options' : 'test_guided_condition_custom_fields', {
      p_organization_id: request.organizationId, p_lead_id: request.leadId, p_field_ids: [...customIds],
    });
    if (response.error) {
      return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
    }
    const rows: unknown = response.data;
    if (!Array.isArray(rows)) return { status: 'error' as const, code: 'source_unavailable' as const };
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || typeof row.name !== 'string'
        || typeof row.field_type !== 'string' || (row.value !== null && typeof row.value !== 'string')) {
        return { status: 'error' as const, code: 'source_unavailable' as const };
      }
      const expectedTypes = customExpectedTypes.get(row.id.toLowerCase());
      if (!expectedTypes || expectedTypes.size !== 1 || !expectedTypes.has(row.field_type)) {
        return { status: 'error' as const, code: 'reference_unavailable' as const };
      }
      let value: string | number | boolean | null = row.value;
      if (row.field_type === 'select') {
        const options = row.field_options === null ? [] : row.field_options;
        if (!Array.isArray(options) || options.some(option => typeof option !== 'string' || option.length === 0)) {
          return { status: 'error' as const, code: 'source_unavailable' as const };
        }
        const registered = new Set<string>(options);
        if ([...(customOptionReferences.get(row.id.toLowerCase()) ?? [])].some(option => !registered.has(option))) {
          return { status: 'error' as const, code: 'reference_unavailable' as const };
        }
        if (row.value === null || row.value === '') value = null;
        else if (!registered.has(row.value)) return { status: 'error' as const, code: 'source_unavailable' as const };
      } else if (row.field_type === 'date') {
        if (row.value === null || row.value === '') value = null;
        else if (!isGuidedCalendarDate(row.value)) return { status: 'error' as const, code: 'source_unavailable' as const };
      } else if (row.field_type === 'boolean') {
        if (row.value === null || row.value === '') value = null;
        else if (row.value === 'true' || row.value === 'false') value = row.value === 'true';
        else return { status: 'error' as const, code: 'source_unavailable' as const };
      } else if (row.field_type === 'number') {
        if (row.value === null || row.value === '') value = null;
        else {
          // HTML number inputs persist decimal/scientific strings. Reject
          // ambiguous separators, whitespace and JS-only hex/Infinity syntax.
          if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(row.value) || !Number.isFinite(Number(row.value))) {
            return { status: 'error' as const, code: 'source_unavailable' as const };
          }
          value = Number(row.value);
          if (decimalIdentity(row.value) !== decimalIdentity(String(value))) {
            return { status: 'error' as const, code: 'source_unavailable' as const };
          }
        }
      }
      customFields.set(row.id.toLowerCase(), { id: row.id, name: row.name, value });
    }
    if ([...customIds].some(id => !customFields.has(id))) return { status: 'error' as const, code: 'reference_unavailable' as const };
  }
  type TagValue = { tag_id: string; tag_name: string; assigned: boolean };
  const tags = new Map<string, TagValue>();
  if (requestedFields.includes('lead.tags')) {
    const response = (usesCustomReader || usesTagReader || usesOriginReader || usesResponsibleReader) ? {
      data: (data as unknown as { field_values?: Record<string, unknown> }).field_values?.tags,
      error: null, status: 200,
    } : await caller.rpc('test_guided_condition_tags', {
      p_organization_id: request.organizationId, p_lead_id: request.leadId, p_tag_ids: [...tagIds],
    });
    if (response.error) {
      return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
    }
    const rows: unknown = response.data;
    if (!Array.isArray(rows)) return { status: 'error' as const, code: 'source_unavailable' as const };
    for (const tag of rows) {
      if (!tag || typeof tag.tag_id !== 'string' || typeof tag.tag_name !== 'string' || typeof tag.assigned !== 'boolean') {
        return { status: 'error' as const, code: 'source_unavailable' as const };
      }
      tags.set(tag.tag_id, tag);
    }
    if ([...tagIds].some(id => !tags.has(id))) return { status: 'error' as const, code: 'reference_unavailable' as const };
  }
  type OriginValue = { id: string; name: string; slug: string };
  const origins = new Map<string, OriginValue>();
  let actualOrigin: string | null = null;
  if (requestedFields.includes('lead.origin')) {
    const response = (usesCustomReader || usesOriginReader || usesResponsibleReader) ? {
      data: [(data as unknown as { field_values?: Record<string, unknown> }).field_values?.origin],
      error: null, status: 200,
    } : await caller.rpc('test_guided_condition_origins', {
      p_organization_id: request.organizationId, p_lead_id: request.leadId, p_origin_ids: [...originIds],
    });
    if (response.error) {
      return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
    }
    const rows = response.data;
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]
      || (rows[0].actual_origin !== null && typeof rows[0].actual_origin !== 'string')
      || !Array.isArray(rows[0].origins)) return { status: 'error' as const, code: 'source_unavailable' as const };
    actualOrigin = rows[0].actual_origin;
    for (const origin of rows[0].origins) {
      if (!origin || typeof origin.id !== 'string' || typeof origin.name !== 'string' || typeof origin.slug !== 'string') {
        return { status: 'error' as const, code: 'source_unavailable' as const };
      }
      origins.set(origin.id.toLowerCase(), origin);
    }
    if ([...originIds].some(id => !origins.has(id))) return { status: 'error' as const, code: 'reference_unavailable' as const };
  }
  const members = new Map<string, { id: string; name: string }>();
  let assignments: Record<string, unknown> = {};
  if (responsibleFields.length) {
    const response = (usesCustomReader || usesResponsibleReader) ? {
      data: [(data as unknown as { field_values?: Record<string, unknown> }).field_values?.responsibles],
      error: null, status: 200,
    } : await caller.rpc('test_guided_condition_responsibles', {
      p_organization_id: request.organizationId, p_lead_id: request.leadId,
      p_fields: responsibleFields, p_member_ids: [...memberIds],
    });
    if (response.error) {
      return { status: 'error' as const, code: classifyGuidedSourceError(response.error, response.status) };
    }
    const rows = response.data;
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || !Array.isArray(rows[0].members)
      || !rows[0].field_values || typeof rows[0].field_values !== 'object' || Array.isArray(rows[0].field_values)) {
      return { status: 'error' as const, code: 'source_unavailable' as const };
    }
    assignments = rows[0].field_values;
    if (responsibleFields.some(field => {
      const value = assignments[GUIDED_RESPONSIBLE_FIELDS[field].column];
      return value !== null && (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
    })) return { status: 'error' as const, code: 'source_unavailable' as const };
    for (const member of rows[0].members) {
      if (!member || typeof member.id !== 'string' || typeof member.name !== 'string') return { status: 'error' as const, code: 'source_unavailable' as const };
      members.set(member.id.toLowerCase(), member);
    }
    if ([...memberIds].some(id => !members.has(id))) return { status: 'error' as const, code: 'reference_unavailable' as const };
  }
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const record = (request.authorization && (usesCustomReader || usesFieldReader || usesTagReader || usesOriginReader || usesResponsibleReader)
    ? (data as unknown as { field_values: Record<string, unknown> }).field_values : data) as Record<string, unknown>;
  if (!record || fields.some(field => !Object.prototype.hasOwnProperty.call(record, GUIDED_SCALAR_FIELDS[field].column))) {
    return { status: 'error' as const, code: 'source_unavailable' as const };
  }
  if (fields.filter(isGuidedNumberField).some(field => {
    const value = record[GUIDED_SCALAR_FIELDS[field].column];
    return value !== null && (typeof value !== 'number' || !Number.isFinite(value));
  })) return { status: 'error' as const, code: 'source_unavailable' as const };
  type RuleResult = { id: string; status: 'evaluated'; matched: boolean; actual: unknown; reference?: { id: string; name: string } | {
    messageId: string; textSource: string | null; textProvider: string | null; textCreatedAt: string | null;
    provider: string; boxId: string; participantId: string } | { messageId: string; messageAt: string | null;
      direction?: 'incoming' | 'outgoing'; provider?: string; boxId?: string; participantId?: string };
    context?: { entryId: string; pipeline?: { id: string; name: string } } }
    | { id: string; status: 'not_evaluated' };
  type GroupResult = { id: string; status: 'evaluated'; matched: boolean } | { id: string; status: 'not_evaluated' };
  const rules: RuleResult[] = [];
  const groups: GroupResult[] = [];
  function skip(condition: GuidedCondition): void {
    if ('kind' in condition && condition.kind === 'business_exists') rules.push({ id: condition.id, status: 'not_evaluated' });
    else if ('children' in condition) {
      groups.push({ id: condition.id, status: 'not_evaluated' });
      condition.children.forEach(skip);
    } else rules.push({ id: condition.id, status: 'not_evaluated' });
  }
  function evaluate(condition: GuidedCondition): boolean {
    if ('kind' in condition && condition.kind === 'business_exists') {
      const candidates = condition.lifecycle === 'all' ? businessCandidates
        : businessCandidates.filter(candidate => candidate.outcome === condition.lifecycle);
      const matchesChild = (candidate: BusinessCandidate, child: GuidedBusinessExistenceChild) => {
        if (child.field === 'business.stage') {
          const same = candidate.pipeline_id?.toLowerCase() === child.pipelineId.toLowerCase()
            && candidate.stage_id?.toLowerCase() === child.stageId.toLowerCase();
          return child.operator === 'equals' ? same : !same;
        }
        const actual = candidate.value;
        const empty = actual === null;
        if (child.operator === 'is_empty') return empty;
        if (child.operator === 'is_not_empty') return !empty;
        if (empty) return false;
        switch (child.operator) {
          case 'equals': return actual === child.value;
          case 'not_equals': return actual !== child.value;
          case 'greater_than': return actual > child.value;
          case 'greater_than_or_equal': return actual >= child.value;
          case 'less_than': return actual < child.value;
          case 'less_than_or_equal': return actual <= child.value;
        }
      };
      const matching = candidates.find(candidate => condition.match === 'all'
        ? condition.children.every(child => matchesChild(candidate, child))
        : condition.children.some(child => matchesChild(candidate, child)));
      const matched = Boolean(matching);
      rules.push({ id: condition.id, status: 'evaluated', matched, actual: matching?.id ?? null,
        ...(matching ? { context: { entryId: matching.id, ...(matching.pipeline_id && matching.pipeline_name
          ? { pipeline: { id: matching.pipeline_id, name: matching.pipeline_name } } : {}) } } : {}) });
      return matched;
    }
    if ('children' in condition) {
      const group: Extract<GroupResult, { status: 'evaluated' }> = { id: condition.id, status: 'evaluated', matched: condition.match === 'all' };
      groups.push(group);
      let decided = false;
      for (const child of condition.children) {
        if (decided) { skip(child); continue; }
        const matched = evaluate(child);
        group.matched = matched;
        decided = condition.match === 'all' ? !matched : matched;
      }
      return group.matched;
    }
    if (condition.field === 'lead.pre_sale_responsible_id' || condition.field === 'lead.sale_responsible_id') {
      const actual = assignments[GUIDED_RESPONSIBLE_FIELDS[condition.field].column];
      const member = condition.operator === 'is_empty' || condition.operator === 'is_not_empty' ? undefined : members.get(condition.memberId.toLowerCase())!;
      const matched = condition.operator === 'is_empty' ? actual === null
        : condition.operator === 'is_not_empty' ? actual !== null
        : typeof actual === 'string' && (condition.operator === 'equals'
          ? actual.toLowerCase() === member!.id.toLowerCase() : actual.toLowerCase() !== member!.id.toLowerCase());
      rules.push({ id: condition.id, status: 'evaluated', matched, actual,
        ...(member ? { reference: { id: member.id, name: member.name } } : {}) });
      return matched;
    }
    if (condition.field === 'lead.origin') {
      const empty = actualOrigin === null || actualOrigin === '';
      const origin = condition.operator === 'is_empty' || condition.operator === 'is_not_empty' ? undefined : origins.get(condition.originId.toLowerCase())!;
      // Slugs encode catalogue identity: unlike display text, their case is significant.
      const matched = condition.operator === 'is_empty' ? empty
        : condition.operator === 'is_not_empty' ? !empty
        : !empty && (condition.operator === 'equals' ? actualOrigin === origin!.slug : actualOrigin !== origin!.slug);
      rules.push({ id: condition.id, status: 'evaluated', matched, actual: actualOrigin,
        ...(origin ? { reference: { id: origin.id, name: origin.name } } : {}) });
      return matched;
    }
    if (condition.field === 'lead.tags') {
      const tag = tags.get(condition.tagId.toLowerCase())!;
      const matched = condition.operator === 'has_tag' ? tag.assigned : !tag.assigned;
      rules.push({ id: condition.id, status: 'evaluated', matched, actual: tag.assigned,
        reference: { id: tag.tag_id, name: tag.tag_name } });
      return matched;
    }
    if (condition.field === 'business.trigger.stage') {
      const stage = businessStageData!.stages.find(item => item.id.toLowerCase() === condition.stageId.toLowerCase())!;
      const actual = businessStageData!.entry.stage_id;
      const samePipeline = businessStageData!.entry.pipeline_id.toLowerCase() === condition.pipelineId.toLowerCase();
      const sameStage = actual.toLowerCase() === condition.stageId.toLowerCase();
      const matched = condition.operator === 'equals' ? samePipeline && sameStage : !(samePipeline && sameStage);
      rules.push({ id: condition.id, status: 'evaluated', matched, actual,
        reference: { id: stage.id, name: stage.name },
        context: { entryId: businessStageData!.entry.id, pipeline: businessStageData!.pipeline },
      });
      return matched;
    }
    if (condition.field === 'business.trigger.value') {
      const actual = businessStageData!.entry.value;
      const empty = actual === null;
      let matched = condition.operator === 'is_empty' ? empty : condition.operator === 'is_not_empty' ? !empty : false;
      if (!empty && condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty') {
        switch (condition.operator) {
          case 'equals': matched = actual === condition.value; break;
          case 'not_equals': matched = actual !== condition.value; break;
          case 'greater_than': matched = actual > condition.value; break;
          case 'greater_than_or_equal': matched = actual >= condition.value; break;
          case 'less_than': matched = actual < condition.value; break;
          case 'less_than_or_equal': matched = actual <= condition.value; break;
        }
      }
      rules.push({ id: condition.id, status: 'evaluated', matched, actual,
        context: { entryId: businessStageData!.entry.id, pipeline: businessStageData!.pipeline } });
      return matched;
    }
    if (condition.field === 'business.trigger.stage_elapsed') {
      const seconds = businessStageData!.entry.stage_elapsed_seconds!;
      const unitSeconds = condition.unit === 'minutes' ? 60 : condition.unit === 'hours' ? 3_600 : 86_400;
      const expectedSeconds = condition.value * unitSeconds;
      let matched = false;
      switch (condition.operator) {
        case 'equals': matched = seconds === expectedSeconds; break;
        case 'not_equals': matched = seconds !== expectedSeconds; break;
        case 'greater_than': matched = seconds > expectedSeconds; break;
        case 'greater_than_or_equal': matched = seconds >= expectedSeconds; break;
        case 'less_than': matched = seconds < expectedSeconds; break;
        case 'less_than_or_equal': matched = seconds <= expectedSeconds; break;
      }
      rules.push({ id: condition.id, status: 'evaluated', matched, actual: seconds / unitSeconds,
        context: { entryId: businessStageData!.entry.id, pipeline: businessStageData!.pipeline } });
      return matched;
    }
    if (condition.field === 'business.last_won_date') {
      const actual = lastWon?.won_date ?? null;
      const empty = actual === null;
      let matched = condition.operator === 'is_empty' ? empty : condition.operator === 'is_not_empty' ? !empty : false;
      if (!empty && condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty') {
        if (condition.operator === 'equals') matched = actual === condition.value;
        else if (condition.operator === 'not_equals') matched = actual !== condition.value;
        else if (condition.operator === 'before') matched = actual < condition.value;
        else if (condition.operator === 'on_or_before') matched = actual <= condition.value;
        else if (condition.operator === 'after') matched = actual > condition.value;
        else matched = actual >= condition.value;
      }
      rules.push({ id: condition.id, status: 'evaluated', matched, actual,
        ...(lastWon ? { reference: { id: lastWon.deal_id, name: lastWon.title } } : {}) });
      return matched;
    }
    if (condition.field === 'activity.follow_up') {
      const candidate = followUpResults.get(condition.id)!;
      const exists = candidate.matched;
      const matched = condition.operator === 'exists' ? exists : !exists;
      rules.push({ id: condition.id, status: 'evaluated', matched, actual: candidate.event_date,
        ...(exists ? { reference: { id: candidate.follow_up_id!, name: candidate.title! } } : {}),
        ...(condition.relation === 'trigger_business' ? { context: { entryId: request.entryId! } } : {}) });
      return matched;
    }
    if (condition.field === 'product.relationship') {
      const candidate = productResults.get(condition.id)!;
      const matched = condition.operator === 'has_product' ? candidate.matched : !candidate.matched;
      rules.push({ id: condition.id, status: 'evaluated', matched, actual: candidate.matched,
        reference: { id: candidate.product_id, name: candidate.product_name },
        ...(condition.relation === 'trigger_business_item' ? { context: { entryId: request.entryId! } } : {}) });
      return matched;
    }
    if (condition.field === 'message.search.text') {
      const candidate = condition.source.kind==='trigger' ? {
        matched_message_id: guidedMessageTextMatches(triggerMessage!.text ?? '',condition.expressions,condition.matchMode,condition.expressionMatch)
          ? triggerMessage!.message_id : null,
        matched_at: triggerMessage!.text_created_at, matched_text: triggerMessage!.text,
        text_source: triggerMessage!.text_source, text_provider: triggerMessage!.text_provider,
        provider: triggerMessage!.provider, box_id: triggerMessage!.box_id, participant_id: triggerMessage!.participant_id,
      } : messageSearchResults.get(condition.id)!;
      const found=Boolean(candidate.matched_message_id);
      const matched=condition.operator==='matches' ? found : !found;
      rules.push({ id:condition.id,status:'evaluated',matched,actual:found,
        ...(found ? { reference:{ messageId:candidate.matched_message_id!, textSource:candidate.text_source,
          textProvider:candidate.text_provider,textCreatedAt:candidate.matched_at,provider:candidate.provider ?? '',
          boxId:candidate.box_id ?? '',participantId:candidate.participant_id ?? '' } } : {}) });
      return matched;
    }
    if (condition.field === 'message.waiting.elapsed') {
      const candidate = messageWaitingResults.get(condition.id)!;
      const unitSeconds = condition.unit === 'minutes' ? 60 : condition.unit === 'hours' ? 3_600 : 86_400;
      const actual = candidate.waiting ? candidate.elapsed_seconds! / unitSeconds : null;
      let matched = false;
      if (actual !== null) {
        if (condition.operator === 'equals') matched = actual === condition.value;
        else if (condition.operator === 'not_equals') matched = actual !== condition.value;
        else if (condition.operator === 'greater_than') matched = actual > condition.value;
        else if (condition.operator === 'greater_than_or_equal') matched = actual >= condition.value;
        else if (condition.operator === 'less_than') matched = actual < condition.value;
        else if (condition.operator === 'less_than_or_equal') matched = actual <= condition.value;
      }
      rules.push({ id: condition.id, status: 'evaluated', matched, actual,
        ...(candidate.waiting ? { reference: { messageId: candidate.anchor_message_id!, messageAt: candidate.anchor_at!,
          direction: candidate.direction!, provider: candidate.provider, boxId: candidate.box_id, participantId: candidate.participant_id } } : {}) });
      return matched;
    }
    if (condition.field === 'message.trigger.text') {
      const actual = triggerMessage!.text;
      const empty = actual === null || actual === '';
      let matched = condition.operator === 'is_empty' ? empty : condition.operator === 'is_not_empty' ? !empty : false;
      if (!empty && condition.operator !== 'is_empty' && condition.operator !== 'is_not_empty') {
        const left = normalize(actual!); const right = normalize(condition.value);
        if (condition.operator === 'equals') matched = left === right;
        else if (condition.operator === 'not_equals') matched = left !== right;
        else if (condition.operator === 'contains') matched = left.includes(right);
        else if (condition.operator === 'not_contains') matched = !left.includes(right);
        else if (condition.operator === 'starts_with') matched = left.startsWith(right);
        else matched = left.endsWith(right);
      }
      rules.push({ id: condition.id, status: 'evaluated', matched, actual,
        reference: { messageId: triggerMessage!.message_id, textSource: triggerMessage!.text_source,
          textProvider: triggerMessage!.text_provider, textCreatedAt: triggerMessage!.text_created_at,
          provider: triggerMessage!.provider, boxId: triggerMessage!.box_id, participantId: triggerMessage!.participant_id } });
      return matched;
    }
    if (condition.field === 'message.period.exists') {
      const period = messagePeriods.get(condition.id)!;
      const exists = Boolean(period.matched_message_id);
      const matched = condition.operator === 'exists' ? exists : !exists;
      rules.push({ id: condition.id, status: 'evaluated', matched, actual: exists,
        ...(period.matched_message_id ? { reference: { messageId: period.matched_message_id, messageAt: period.matched_at } } : {}) });
      return matched;
    }
    const customField = condition.field === 'lead.custom' ? customFields.get(condition.fieldId.toLowerCase())! : undefined;
    const actual = condition.field === 'lead.custom' ? customField!.value : record[GUIDED_SCALAR_FIELDS[condition.field].column];
    const empty = actual == null || actual === '';
    let matched = false;
    if (condition.operator === 'is_empty') matched = empty;
    else if (condition.operator === 'is_not_empty') matched = !empty;
    else if (condition.field === 'lead.custom' && condition.fieldType === 'select') {
      matched = !empty && typeof actual === 'string' && (condition.operator === 'equals' ? actual === condition.value : actual !== condition.value);
    }
    else if (condition.field === 'lead.custom' && condition.fieldType === 'date') {
      if (!empty && typeof actual === 'string') {
        switch (condition.operator) {
          case 'equals': matched = actual === condition.value; break;
          case 'not_equals': matched = actual !== condition.value; break;
          case 'before': matched = actual < condition.value; break;
          case 'on_or_before': matched = actual <= condition.value; break;
          case 'after': matched = actual > condition.value; break;
          case 'on_or_after': matched = actual >= condition.value; break;
        }
      }
    }
    else if (condition.field === 'lead.custom' && condition.fieldType === 'boolean') {
      matched = typeof actual === 'boolean' && (condition.operator === 'equals' ? actual === condition.value : actual !== condition.value);
    }
    else if (condition.field === 'lead.qualification_score' || (condition.field === 'lead.custom' && condition.fieldType === 'number')) {
      if (!empty && typeof actual === 'number') {
        switch (condition.operator) {
          case 'equals': matched = actual === condition.value; break;
          case 'not_equals': matched = actual !== condition.value; break;
          case 'greater_than': matched = actual > condition.value; break;
          case 'greater_than_or_equal': matched = actual >= condition.value; break;
          case 'less_than': matched = actual < condition.value; break;
          case 'less_than_or_equal': matched = actual <= condition.value; break;
        }
      }
    } else if (!empty && typeof actual === 'string') {
      const text = normalize(actual);
      const comparison = normalize(condition.value);
      switch (condition.operator) {
        case 'equals': matched = text === comparison; break;
        case 'not_equals': matched = text !== comparison; break;
        case 'contains': matched = text.includes(comparison); break;
        case 'not_contains': matched = !text.includes(comparison); break;
        case 'starts_with': matched = text.startsWith(comparison); break;
        case 'ends_with': matched = text.endsWith(comparison); break;
      }
    }
    rules.push({ id: condition.id, status: 'evaluated', matched, actual,
      ...(customField ? { reference: { id: customField.id, name: customField.name } } : {}) });
    return matched;
  }
  const matched = evaluate(request.condition);
  return { status: 'evaluated' as const, matched, rules, ...(groups.length ? { groups } : {}) };
}
