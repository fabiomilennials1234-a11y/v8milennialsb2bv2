import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import type { Workflow, TriggerConfigStageChanged } from "@/types/workflow";

interface StageWorkflow {
  id: string;
  name: string;
  is_active: boolean;
}

/**
 * Busca workflows vinculados a uma etapa específica de um pipe padrão.
 * Filtra por trigger_type = 'stage_changed' e verifica trigger_config.
 */
export function useStageWorkflows(
  pipeType: string | undefined,
  stageKey: string | undefined
) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["stage-workflows", organizationId, pipeType, stageKey],
    queryFn: async (): Promise<StageWorkflow[]> => {
      if (!organizationId || !pipeType || !stageKey) return [];

      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, is_active, trigger_type, trigger_config")
        .eq("organization_id", organizationId)
        .eq("trigger_type", "stage_changed");

      if (error) throw error;
      if (!data) return [];

      // Filter in JS because trigger_config is JSONB and we need complex matching
      return (data as unknown as Workflow[]).filter((w) => {
        const cfg = w.trigger_config as TriggerConfigStageChanged;
        if (!cfg) return false;

        // Match pipe_type
        if (cfg.pipe_type !== pipeType) return false;

        // If workflow has specific stages array, check if this stage is included
        if (cfg.stages && cfg.stages.length > 0) {
          return cfg.stages.includes(stageKey);
        }

        // If workflow has to_stage, match it
        if (cfg.to_stage) {
          return cfg.to_stage === stageKey;
        }

        // No stage filter = matches all stages in this pipe
        return true;
      }).map((w) => ({
        id: w.id,
        name: w.name,
        is_active: w.is_active,
      }));
    },
    enabled: isReady && !!organizationId && !!pipeType && !!stageKey,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Busca workflows vinculados a uma etapa de um pipeline custom.
 */
export function useCustomPipeStageWorkflows(
  pipelineId: string | undefined,
  stageId: string | undefined
) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["stage-workflows-custom", organizationId, pipelineId, stageId],
    queryFn: async (): Promise<StageWorkflow[]> => {
      if (!organizationId || !pipelineId || !stageId) return [];

      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, is_active, trigger_type, trigger_config")
        .eq("organization_id", organizationId)
        .eq("trigger_type", "stage_changed");

      if (error) throw error;
      if (!data) return [];

      return (data as unknown as Workflow[]).filter((w) => {
        const cfg = w.trigger_config as TriggerConfigStageChanged;
        if (!cfg) return false;

        if (cfg.pipeline_id !== pipelineId) return false;

        if (cfg.stages && cfg.stages.length > 0) {
          return cfg.stages.includes(stageId);
        }

        if (cfg.to_stage) {
          return cfg.to_stage === stageId;
        }

        return true;
      }).map((w) => ({
        id: w.id,
        name: w.name,
        is_active: w.is_active,
      }));
    },
    enabled: isReady && !!organizationId && !!pipelineId && !!stageId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Busca contagem de workflows por etapa para um pipe inteiro.
 * Mais eficiente que chamar useStageWorkflows para cada coluna.
 */
export function useStageWorkflowCounts(pipeType: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["stage-workflow-counts", organizationId, pipeType],
    queryFn: async (): Promise<Record<string, { total: number; active: number }>> => {
      if (!organizationId || !pipeType) return {};

      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, is_active, trigger_config")
        .eq("organization_id", organizationId)
        .eq("trigger_type", "stage_changed");

      if (error) throw error;
      if (!data) return {};

      const counts: Record<string, { total: number; active: number }> = {};

      for (const row of data as unknown as Workflow[]) {
        const cfg = row.trigger_config as TriggerConfigStageChanged;
        if (!cfg || cfg.pipe_type !== pipeType) continue;

        const stages = cfg.stages && cfg.stages.length > 0
          ? cfg.stages
          : cfg.to_stage
          ? [cfg.to_stage]
          : null;

        if (stages) {
          for (const s of stages) {
            if (!counts[s]) counts[s] = { total: 0, active: 0 };
            counts[s].total++;
            if (row.is_active) counts[s].active++;
          }
        }
        // If no specific stages, it applies to ALL stages - we mark as "__all__"
        if (!stages) {
          if (!counts["__all__"]) counts["__all__"] = { total: 0, active: 0 };
          counts["__all__"].total++;
          if (row.is_active) counts["__all__"].active++;
        }
      }

      return counts;
    },
    enabled: isReady && !!organizationId && !!pipeType,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Same as above but for custom pipelines (uses pipeline_id instead of pipe_type).
 */
export function useCustomPipeWorkflowCounts(pipelineId: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["stage-workflow-counts-custom", organizationId, pipelineId],
    queryFn: async (): Promise<Record<string, { total: number; active: number }>> => {
      if (!organizationId || !pipelineId) return {};

      const { data, error } = await supabase
        .from("workflows")
        .select("id, name, is_active, trigger_config")
        .eq("organization_id", organizationId)
        .eq("trigger_type", "stage_changed");

      if (error) throw error;
      if (!data) return {};

      const counts: Record<string, { total: number; active: number }> = {};

      for (const row of data as unknown as Workflow[]) {
        const cfg = row.trigger_config as TriggerConfigStageChanged;
        if (!cfg || cfg.pipeline_id !== pipelineId) continue;

        const stages = cfg.stages && cfg.stages.length > 0
          ? cfg.stages
          : cfg.to_stage
          ? [cfg.to_stage]
          : null;

        if (stages) {
          for (const s of stages) {
            if (!counts[s]) counts[s] = { total: 0, active: 0 };
            counts[s].total++;
            if (row.is_active) counts[s].active++;
          }
        }
        if (!stages) {
          if (!counts["__all__"]) counts["__all__"] = { total: 0, active: 0 };
          counts["__all__"].total++;
          if (row.is_active) counts["__all__"].active++;
        }
      }

      return counts;
    },
    enabled: isReady && !!organizationId && !!pipelineId,
    staleTime: 5 * 60 * 1000,
  });
}
