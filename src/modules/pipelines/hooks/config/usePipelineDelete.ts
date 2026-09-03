import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rpcNaoTipada } from "../../lib/rpc-nao-tipada";

/**
 * Par ÚNICO de deleção de funil por id (SCRUM-626 → consumido pela D3/636).
 *
 * `pipeline_delete_impact` / `delete_pipeline` servem qualquer funil; o shape
 * do impacto varia por ramo (a RPC preserva os dois shapes do baseline):
 *
 *   · ramo SYSTEM → traz `pipe_type`, `regras_dispatch`, `regras_distribuicao`,
 *     `mensagens_agendadas`, `agentes_copilot`;
 *   · ramo CUSTOM → traz `membros`, `negocios_orfaos`, `disparos_em_voo` e
 *     `cards_invasores` (> 0 IMPEDE a exclusão — card de OUTRO funil parado
 *     numa etapa deste; ver racional em `useCustomPipelineDeleteImpact`).
 *
 * Este tipo é a UNIÃO estrutural: campos de um ramo só são opcionais no outro.
 */
export interface PipelineDeleteImpact {
  cards: number;
  leads: number;
  etapas: number;
  eventos_etapa: number;
  vendas_orfas: number;
  automacoes: number;
  // Ramo system
  pipe_type?: string;
  pipeline_id?: string | null;
  regras_dispatch?: number;
  regras_distribuicao?: number;
  mensagens_agendadas?: number;
  agentes_copilot?: number;
  // Ramo custom
  membros?: number;
  negocios_orfaos?: number;
  disparos_em_voo?: number;
  cards_invasores?: number;
}

/** Resultado do delete: impacto medido + o que foi neutralizado junto. */
export interface PipelineDeleteResult extends PipelineDeleteImpact {
  automacoes_desativadas?: number;
  disparos_neutralizados?: number;
  agentes_ajustados?: number;
}

/**
 * Prévia do estrago, para o diálogo de confirmação. Só busca com o diálogo
 * aberto — é contagem cara e ninguém precisa dela antes de decidir.
 */
export function usePipelineDeleteImpact(
  pipelineId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["pipeline_delete_impact", pipelineId],
    queryFn: async (): Promise<PipelineDeleteImpact | null> => {
      if (!pipelineId) return null;
      return rpcNaoTipada<PipelineDeleteImpact>("pipeline_delete_impact", {
        p_pipeline_id: pipelineId,
      });
    },
    enabled: enabled && !!pipelineId,
    staleTime: 0,
  });
}

/**
 * HARD DELETE de um funil (qualquer espécie) por id.
 *
 * 🚨 Irreversível nos DADOS (cards, histórico de etapas, eventos de venda).
 * A estrutura de um funil de sistema pode renascer via `enable_system_pipeline`;
 * um custom, recriado vazio. Guardas server-side: cards invasores (custom) e
 * funil padrão da org (trigger da 20270908004000 — a UI resolve o substituto
 * ANTES de chegar aqui; o trigger é o cinto de segurança).
 */
export function useDeletePipelineById() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pipelineId: string) => {
      return rpcNaoTipada<PipelineDeleteResult>("delete_pipeline", {
        p_pipeline_id: pipelineId,
      });
    },
    onSuccess: () => {
      // Superset das invalidações dos dois fluxos antigos
      // (`useDeleteSystemPipeline` + `useDeleteCustomPipeline`): o funil sai
      // da navegação, dos seletores, das listas e dos boards — e o default da
      // org pode ter mudado no mesmo fluxo (substituto).
      for (const key of [
        "pipeline-display-config",
        "pipeline_id",
        "pipelines",
        "pipeline_stages",
        "pipeline_entries",
        "leads",
        "workflows",
        "custom_pipelines",
        "custom_pipeline",
        "custom_pipeline_stages",
        "custom_pipe_entries",
        "custom_pipe_stage_counts",
        "lead-pipes",
        "lead_all_pipelines",
        "leads-deals",
        "blast_plans",
        "funil-stages",
        "organization-settings",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
