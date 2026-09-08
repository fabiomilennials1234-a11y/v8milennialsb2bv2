import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthError, requireAuth } from './user-auth.ts';
import { getCorsHeaders } from './cors.ts';
import { withSecurityHeaders } from './security-headers.ts';
import { isGuidedCondition } from './guided-condition.ts';
import { validateWorkflow } from './workflow-schema/validator.ts';
import type { WorkflowDefinition } from './workflow-schema/definition.ts';

type PublicationIssue = { code: string; nodeId?: string; message: string };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function publicationIssues(value: unknown): PublicationIssue[] {
  if (!record(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)
    || !value.nodes.every(node => record(node) && typeof node.id === 'string' && typeof node.type === 'string' && record(node.data))
    || !value.edges.every(edge => record(edge) && typeof edge.id === 'string' && typeof edge.source === 'string' && typeof edge.target === 'string')) {
    return [{ code: 'invalid_graph', message: 'Estrutura da automação inválida.' }];
  }
  const definition = value as unknown as WorkflowDefinition;
  const issues: PublicationIssue[] = validateWorkflow(definition).errors.filter(issue => issue.severity === 'error');
  for (const node of definition.nodes) {
    if (node.type !== 'condition') continue;
    if (!isGuidedCondition(node.data.guidedCondition)) {
      issues.push({ code: 'invalid_condition', nodeId: node.id, message: 'Complete a condição antes de publicar.' });
    }
    const outputs = definition.edges.filter(edge => edge.source === node.id);
    if (outputs.length !== 2 || outputs.filter(edge => edge.sourceHandle === 'yes').length !== 1
      || outputs.filter(edge => edge.sourceHandle === 'no').length !== 1) {
      issues.push({ code: 'invalid_condition_outputs', nodeId: node.id, message: 'Conecte as saídas Sim e Não uma vez cada.' });
    }
  }
  return issues;
}

/** Publish persisted, validated data only. Payload never supplies graph/settings. */
export async function handleGuidedWorkflowPublication(req: Request): Promise<Response> {
  const headers = { ...withSecurityHeaders(getCorsHeaders(req.headers.get('Origin'))), 'Content-Type': 'application/json' };
  const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply({ status: 'error', code: 'method_not_allowed' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply({ status: 'error', code: 'access_denied' }, 401);
  try {
    const body = await req.json().catch(() => null);
    if (!record(body) || typeof body.organizationId !== 'string' || !body.organizationId
      || typeof body.workflowId !== 'string' || !body.workflowId
      || !Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
      return reply({ status: 'error', code: 'invalid_configuration' }, 400);
    }
    const identity = await requireAuth(req, { organizationId: body.organizationId, requireOrganization: true });
    const key = Deno.env.get('ANON_KEY_2')?.trim() || Deno.env.get('ANON_KEY')?.trim() || Deno.env.get('SUPABASE_ANON_KEY')!;
    const caller = createClient(Deno.env.get('SUPABASE_URL')!, key, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization } },
    });
    const permission = await caller.rpc('can_administer_guided_workflow', { p_organization_id: identity.organizationId });
    if (permission.error || permission.data !== true) return reply({ status: 'error', code: 'access_denied' }, 403);
    const draft = await caller.from('workflow_guided_drafts').select('definition, settings, revision')
      .eq('organization_id', identity.organizationId).eq('workflow_id', body.workflowId).maybeSingle();
    if (draft.error) return reply({ status: 'error', code: 'source_unavailable' }, 503);
    if (!draft.data) return reply({ status: 'error', code: 'context_unavailable' }, 404);
    if (draft.data.revision !== body.expectedRevision) return reply({ status: 'error', code: 'draft_revision_conflict' }, 409);
    const issues = publicationIssues(draft.data.definition);
    if (!record(draft.data.settings) || typeof draft.data.settings.name !== 'string' || !draft.data.settings.name.trim()) {
      issues.push({ code: 'invalid_name', message: 'Informe o nome da automação antes de publicar.' });
    }
    if (issues.length) return reply({ status: 'error', code: 'invalid_configuration', issues }, 422);
    const definition = draft.data.definition as WorkflowDefinition;
    const requiredFields = [...new Set(definition.nodes.filter(node => node.type === 'condition')
      .map(node => (node.data.guidedCondition as { field: string }).field))];
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const publication = await service.rpc('finalize_guided_workflow_publication', {
      p_workflow_id: body.workflowId, p_organization_id: identity.organizationId, p_actor_id: identity.userId,
      p_expected_revision: draft.data.revision, p_definition: definition, p_settings: draft.data.settings,
      p_required_fields: requiredFields,
    });
    if (publication.error) {
      const code = publication.error.code;
      return reply({ status: 'error', code: code === 'PT409' ? 'draft_revision_conflict'
        : code === '42501' ? 'access_denied' : 'source_unavailable' }, code === 'PT409' ? 409 : code === '42501' ? 403 : 503);
    }
    return reply({ status: 'published', ...publication.data }, 200);
  } catch (error) {
    if (error instanceof AuthError) return reply({ status: 'error', code: 'access_denied' }, error.status);
    return reply({ status: 'error', code: 'source_unavailable' }, 503);
  }
}
