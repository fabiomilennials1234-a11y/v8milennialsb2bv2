import { useMutation, useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { WorkflowDefinition } from '@/types/workflow';

interface GuidedWorkflowDraft { definition: WorkflowDefinition; revision: number }
const database: SupabaseClient = supabase;

export function useGuidedWorkflowDraft(actorId?: string, organizationId?: string | null, workflowId?: string) {
  const query = useQuery({
    queryKey: ['guided-workflow-draft', actorId, organizationId, workflowId],
    enabled: Boolean(actorId && organizationId && workflowId),
    queryFn: async ({ signal }) => {
      const response = await database.from('workflow_guided_drafts').select('definition, revision')
        .eq('organization_id', organizationId!).eq('workflow_id', workflowId!)
        .abortSignal(signal).returns<GuidedWorkflowDraft[]>().maybeSingle();
      if (response.error) throw response.error;
      return response.data;
    },
  });
  const save = useMutation({
    mutationFn: async ({ definition, revision }: { definition: WorkflowDefinition; revision: number }) => {
      const response = await database.rpc('save_guided_workflow_draft', {
        p_workflow_id: workflowId, p_definition: definition, p_expected_revision: revision,
      });
      if (response.error) throw response.error;
      return response.data as { workflow_id: string; revision: number };
    },
  });
  const create = useMutation({
    mutationFn: async ({ id, name, definition }: { id: string; name: string; definition: WorkflowDefinition }) => {
      if (!actorId || !organizationId) throw new Error('Sem organização ou usuário');
      const response = await database.rpc('create_guided_workflow_draft', {
        p_workflow_id: id, p_organization_id: organizationId, p_name: name, p_definition: definition,
      });
      if (response.error) throw response.error;
      return response.data as { workflow_id: string; revision: number };
    },
  });
  return { ...query, save, create };
}
