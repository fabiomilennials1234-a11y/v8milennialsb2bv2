/**
 * useInboxFunnelOptions — opções de Funil + Etapa para o filtro do inbox.
 *
 * Funil: todos os pipelines ativos da org (sistema + custom), unificados por
 * pipeline_id. Rótulo do sistema vem de `usePipelineDisplayConfig` (customizável
 * por org — NUNCA hardcodar); custom usa o próprio nome. Respeita visibilidade e
 * ordem da config.
 *
 * Etapa: as etapas de cada funil (stage_key + rótulo), para o filtro de Etapa
 * poder depender do Funil escolhido. Rótulo com fallback pro stage_key cru se a
 * config de etapa não for encontrada (read-only — nunca quebra).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePipelines } from "@/modules/pipelines";
import { usePipelineDisplayConfig } from "@/modules/pipelines";
import { useAllPipelineStages } from "@/modules/pipelines";
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

/** slug do pipe de sistema → pipeline_type usado em pipeline_stages. */
const SLUG_TO_STAGE_TYPE: Record<string, string> = {
  whatsapp: "whatsapp",
  confirmacao: "confirmacao",
  propostas: "propostas",
  upsell: "upsell_base",
};

export function useInboxFunnelOptions(): FunnelOption[] {
  const { organizationId } = useOrganization();
  const { data: pipelines = [] } = usePipelines();
  const { data: displayConfig = [] } = usePipelineDisplayConfig();
  const { data: systemStages = [] } = useAllPipelineStages();

  // Etapas de pipelines custom (por pipeline_id).
  const { data: customStages = [] } = useQuery({
    queryKey: ["custom-pipeline-stages-inbox", organizationId],
    queryFn: async () => {
      if (!organizationId) return [] as { pipeline_id: string; stage_key: string; name: string; position: number }[];
      const { data, error } = await supabase
        .from("custom_pipeline_stages")
        .select("pipeline_id, stage_key, name, position")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { pipeline_id: string; stage_key: string; name: string; position: number }[];
    },
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });

  return useMemo(() => {
    // Config de sistema por pipe_type: rótulo + visibilidade.
    const cfgByType = new Map(displayConfig.map((c) => [c.pipe_type, c]));

    // Etapas de sistema agrupadas por pipeline_type.
    const sysStagesByType = new Map<string, FunnelStageOption[]>();
    for (const s of systemStages) {
      const type = (s as { pipeline_type: string }).pipeline_type;
      const arr = sysStagesByType.get(type) ?? [];
      arr.push({ stageKey: (s as { stage_key: string }).stage_key, label: (s as { name: string }).name });
      sysStagesByType.set(type, arr);
    }

    // Etapas custom agrupadas por pipeline_id.
    const customStagesByPipeline = new Map<string, FunnelStageOption[]>();
    for (const s of customStages) {
      const arr = customStagesByPipeline.get(s.pipeline_id) ?? [];
      arr.push({ stageKey: s.stage_key, label: s.name });
      customStagesByPipeline.set(s.pipeline_id, arr);
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
        const stageType = SLUG_TO_STAGE_TYPE[p.slug] ?? p.slug;
        options.push({
          pipelineId: p.id,
          label,
          stages: sysStagesByType.get(stageType) ?? [],
          order: cfg?.position ?? p.display_order,
        });
      } else {
        options.push({
          pipelineId: p.id,
          label: p.name,
          stages: customStagesByPipeline.get(p.id) ?? [],
          order: 1000 + p.display_order, // custom sempre depois dos de sistema
        });
      }
    }
    return options
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...rest }) => rest);
  }, [pipelines, displayConfig, systemStages, customStages]);
}
