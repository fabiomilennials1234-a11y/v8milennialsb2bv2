import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type GuidedCondition = {
  version: 1;
  id: string;
  field: 'lead.name';
} & ({ operator: 'equals'; value: string } | { operator: 'is_empty' });

export interface GuidedConditionRequest {
  organizationId: string;
  leadId: string;
  condition: unknown;
  authorization?: { kind: 'organization'; workflowId: string };
}

function isGuidedCondition(value: unknown): value is GuidedCondition {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Record<string, unknown>;
  return rule.version === 1 && typeof rule.id === 'string' && rule.id.length > 0
    && rule.field === 'lead.name'
    && (rule.operator === 'is_empty' || (rule.operator === 'equals' && typeof rule.value === 'string' && rule.value.length > 0));
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
  const { data, error, status } = request.authorization?.kind === 'organization'
    ? await caller.rpc('read_guided_condition_lead', {
      p_workflow_id: request.authorization.workflowId,
      p_organization_id: request.organizationId, p_lead_id: request.leadId,
    }).returns<Array<{ id: string; organization_id: string; name: string | null }>>().maybeSingle()
    : await caller.from('leads')
      .select('id, organization_id, name')
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
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const empty = data.name == null || data.name === '';
  const matched = request.condition.operator === 'is_empty'
    ? empty
    : !empty && typeof data.name === 'string' && normalize(data.name) === normalize(request.condition.value);
  return {
    status: 'evaluated' as const, matched,
    rules: [{ id: request.condition.id, status: 'evaluated' as const, matched, actual: data.name }],
  };
}
