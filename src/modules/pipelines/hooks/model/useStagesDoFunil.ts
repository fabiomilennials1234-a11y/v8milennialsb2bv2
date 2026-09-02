import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import type { StageRole } from "@/contracts/pipe";

/**
 * Etapa de QUALQUER funil, resolvida por `pipeline_id` (SCRUM-633).
 *
 * Pós SCRUM-616 (`20270906001000_etapas_ganham_fk_ao_funil.sql`),
 * `pipeline_stages` é a tabela ÚNICA de etapas — as 531 custom migraram
 * preservando o uuid e a FK `pipeline_id` cobre as de sistema. Este shape é o
 * mínimo que os consumidores unificados precisam:
 *
 *   - `id`        → alvo canônico de escrita (`bulk_add_to_pipeline.p_stage_id`)
 *   - `stage_key` → chave das RPCs de leitura (`get_pipeline_page.p_stage_id`,
 *                   contagens por `stage_key`)
 *   - `stage_role`→ semântica won/lost/open (métricas de conversão)
 */
export interface StageDoFunil {
  id: string;
  stage_key: string;
  name: string;
  color: string | null;
  position: number;
  stage_role: StageRole;
  is_final_positive: boolean;
  is_final_negative: boolean;
}

/**
 * Lista as etapas ATIVAS de um funil (sistema OU custom) por `pipeline_id`,
 * direto de `pipeline_stages` — sem descobrir tipo, sem escolher hook por
 * família, sem traduzir chave (as três decisões que `useEtapasDoFunil`
 * documenta; aqui elas nem existem, e o `id` da etapa vem junto — é ele que
 * o bulk unificado escreve).
 *
 * Etapas de sistema com `pipeline_id` NULL (resíduo AUTOTEK medido na
 * 20270906001000 — 37 linhas de funil já deletado) ficam de fora por
 * construção: o predicado é a própria FK.
 */
export function useStagesDoFunil(pipelineId: string | null | undefined) {
  const { organizationId } = useOrganization();

  useRealtimeSubscription("pipeline_stages", ["stages_do_funil"]);

  return useQuery({
    queryKey: ["stages_do_funil", pipelineId, organizationId],
    queryFn: async (): Promise<StageDoFunil[]> => {
      if (!organizationId || !pipelineId) return [];

      const { data, error } = await supabase
        .from("pipeline_stages")
        .select(
          "id, stage_key, name, color, position, stage_role, is_final_positive, is_final_negative",
        )
        .eq("organization_id", organizationId)
        .eq("pipeline_id", pipelineId)
        .eq("is_active", true)
        .order("position", { ascending: true });

      if (error) throw error;
      return (data ?? []).map((s) => ({
        id: s.id,
        stage_key: s.stage_key,
        name: s.name ?? s.stage_key,
        color: s.color,
        position: s.position ?? 0,
        stage_role: (s.stage_role ?? "open") as StageRole,
        is_final_positive: s.is_final_positive ?? false,
        is_final_negative: s.is_final_negative ?? false,
      }));
    },
    enabled: !!organizationId && !!pipelineId,
    staleTime: 2 * 60_000,
  });
}
