import { GUIDED_TEXT_FIELDS, isGuidedTextField, isGuidedTextOperator, type GuidedTextComparison, type GuidedTextField } from '../../../src/contracts/workflows/guided-fields.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type GuidedScalarRule = {
  version: 1;
  id: string;
  field: GuidedTextField;
} & GuidedTextComparison;

export type GuidedRule = GuidedScalarRule | {
  version: 1; id: string; field: 'lead.tags'; operator: 'has_tag' | 'not_has_tag'; tagId: string;
};

export interface GuidedConditionRequest {
  organizationId: string;
  leadId: string;
  condition: unknown;
  authorization?: { kind: 'organization'; workflowId: string };
}

export type GuidedCondition = GuidedRule | {
  version: 1; id: string; kind: 'group'; match: 'all' | 'any'; children: GuidedCondition[];
};

export function isGuidedCondition(value: unknown): value is GuidedCondition {
  const ids = new Set<string>();
  function valid(value: unknown, groupDepth: number): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const rule = value as Record<string, unknown>;
    if (rule.version !== 1 || typeof rule.id !== 'string' || !rule.id || ids.has(rule.id)) return false;
    ids.add(rule.id);
    if (rule.kind === 'group') {
      return groupDepth < 3 && (rule.match === 'all' || rule.match === 'any')
        && Array.isArray(rule.children) && rule.children.length > 0
        && rule.children.every(child => valid(child, groupDepth + 1));
    }
    if ('children' in rule || 'match' in rule || 'kind' in rule) return false;
    if (rule.field === 'lead.tags') return (rule.operator === 'has_tag' || rule.operator === 'not_has_tag')
      && typeof rule.tagId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rule.tagId);
    return isGuidedTextField(rule.field) && (rule.operator === 'is_empty'
      || (isGuidedTextOperator(rule.operator) && typeof rule.value === 'string' && rule.value.length > 0));
  }
  return valid(value, 0);
}

export function guidedConditionFields(condition: GuidedCondition): string[] {
  return 'children' in condition ? [...new Set(condition.children.flatMap(guidedConditionFields))] : [condition.field];
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
  if (request.authorization && requestedFields.includes('lead.tags')) return { status: 'error' as const, code: 'access_denied' as const };
  const fields = requestedFields.filter(isGuidedTextField);
  const usesFieldReader = fields.some(field => field !== 'lead.name');
  const { data, error, status } = request.authorization?.kind === 'organization'
    ? usesFieldReader ? await caller.rpc('read_guided_condition_lead_fields', {
      p_workflow_id: request.authorization.workflowId, p_organization_id: request.organizationId,
      p_lead_id: request.leadId, p_fields: fields,
    }).returns<Array<{ id: string; organization_id: string; field_values: Record<string, unknown> }>>().maybeSingle()
    : await caller.rpc('read_guided_condition_lead', {
      p_workflow_id: request.authorization.workflowId,
      p_organization_id: request.organizationId, p_lead_id: request.leadId,
    }).returns<Array<{ id: string; organization_id: string; name: string | null }>>().maybeSingle()
    : await caller.from('leads')
      .select(['id', 'organization_id', ...fields.map(field => GUIDED_TEXT_FIELDS[field].column)].join(', '))
      .eq('organization_id', request.organizationId)
      .eq('id', request.leadId)
      .is('deleted_at', null)
      .maybeSingle();
  if (error) {
    if (status === 401 || status === 403 || error.code === '42501') {
      return { status: 'error' as const, code: 'access_denied' as const };
    }
    const temporary = status === 0 || status === 429 || status >= 500
      || ['57014', '40001', '40P01', '53300', '57P01'].includes(error.code);
    return {
      status: 'error' as const,
      code: temporary ? 'temporarily_unavailable' as const : 'source_unavailable' as const,
    };
  }
  if (!data) return { status: 'error' as const, code: 'context_unavailable' as const };
  type TagValue = { tag_id: string; tag_name: string; assigned: boolean };
  const tags = new Map<string, TagValue>();
  if (requestedFields.includes('lead.tags')) {
    const tagIds = new Set<string>();
    function collect(current: GuidedCondition): void {
      if ('children' in current) current.children.forEach(collect);
      else if (current.field === 'lead.tags') tagIds.add(current.tagId.toLowerCase());
    }
    collect(request.condition);
    const response = await caller.rpc('test_guided_condition_tags', {
      p_organization_id: request.organizationId, p_lead_id: request.leadId, p_tag_ids: [...tagIds],
    });
    if (response.error) {
      const code = response.error.code === 'PT422' ? 'reference_unavailable' as const
        : response.error.code === 'PT404' ? 'context_unavailable' as const
        : response.error.code === '42501' ? 'access_denied' as const
        : response.status >= 500 || response.status === 0 || response.status === 429 ? 'temporarily_unavailable' as const : 'source_unavailable' as const;
      return { status: 'error' as const, code };
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
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const record = (request.authorization && usesFieldReader
    ? (data as unknown as { field_values: Record<string, unknown> }).field_values : data) as Record<string, unknown>;
  if (!record || fields.some(field => !Object.prototype.hasOwnProperty.call(record, GUIDED_TEXT_FIELDS[field].column))) {
    return { status: 'error' as const, code: 'source_unavailable' as const };
  }
  type RuleResult = { id: string; status: 'evaluated'; matched: boolean; actual: unknown; reference?: { id: string; name: string } }
    | { id: string; status: 'not_evaluated' };
  type GroupResult = { id: string; status: 'evaluated'; matched: boolean } | { id: string; status: 'not_evaluated' };
  const rules: RuleResult[] = [];
  const groups: GroupResult[] = [];
  function skip(condition: GuidedCondition): void {
    if ('children' in condition) {
      groups.push({ id: condition.id, status: 'not_evaluated' });
      condition.children.forEach(skip);
    } else rules.push({ id: condition.id, status: 'not_evaluated' });
  }
  function evaluate(condition: GuidedCondition): boolean {
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
    if (condition.field === 'lead.tags') {
      const tag = tags.get(condition.tagId.toLowerCase())!;
      const matched = condition.operator === 'has_tag' ? tag.assigned : !tag.assigned;
      rules.push({ id: condition.id, status: 'evaluated', matched, actual: tag.assigned,
        reference: { id: tag.tag_id, name: tag.tag_name } });
      return matched;
    }
    const actual = record[GUIDED_TEXT_FIELDS[condition.field].column];
    const empty = actual == null || actual === '';
    let matched = false;
    if (condition.operator === 'is_empty') matched = empty;
    else if (!empty && typeof actual === 'string') {
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
    rules.push({ id: condition.id, status: 'evaluated', matched, actual });
    return matched;
  }
  const matched = evaluate(request.condition);
  return { status: 'evaluated' as const, matched, rules, ...(groups.length ? { groups } : {}) };
}
