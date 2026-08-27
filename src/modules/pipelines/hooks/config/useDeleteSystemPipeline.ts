import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "@/modules/identity";
import { rpcNaoTipada } from "../../lib/rpc-nao-tipada";
import type { SystemPipeType } from "./usePipelineDisplayConfig";

/**
 * O que a exclusão de um funil de sistema vai destruir.
 *
 * Espelha `useCustomPipelineDeleteImpact`: só conta quando o diálogo abre — o
 * usuário precisa ver o número ANTES de confirmar, e antes disso a contagem é
 * peso morto.
 */
export interface SystemPipelineDeleteImpact {
  pipe_type: SystemPipeType;
  pipeline_id: string | null;
  cards: number;
  leads: number;
  etapas: number;
  eventos_etapa: number;
  vendas_orfas: number;
  automacoes: number;
  regras_dispatch: number;
  regras_distribuicao: number;
  mensagens_agendadas: number;
  agentes_copilot: number;
}

export function useSystemPipelineDeleteImpact(
  pipeType: SystemPipeType | null,
  enabled: boolean,
) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["system_pipeline_delete_impact", organizationId, pipeType],
    queryFn: async (): Promise<SystemPipelineDeleteImpact | null> => {
      if (!organizationId || !pipeType) return null;
      return rpcNaoTipada<SystemPipelineDeleteImpact>("system_pipeline_delete_impact", {
        p_org_id: organizationId,
        p_pipe_type: pipeType,
      });
    },
    enabled: enabled && !!organizationId && !!pipeType,
    staleTime: 0,
  });
}

/**
 * HARD DELETE de um funil de sistema na org.
 *
 * 🚨 Irreversível nos DADOS. `enable_system_pipeline` reconstrói a estrutura
 * (registro, espelho, etapas padrão), mas os cards, o histórico de etapas e os
 * eventos de venda não voltam — não há backup lógico (ADR-0017).
 */
export function useDeleteSystemPipeline() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (pipeType: SystemPipeType) => {
      if (!organizationId) throw new Error("Organização não resolvida");
      return rpcNaoTipada<
        SystemPipelineDeleteImpact & {
          automacoes_desativadas: number;
          disparos_neutralizados: number;
          agentes_ajustados: number;
        }
      >("delete_system_pipeline", {
        p_org_id: organizationId,
        p_pipe_type: pipeType,
      });
    },
    onSuccess: () => {
      // O funil sai da navegação, dos seletores e da lista — tudo que o lê
      // precisa reconsultar. `leads` entra porque a exclusão do funil WhatsApp
      // zera `leads.pipe_whatsapp` em toda a org.
      for (const key of [
        "pipeline-display-config",
        "pipeline_id",
        "pipelines",
        "pipeline_stages",
        "pipeline_entries",
        "leads",
        "workflows",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
