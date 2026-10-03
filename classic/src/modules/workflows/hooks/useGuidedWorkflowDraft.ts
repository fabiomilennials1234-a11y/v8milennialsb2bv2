import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { WorkflowDefinition } from '@/types/workflow';
import { GUIDED_CONDITION_LIMITS } from '@/contracts/workflows/guided-limits';

export interface GuidedPublicationIssue { code: string; message: string; nodeId?: string }
export class GuidedPublicationError extends Error {
  constructor(public code: string, public issues: GuidedPublicationIssue[]) {
    super('Não foi possível publicar. Seu rascunho foi preservado.');
  }
}

export interface GuidedWorkflowSettings {
  name: string;
  enrollment_criteria: { enabled: boolean; match_all: boolean; conditions: Array<{ field: string; operator: string; value: string }> };
  re_enrollment_enabled: boolean;
  re_enrollment_cooldown_days: number;
  re_enrollment_max_times: number;
}
interface GuidedWorkflowDraft { definition: WorkflowDefinition; revision: number; settings: Partial<GuidedWorkflowSettings> | null }
const database: SupabaseClient = supabase;

export function useGuidedWorkflowDraft(actorId?: string, organizationId?: string | null, workflowId?: string) {
  const queryClient = useQueryClient();
  const publicationKey = ['guided-workflow-publication', actorId, organizationId, workflowId];
  const query = useQuery({
    queryKey: ['guided-workflow-draft', actorId, organizationId, workflowId],
    enabled: Boolean(actorId && organizationId && workflowId),
    refetchOnMount: 'always',
    queryFn: async ({ signal }) => {
      const response = await database.from('workflow_guided_drafts').select('definition, settings, revision')
        .eq('organization_id', organizationId!).eq('workflow_id', workflowId!)
        .abortSignal(signal).returns<GuidedWorkflowDraft[]>().maybeSingle();
      if (response.error) throw response.error;
      return response.data;
    },
  });
  const publication = useQuery({
    queryKey: publicationKey,
    enabled: Boolean(query.data && actorId && organizationId && workflowId),
    refetchOnMount: 'always',
    queryFn: async ({ signal }) => {
      const response = await database.from('workflow_guided_publications').select('version_id')
        .eq('workflow_id', workflowId!).eq('organization_id', organizationId!).abortSignal(signal)
        .returns<Array<{ version_id: string }>>().maybeSingle();
      if (response.error) throw response.error;
      return response.data;
    },
  });
  const setActive = useMutation({
    mutationFn: async (active: boolean) => {
      const response = await database.rpc('set_guided_workflow_active', {
        p_workflow_id: workflowId, p_active: active, p_expected_version_id: publication.data?.version_id ?? null,
      });
      if (response.error) throw response.error;
      return response.data as { is_active: boolean };
    },
  });
  const save = useMutation({
    mutationFn: async ({ definition, revision, settings }: { definition: WorkflowDefinition; revision: number; settings: GuidedWorkflowSettings }) => {
      const response = await database.rpc('save_guided_workflow_draft_with_settings', {
        p_workflow_id: workflowId, p_definition: definition, p_expected_revision: revision, p_settings: settings,
      });
      if (response.error) throw response.error;
      return response.data as { workflow_id: string; revision: number };
    },
  });
  const create = useMutation({
    mutationFn: async ({ id, settings, definition }: { id: string; settings: GuidedWorkflowSettings; definition: WorkflowDefinition }) => {
      if (!actorId || !organizationId) throw new Error('Sem organização ou usuário');
      const response = await database.rpc('create_guided_workflow_draft_with_settings', {
        p_workflow_id: id, p_organization_id: organizationId, p_settings: settings, p_definition: definition,
      });
      if (response.error) throw response.error;
      return response.data as { workflow_id: string; revision: number };
    },
  });
  const publish = useMutation({
    mutationFn: async (revision: number) => {
      try {
        const response = await database.functions.invoke('publish-guided-workflow', {
          signal: AbortSignal.timeout(GUIDED_CONDITION_LIMITS.uiTimeoutMs),
          body: { organizationId, workflowId, expectedRevision: revision },
        });
        if (response.error) {
          const context = response.error && typeof response.error === 'object' && 'context' in response.error
            ? response.error.context : null;
          if (context instanceof DOMException && context.name === 'TimeoutError') {
            throw new GuidedPublicationError('temporarily_unavailable', [{
              code: 'temporarily_unavailable',
              message: `A publicação excedeu ${GUIDED_CONDITION_LIMITS.uiTimeoutMs / 1000} segundos. Tente novamente.`,
            }]);
          }
          const body = response.error.context instanceof Response
            ? await response.error.context.json().catch(() => null) : null;
          const issues = Array.isArray(body?.issues) ? body.issues.filter((issue: unknown): issue is GuidedPublicationIssue =>
            !!issue && typeof issue === 'object' && 'code' in issue && typeof issue.code === 'string'
            && 'message' in issue && typeof issue.message === 'string'
            && (!('nodeId' in issue) || typeof issue.nodeId === 'string')) : [];
          throw new GuidedPublicationError(typeof body?.code === 'string' ? body.code : 'source_unavailable', issues);
        }
        if (response.data?.status !== 'published') throw new Error('Não foi possível publicar.');
        queryClient.setQueryData(publicationKey, { version_id: response.data.version_id });
        return response.data as { version_id: string; version_number: number };
      } catch (failure) {
        if (failure instanceof DOMException && failure.name === 'TimeoutError') {
          throw new GuidedPublicationError('temporarily_unavailable', [{
            code: 'temporarily_unavailable',
            message: `A publicação excedeu ${GUIDED_CONDITION_LIMITS.uiTimeoutMs / 1000} segundos. Tente novamente.`,
          }]);
        }
        throw failure;
      }
    },
  });
  return { ...query, save, create, publish, publication, setActive };
}
