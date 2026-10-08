import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import type { GuidedBusinessExistenceChildDraft, GuidedTriggerBusinessStageRuleDraft } from '@/types/workflow';

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type GuidedBusinessStageDraft = GuidedTriggerBusinessStageRuleDraft | Extract<GuidedBusinessExistenceChildDraft, { field: 'business.stage' }>;

export function GuidedBusinessStagePicker<T extends GuidedBusinessStageDraft>({ actorId, organizationId, condition, onChange }: {
  actorId: string;
  organizationId: string;
  condition: T;
  onChange: (condition: T) => void;
}) {
  const pipelines = useQuery({
    queryKey: ['guided-business-pipelines', actorId, organizationId],
    enabled: Boolean(actorId && organizationId),
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('pipelines').select('id, name, is_active, display_order')
        .eq('organization_id', organizationId).eq('is_active', true).order('display_order').abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
  const stages = useQuery({
    queryKey: ['guided-business-stages', actorId, organizationId, condition.pipelineId],
    enabled: Boolean(actorId && organizationId && condition.pipelineId),
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('pipeline_stages').select('id, pipeline_id, name, position')
        .eq('organization_id', organizationId).eq('pipeline_id', condition.pipelineId).order('position').abortSignal(signal);
      if (error) throw error;
      return data;
    },
  });
  const selectedPipeline = pipelines.data?.find(pipeline => pipeline.id === condition.pipelineId);
  const selectedStage = stages.data?.find(stage => stage.id === condition.stageId);
  useEffect(() => {
    if (selectedPipeline && selectedStage
      && (condition.pipelineLabel !== selectedPipeline.name || condition.stageLabel !== selectedStage.name)) {
      onChange({ ...condition, pipelineLabel: selectedPipeline.name, stageLabel: selectedStage.name });
    }
  }, [condition, onChange, selectedPipeline, selectedStage]);
  const pipelineUnavailable = Boolean(condition.pipelineId && pipelines.isSuccess && !selectedPipeline);
  const stageUnavailable = Boolean(condition.stageId && stages.isSuccess && !selectedStage);
  return <div className="space-y-4">
    <div className="space-y-2">
      <Label htmlFor={`guided-pipeline-${condition.id}`}>Funil</Label>
      <select id={`guided-pipeline-${condition.id}`} className={selectClass} value={condition.pipelineId}
        aria-invalid={pipelineUnavailable} onChange={event => {
          const pipeline = pipelines.data?.find(item => item.id === event.target.value);
          onChange({ ...condition, pipelineId: event.target.value, pipelineLabel: pipeline?.name,
            stageId: '', stageLabel: undefined });
        }}>
        <option value="">{pipelines.isPending ? 'Carregando funis…' : 'Selecione um funil'}</option>
        {pipelineUnavailable && <option value={condition.pipelineId} disabled>Funil indisponível</option>}
        {pipelines.data?.map(pipeline => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
      </select>
      {pipelines.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar funis.</p>}
      {pipelineUnavailable && <p role="alert" className="text-sm text-destructive">Funil removido ou sem acesso. Selecione outro funil.</p>}
    </div>
    <div className="space-y-2">
      <Label htmlFor={`guided-stage-${condition.id}`}>Etapa</Label>
      <select id={`guided-stage-${condition.id}`} className={selectClass} value={condition.stageId}
        disabled={!condition.pipelineId || stages.isPending || stages.isError} aria-invalid={stageUnavailable}
        onChange={event => {
          const stage = stages.data?.find(item => item.id === event.target.value);
          onChange({ ...condition, stageId: event.target.value, stageLabel: stage?.name });
        }}>
        <option value="">{stages.isPending && condition.pipelineId ? 'Carregando etapas…' : 'Selecione uma etapa'}</option>
        {stageUnavailable && <option value={condition.stageId} disabled>Etapa indisponível</option>}
        {stages.data?.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
      </select>
      {stages.isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar etapas deste funil.</p>}
      {stageUnavailable && <p role="alert" className="text-sm text-destructive">Etapa removida ou pertencente a outro funil. Selecione outra etapa.</p>}
    </div>
  </div>;
}
