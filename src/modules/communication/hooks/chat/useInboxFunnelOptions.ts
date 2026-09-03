/**
 * useInboxFunnelOptions — opções de Funil + Etapa para o filtro do inbox.
 *
 * Funil: todos os pipelines ativos da org (sistema + custom), unificados por
 * pipeline_id. Rótulo do sistema vem de `usePipelineDisplayConfig` (customizável
 * por org — NUNCA hardcodar); custom usa o próprio nome. Respeita visibilidade e
 * ordem da config.
 *
 * Etapa: as etapas de cada funil (stage_key + rótulo), para o filtro de Etapa
 * poder depender do Funil escolhido. Pós-F1 (SCRUM-616) TODA etapa vive em
 * `pipeline_stages` com FK `pipeline_id` — uma query serve as duas famílias.
 * Morreram o mapa slug→pipeline_type e a leitura da view de compat
 * `custom_pipeline_stages` (SCRUM-637).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePipelines } from "@/modules/pipelines";
import { usePipelineDisplayConfig } from "@/modules/pipelines";
import { useOrganization } from "@/modules/identity";

export interface FunnelStageOption {
  stageKey: string;
  label: string;
}
export interface FunnelOption {
  pipelineId: string;
  label: string;
  stages: FunnelStageOption[];
}

export function useInboxFunnelOptions(): FunnelOption[] {
  const { organizationId } = useOrganization();
  const { data: pipelines = [] } = usePipelines();
  const { data: displayConfig = [] } = usePipelineDisplayConfig();

  // Etapas de QUALQUER funil, pela FK real (fonte única `pipeline_stages`).
  const { data: stages = [] } = useQuery({
    queryKey: ["pipeline-stages-inbox", organizationId],
    queryFn: async () => {
      if (!organizationId)
        return [] as { pipeline_id: string | null; stage_key: string; name: string; position: number }[];
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("pipeline_id, stage_key, name, position")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .not("pipeline_id", "is", null)
        .order("position", { ascending: true });
      if (error) throw error;
      // `pipeline_id` ainda não está no types.ts gerado (regen fica pra SCRUM-639).
      return (data ?? []) as unknown as { pipeline_id: string | null; stage_key: string; name: string; position: number }[];
    },
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });

  return useMemo(() => {
    // Config de sistema por pipe_type: rótulo + visibilidade.
    const cfgByType = new Map(displayConfig.map((c) => [c.pipe_type, c]));

    // Etapas agrupadas por pipeline_id — mesma chave pras duas famílias.
    const stagesByPipeline = new Map<string, FunnelStageOption[]>();
    for (const s of stages) {
      if (!s.pipeline_id) continue;
      const arr = stagesByPipeline.get(s.pipeline_id) ?? [];
      arr.push({ stageKey: s.stage_key, label: s.name });
      stagesByPipeline.set(s.pipeline_id, arr);
    }

    // order: funis de sistema seguem a `position` do display config (a mesma
    // ordem que a org customiza no kanban); custom vêm depois, pelo display_order
    // do pipeline. `pipelines` já vem ordenado por display_order de usePipelines.
    const options: (FunnelOption & { order: number })[] = [];
    for (const p of pipelines) {
      if (!p.is_active) continue;

      if (p.type === "system") {
        const cfg = cfgByType.get(p.slug as (typeof displayConfig)[number]["pipe_type"]);
        if (cfg && cfg.is_visible === false) continue; // escondido pela org
        const label = cfg?.display_name ?? p.name;
        options.push({
          pipelineId: p.id,
          label,
          stages: stagesByPipeline.get(p.id) ?? [],
          order: cfg?.position ?? p.display_order,
        });
      } else {
        options.push({
          pipelineId: p.id,
          label: p.name,
          stages: stagesByPipeline.get(p.id) ?? [],
          order: 1000 + p.display_order, // custom sempre depois dos de sistema
        });
      }
    }
    return options
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...rest }) => rest);
  }, [pipelines, displayConfig, stages]);
}
