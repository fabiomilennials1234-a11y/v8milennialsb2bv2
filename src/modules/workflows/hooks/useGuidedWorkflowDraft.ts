import { useMutation, useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { WorkflowDefinition } from '@/types/workflow';

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
  return { ...query, save, create };
}
