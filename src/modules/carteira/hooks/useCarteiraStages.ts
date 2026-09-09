import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import type { CarteiraStageFamily, PipelineStage } from "@/contracts/pipe";

// Reexporta o tipo para os call sites do módulo (Upsell.tsx, kanbans, import).
export type { CarteiraStageFamily };

/**
 * Etapas da Carteira — caminho DEDICADO, fora do vocabulário de funil.
 *
 * SCRUM-618 (D9/ADR-0034): `upsell_base`/`upsell_gestao` saíram de
 * `PipelineType` — Carteira não é funil (aposentada em 20270805000010). As
 * linhas delas continuam existindo em `pipeline_stages` (todas inativas,
 * `pipeline_id` NULL) e este hook as lê por `pipeline_type` direto, tipado
 * por `CarteiraStageFamily`, sem passar por `usePipelineStages`.
 *
 * Comportamento preservado 1:1 do que `usePipelineStages` fazia para estas
 * famílias (elas nunca passaram pelo portão de `pipeline_display_config` nem
 * pela semeadura):
 *   · consulta só etapas ATIVAS — em prod são zero (todas aposentadas), então
 *     o board de `/upsell` renderiza pelo fallback em memória abaixo;
 *   · fallback é RENDER-ONLY: nunca é escrito no banco. É ele que segura
 *     `/upsell` de pé até a rota ser terminada ou enterrada (ADR-0005);
 *   · queryKey `["pipeline_stages", família, org]` idêntica à antiga — as
 *     invalidations de `useUpdatePipelineStage` (UpsellStageRulesTab) seguem
 *     acertando este cache.
 *
 * Faxina final (linhas inativas no banco + este resíduo) é a W6.
 */

interface CarteiraDefaultStage {
  id: string;
  title: string;
  color: string;
}

/** Fallback de exibição — movido de `DEFAULT_STAGES.upsell_*` (contracts). */
export const CARTEIRA_DEFAULT_STAGES: Record<CarteiraStageFamily, CarteiraDefaultStage[]> = {
  upsell_base: [
    { id: "0-3m", title: "0-3 meses", color: "#3B82F6" },
    { id: "3-6m", title: "3-6 meses", color: "#22C55E" },
    { id: "6-9m", title: "6-9 meses", color: "#F59E0B" },
    { id: "9-12m", title: "9-12 meses", color: "#EF4444" },
    { id: "12-18m", title: "12-18 meses", color: "#8B5CF6" },
    { id: "18m+", title: "18+ meses", color: "#EC4899" },
  ],
  upsell_gestao: [
    { id: "campeoes", title: "Campeões", color: "#22C55E" },
    { id: "fieis", title: "Fiéis", color: "#3B82F6" },
    { id: "primeira_compra", title: "Primeira Compra", color: "#8B5CF6" },
    { id: "em_risco", title: "Em Risco", color: "#F59E0B" },
    { id: "inativos", title: "Inativos", color: "#EF4444" },
  ],
};

/**
 * Fabrica as etapas sintéticas satisfazendo `PipelineStage` — mesmo shape do
 * `buildFallbackStages` que atendia estas famílias antes (timestamp de epoch
 * sinaliza "não veio do banco").
 */
function buildFallbackCarteiraStages(
  family: CarteiraStageFamily,
  organizationId: string | null,
): PipelineStage[] {
  const syntheticTimestamp = new Date(0).toISOString();
  return CARTEIRA_DEFAULT_STAGES[family].map((stage, index): PipelineStage => ({
    id: stage.id,
    organization_id: organizationId ?? "",
    pipeline_type: family,
    // Etapa sintética: não pertence a nenhum funil persistido.
    pipeline_id: null,
    stage_key: stage.id,
    name: stage.title,
    color: stage.color,
    position: index,
    is_active: true,
    is_final_positive: false,
    is_final_negative: false,
    stage_role: "open",
    suggested_stage_role: null,
    stage_role_suggested_at: null,
    stage_role_suggestion_source: null,
    stage_role_reviewed_at: null,
    stage_role_reviewed_by: null,
    auto_move_min_days: null,
    auto_move_max_days: null,
    target_pipe_type: null,
    target_stage_key: null,
    target_pipeline_id: null,
    target_stage_id: null,
    checklist_template_id: null,
    created_at: syntheticTimestamp,
    updated_at: syntheticTimestamp,
  }));
}

/** Etapas de uma família da Carteira (com fallback de exibição). */
export function useCarteiraStages(family: CarteiraStageFamily) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  useRealtimeSubscription("pipeline_stages", ["pipeline_stages", family]);

  return useQuery({
    queryKey: ["pipeline_stages", family, organizationId],
    queryFn: async (): Promise<PipelineStage[]> => {
      if (!organizationId) {
        return buildFallbackCarteiraStages(family, null);
      }

      const fallbackStages = buildFallbackCarteiraStages(family, organizationId);

      try {
        const { data, error } = await supabase
          .from("pipeline_stages")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("pipeline_type", family)
          .eq("is_active", true)
          .order("position", { ascending: true });

        if (error) {
          console.warn("Carteira stages not available, using defaults:", error.message);
          return fallbackStages;
        }

        // Vazio → fallback (é o caso de TODA org em prod: as etapas de
        // carteira estão aposentadas/inativas; o board vive do fallback).
        if (!data || data.length === 0) {
          return fallbackStages;
        }

        return data as PipelineStage[];
      } catch (err) {
        console.warn("Error fetching carteira stages, using defaults:", err);
        return fallbackStages;
      }
    },
    enabled: true,
  });
}
