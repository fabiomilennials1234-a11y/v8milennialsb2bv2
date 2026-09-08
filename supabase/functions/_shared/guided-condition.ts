import { GUIDED_RESPONSIBLE_FIELDS, isGuidedResponsibleField, type GuidedResponsibleField, GUIDED_SCALAR_FIELDS, isGuidedScalarField, isGuidedNumberField, isGuidedNumberOperator, type GuidedNumberField, type GuidedNumberComparison, isGuidedTextField, isGuidedTextOperator, type GuidedTextComparison, type GuidedTextField } from '../../../src/contracts/workflows/guided-fields.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

export type GuidedRule = GuidedResponsibleRule | GuidedOriginRule | GuidedScalarRule | ({ version: 1; id: string; field: GuidedNumberField } & GuidedNumberComparison) | {
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
    if (isGuidedResponsibleField(rule.field)) return rule.operator === 'is_empty' || rule.operator === 'is_not_empty'
      || ((rule.operator === 'equals' || rule.operator === 'not_equals') && typeof rule.memberId === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rule.memberId));
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
  const responsibleFields = requestedFields.filter(isGuidedResponsibleField);
  const memberIds = new Set<string>();
  const originIds = new Set<string>();
  const tagIds = new Set<string>();
  function collect(current: GuidedCondition): void {
    if ('children' in current) current.children.forEach(collect);
    else if (isGuidedResponsibleField(current.field) && current.operator !== 'is_empty' && current.operator !== 'is_not_empty' && 'memberId' in current) memberIds.add(current.memberId.toLowerCase());
    else if (current.field === 'lead.origin' && current.operator !== 'is_empty' && current.operator !== 'is_not_empty') originIds.add(current.originId.toLowerCase());
    else if (current.field === 'lead.tags') tagIds.add(current.tagId.toLowerCase());
  }
  collect(request.condition);
  const fields = requestedFields.filter(isGuidedScalarField);
  const usesFieldReader = fields.some(field => field !== 'lead.name');
  const usesResponsibleReader = Boolean(request.authorization && responsibleFields.length);
  const usesOriginReader = Boolean(request.authorization && requestedFields.includes('lead.origin'));
  const usesTagReader = Boolean(request.authorization && tagIds.size);
  const { data, error, status } = request.authorization?.kind === 'organization'
    ? usesResponsibleReader ? await caller.rpc('read_guided_condition_data', {
      p_workflow_id: request.authorization.workflowId, p_organization_id: request.organizationId,
      p_lead_id: request.leadId, p_fields: requestedFields, p_tag_ids: [...tagIds], p_origin_ids: [...originIds], p_member_ids: [...memberIds],
    }).returns<Array<{ id: string; organization_id: string; field_values: Record<string, unknown> }>>().maybeSingle()
    : usesOriginReader ? await caller.rpc('read_guided_condition_data', {
      p_workflow_id: request.authorization.workflowId, p_organization_id: request.organizationId,
      p_lead_id: request.leadId, p_fields: requestedFields, p_tag_ids: [...tagIds], p_origin_ids: [...originIds],
    }).returns<Array<{ id: string; organization_id: string; field_values: Record<string, unknown> }>>().maybeSingle()
    : usesTagReader ? await caller.rpc('read_guided_condition_data', {
      p_workflow_id: request.authorization.workflowId, p_organization_id: request.organizationId,
      p_lead_id: request.leadId, p_fields: requestedFields, p_tag_ids: [...tagIds],
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
    if (error.code === 'PT404') return { status: 'error' as const, code: 'context_unavailable' as const };
    if (error.code === 'PT422') return { status: 'error' as const, code: 'reference_unavailable' as const };
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
    const response = (usesTagReader || usesOriginReader || usesResponsibleReader) ? {
      data: (data as unknown as { field_values?: Record<string, unknown> }).field_values?.tags,
      error: null, status: 200,
    } : await caller.rpc('test_guided_condition_tags', {
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
  type OriginValue = { id: string; name: string; slug: string };
  const origins = new Map<string, OriginValue>();
  let actualOrigin: string | null = null;
  if (requestedFields.includes('lead.origin')) {
    const response = (usesOriginReader || usesResponsibleReader) ? {
      data: [(data as unknown as { field_values?: Record<string, unknown> }).field_values?.origin],
      error: null, status: 200,
    } : await caller.rpc('test_guided_condition_origins', {
      p_organization_id: request.organizationId, p_lead_id: request.leadId, p_origin_ids: [...originIds],
    });
    if (response.error) {
      const code = response.error.code === 'PT422' ? 'reference_unavailable' as const
        : response.error.code === 'PT404' ? 'context_unavailable' as const
        : response.error.code === '42501' || response.status === 401 || response.status === 403 ? 'access_denied' as const
        : response.status >= 500 || response.status === 0 || response.status === 429 ? 'temporarily_unavailable' as const : 'source_unavailable' as const;
      return { status: 'error' as const, code };
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
    const response = usesResponsibleReader ? {
      data: [(data as unknown as { field_values?: Record<string, unknown> }).field_values?.responsibles],
      error: null, status: 200,
    } : await caller.rpc('test_guided_condition_responsibles', {
      p_organization_id: request.organizationId, p_lead_id: request.leadId,
      p_fields: responsibleFields, p_member_ids: [...memberIds],
    });
    if (response.error) {
      const code = response.error.code === 'PT422' ? 'reference_unavailable' as const
        : response.error.code === 'PT404' ? 'context_unavailable' as const
        : response.error.code === '42501' || response.status === 401 || response.status === 403 ? 'access_denied' as const
        : response.status >= 500 || response.status === 0 || response.status === 429 ? 'temporarily_unavailable' as const : 'source_unavailable' as const;
      return { status: 'error' as const, code };
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
  const record = (request.authorization && (usesFieldReader || usesTagReader || usesOriginReader || usesResponsibleReader)
    ? (data as unknown as { field_values: Record<string, unknown> }).field_values : data) as Record<string, unknown>;
  if (!record || fields.some(field => !Object.prototype.hasOwnProperty.call(record, GUIDED_SCALAR_FIELDS[field].column))) {
    return { status: 'error' as const, code: 'source_unavailable' as const };
  }
  if (fields.filter(isGuidedNumberField).some(field => {
    const value = record[GUIDED_SCALAR_FIELDS[field].column];
    return value !== null && (typeof value !== 'number' || !Number.isFinite(value));
  })) return { status: 'error' as const, code: 'source_unavailable' as const };
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
    const actual = record[GUIDED_SCALAR_FIELDS[condition.field].column];
    const empty = actual == null || actual === '';
    let matched = false;
    if (condition.operator === 'is_empty') matched = empty;
    else if (condition.operator === 'is_not_empty') matched = !empty;
    else if (condition.field === 'lead.qualification_score') {
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
    rules.push({ id: condition.id, status: 'evaluated', matched, actual });
    return matched;
  }
  const matched = evaluate(request.condition);
  return { status: 'evaluated' as const, matched, rules, ...(groups.length ? { groups } : {}) };
}
