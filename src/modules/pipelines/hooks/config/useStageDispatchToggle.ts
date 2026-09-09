import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Toggle "Mensagens automáticas por etapa" de um funil (SCRUM-629/W3, D11).
 *
 * O front escreve SÓ o boolean em `pipelines.stage_dispatch_enabled`; o
 * carimbo temporal (`stage_dispatch_enabled_at`) e o cancelamento da fila ao
 * desligar são do servidor (trigger `trg_pipelines_stage_dispatch_toggle`) —
 * o corte "nunca retroativo" não confia no relógio do cliente.
 *
 * As colunas ainda não estão no types.ts gerado (migration 20270908008000);
 * casts pontuais até o regen pós-apply.
 */

export interface StageDispatchState {
  enabled: boolean;
  enabledAt: string | null;
}

export function useStageDispatchEnabled(pipelineId: string | null | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["pipeline_stage_dispatch", organizationId, pipelineId],
    queryFn: async (): Promise<StageDispatchState> => {
      const { data, error } = await (supabase as any)
        .from("pipelines")
        .select("stage_dispatch_enabled, stage_dispatch_enabled_at")
        .eq("id", pipelineId)
        .maybeSingle();
      if (error) throw error;
      return {
        enabled: Boolean(data?.stage_dispatch_enabled),
        enabledAt: (data?.stage_dispatch_enabled_at as string | null) ?? null,
      };
    },
    enabled: isReady && !!organizationId && !!pipelineId,
  });
}

export function useSetStageDispatchEnabled() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ pipelineId, enabled }: { pipelineId: string; enabled: boolean }) => {
      const { error } = await (supabase as any)
        .from("pipelines")
        .update({ stage_dispatch_enabled: enabled })
        .eq("id", pipelineId);
      if (error) throw error;
      return { pipelineId, enabled };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline_stage_dispatch", organizationId, variables.pipelineId] });
      // Desligar cancela a fila pendente no servidor — métricas e fila mudam.
      queryClient.invalidateQueries({ queryKey: ["pipe_dispatch_metrics"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_queue_items"] });
    },
  });
}
