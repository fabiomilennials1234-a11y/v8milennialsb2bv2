import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/modules/identity";
import { rpcNaoTipada } from "@/modules/pipelines/lib/rpc-nao-tipada";
import { FOCO_SEGMENTO, type FocoDoNegocio } from "@/modules/pipelines/lib/foco-no-funil";
import { flattenRpcEntry, type FunilFilterParams } from "./usePaginatedFunil";

/** `RETURNS TABLE` de `localizar_negocio_no_funil` (20280104000500). */
interface LinhaDoFoco extends Record<string, unknown> {
  id: string;
  pipeline_id: string;
  lead_id: string | null;
  stage_key: string;
  lead?: unknown;
  visivel_no_recorte: boolean;
}

/** O pedido "Ir para o negócio" que a página consumiu da URL. */
export interface PedidoDeFoco {
  entryId: string;
  /** Identidade do pedido: cada viagem lê o banco de novo, nunca do cache. */
  nonce: number;
}

/**
 * O negócio que o "Ir para o negócio" veio buscar, lido do banco com o MESMO
 * recorte do board (`filterParams`) — a coluna e o foco nunca discordam.
 *
 * A chave mora sob o prefixo das colunas
 * (`["pipeline-page", pipelineId, FOCO_SEGMENTO, …]`): toda invalidação que o
 * board já recebe (lead editado, etiqueta, desfecho no painel, exclusão) relê
 * a linha focada, sem acoplar ninguém a esta tela. Os leitores do cache por
 * prefixo (`optimisticMovePipelineEntry`, `colunaDoCardNoCache`) reconhecem o
 * formato (`ehFocoDoNegocio`). O custo é uma página de 1 na RPC — por
 * navegação e por evento do PRÓPRIO card, nunca por evento qualquer.
 *
 * `pronto`: só busca com o recorte assentado (a visão "Meus · Todos" salva já
 * lida) — senão a 1ª resposta viria com o recorte errado.
 *
 * `null` = a pessoa não vê o negócio (RLS: "só os meus", funil oculto) ou ele
 * não existe mais.
 */
export function useFocoNoNegocio(
  pipelineId: string | undefined,
  pedido: PedidoDeFoco | null,
  filterParams: FunilFilterParams,
  { pronto = true }: { pronto?: boolean } = {},
) {
  const { organizationId, isReady } = useOrganization();
  const filtersKey = useMemo(() => JSON.stringify(filterParams), [filterParams]);
  const entryId = pedido?.entryId ?? null;

  return useQuery({
    queryKey: ["pipeline-page", pipelineId, FOCO_SEGMENTO, organizationId, filtersKey, entryId, pedido?.nonce ?? null],
    queryFn: async (): Promise<FocoDoNegocio | null> => {
      const linhas = await rpcNaoTipada<LinhaDoFoco[] | null>("localizar_negocio_no_funil", {
        ...filterParams,
        p_entry_id: entryId,
      });
      const achada = linhas?.[0];
      if (!achada) return null;
      const { visivel_no_recorte: visivel, ...linha } = achada;
      return {
        entryId: achada.id,
        pipelineId: achada.pipeline_id,
        stageKey: achada.stage_key,
        leadId: achada.lead_id,
        visivel,
        linha: visivel ? (flattenRpcEntry(linha) as FocoDoNegocio["linha"]) : null,
      };
    },
    enabled: pronto && isReady && !!organizationId && !!pipelineId && !!entryId,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnMount: "always",
    // Função ausente (PGRST202) e outra org (P0001) não melhoram tentando de novo.
    retry: false,
    // Trocar de filtro no MESMO pedido relê o foco sem o card piscar. Outro
    // negócio, outro funil ou outra viagem nunca herdam a resposta anterior.
    placeholderData: (anterior, consulta) =>
      consulta?.queryKey[1] === pipelineId && consulta?.queryKey[5] === entryId && consulta?.queryKey[6] === pedido?.nonce
        ? anterior
        : undefined,
  });
}
