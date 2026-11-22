import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { pipelinePageKey } from "@/modules/pipelines/lib/pipeline-page-key";
import {
  agregarContagensPorEtapa,
  stageCountsQueryKey,
  type StageCountRow,
} from "@/modules/pipelines/lib/stage-counts-query";

/**
 * O quadro inteiro de `/funil/:slug` numa ida: `get_pipeline_board`
 * (migration 20280123000000) devolve a 1ª página de cada coluna — no shape
 * EXATO de `get_pipeline_page` — e as contagens — no shape EXATO de
 * `get_pipeline_stage_counts_by_id`.
 *
 * Antes: 1 `get_pipeline_page` POR ETAPA em paralelo (até 40) + contagens; cada
 * statement pagava ~35 ms fixos de InitPlans de RLS e a rajada inflava a média
 * para 329 ms (prod, 21/11/2026).
 *
 * O quadro NÃO tem cache próprio para a tela ler: ele SEMEIA as chaves que já
 * existem — `pipelinePageKey` por coluna (`{pages:[linhas], pageParams:[null]}`,
 * o mesmo dado que a 1ª página do `useInfiniteQuery` gravaria) e
 * `stageCountsQueryKey`. Move otimista, Realtime cirúrgico, "Carregar mais" e
 * invalidação por prefixo continuam endereçando as colunas como sempre.
 *
 * ORDEM DE DEPLOY: front pode subir antes da migration. Função ausente
 * (`PGRST202`) devolve `null` e a tela cai nas N páginas de sempre. Qualquer
 * outro erro também devolve `null` — o quadro é atalho, não fonte: a coluna
 * busca sozinha e mostra o PRÓPRIO erro, nunca uma tela vazia por causa dele.
 */

export const PIPELINE_BOARD = "pipeline-board";

/** Chave do atalho (só controla a ida; a tela lê as chaves das colunas). */
export function pipelineBoardKey(
  pipelineId: string | null | undefined,
  organizationId: string | null | undefined,
  filtersKey: string,
  stageKeys: readonly string[],
) {
  return [PIPELINE_BOARD, pipelineId, organizationId, filtersKey, stageKeys.join("\u0000")] as const;
}

type LinhaDaRpc = Record<string, unknown> & { lead?: unknown };

export interface QuadroDoFunil {
  /** Linhas cruas por `stage_key`, na ordem da coluna (created_at DESC, id DESC). */
  colunas: Record<string, LinhaDaRpc[]>;
  /** Linhas cruas de contagem (stage_id, stage_key, cnt). */
  contagens: StageCountRow[];
}

function ehQuadro(data: unknown): data is { counts: StageCountRow[]; columns: Record<string, LinhaDaRpc[]> } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const d = data as { counts?: unknown; columns?: unknown };
  return (
    Array.isArray(d.counts) &&
    !!d.columns &&
    typeof d.columns === "object" &&
    !Array.isArray(d.columns) &&
    Object.values(d.columns as Record<string, unknown>).every(Array.isArray)
  );
}

type ChamadaRpc = (
  nome: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

/**
 * Busca o quadro. `null` = use o caminho por coluna (RPC ausente, erro ou
 * resposta fora do contrato) — ver o cabeçalho.
 *
 * `filterParams` é o MESMO objeto que vai a `get_pipeline_page`
 * (`sharedRpcFilterParams`), sem cursor: os nomes de parâmetro são os mesmos.
 */
export async function fetchPipelineBoard(args: {
  pipelineId: string;
  stageKeys: readonly string[];
  filterParams: Record<string, unknown>;
  pageSize: number;
}): Promise<QuadroDoFunil | null> {
  // `.call(supabase, …)`: `rpc` lê `this.rest`; método solto perde o receptor.
  const chamar = supabase.rpc as unknown as ChamadaRpc;
  const { data, error } = await chamar.call(supabase, "get_pipeline_board", {
    ...args.filterParams,
    p_pipeline_id: args.pipelineId,
    p_stage_keys: [...args.stageKeys],
    p_page_size: args.pageSize,
  });
  if (error) {
    if (error.code !== "PGRST202") {
      console.warn("[funil] get_pipeline_board falhou; colunas buscam sozinhas", error);
    }
    return null;
  }
  if (!ehQuadro(data)) return null;
  return { colunas: data.columns, contagens: data.counts };
}

/**
 * Semeia as chaves das colunas e da contagem com o que o quadro trouxe.
 *
 * Não pisa em coluna mais nova que o quadro: se a coluna já tem mais de uma
 * página (o usuário rolou) ou foi atualizada DEPOIS que a ida do quadro saiu
 * (Realtime, move), ela fica como está — a coluna se mantém sozinha.
 */
export function semearQuadroNoCache(
  queryClient: QueryClient,
  args: {
    pipelineId: string;
    organizationId: string;
    filtersKey: string;
    stageKeys: readonly string[];
    countsArgs: Record<string, unknown>;
    quadro: QuadroDoFunil;
    /** `Date.now()` de quando a ida saiu. */
    pedidoEm: number;
    /** Mesmo mapeamento de `buscarPaginaDoFunil` (linha da RPC → card). */
    paraCard: (linha: LinhaDaRpc) => unknown;
  },
): void {
  const { pipelineId, organizationId, filtersKey, quadro, pedidoEm } = args;
  for (const stageKey of args.stageKeys) {
    const linhas = quadro.colunas[stageKey];
    if (!linhas) continue;
    const key = pipelinePageKey(pipelineId, stageKey, organizationId, filtersKey);
    const estado = queryClient.getQueryState(key);
    const atual = queryClient.getQueryData<{ pages: unknown[] }>(key);
    if (atual && (atual.pages.length > 1 || (estado?.dataUpdatedAt ?? 0) > pedidoEm)) continue;
    queryClient.setQueryData(key, { pages: [linhas.map(args.paraCard)], pageParams: [null] });
  }
  const contagemKey = stageCountsQueryKey(pipelineId, args.countsArgs);
  if ((queryClient.getQueryState(contagemKey)?.dataUpdatedAt ?? 0) <= pedidoEm) {
    queryClient.setQueryData(contagemKey, agregarContagensPorEtapa(quadro.contagens));
  }
}
