import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { ClosedMonthSummary } from "@/modules/pipelines/lib/closed-outcome-groups";

/**
 * Resumo dos negócios ENCERRADOS de cada etapa de um funil, por desfecho e mês
 * (`get_funil_desfecho_por_mes`, migration 20271210000000) — os números da
 * pilha de Ganhos/Perdidos da coluna.
 *
 * Por que existe (Chamado 172ef046): a pilha somava só os 20 cards que a
 * coluna carregou. "Setembro: 8" quando a etapa tinha 69. Os cards continuam
 * vindo da paginação; quantos e quanto vêm daqui, da etapa inteira.
 *
 * O mês é calculado no banco no fuso do NAVEGADOR (`p_tz`) — o mesmo que
 * `closed-outcome-groups` usa para pôr cada card no mês — senão um ganho às 22h
 * de 31/08 em Brasília contaria em setembro no resumo e em agosto no card.
 *
 * Falha (RPC ausente antes da migration, rede, fuso que o banco não conhece) =
 * sem resumo: `porEtapa` é `null` e a pilha volta ao modo parcial. Nunca
 * derruba o board.
 */

export const DESFECHO_POR_MES_KEY = "pipeline-desfecho-por-mes";

/** Por `stage_key`: as linhas (desfecho, mês) daquela etapa. */
export type DesfechoPorMesPorEtapa = Record<string, ClosedMonthSummary[]>;

/**
 * O PostgREST corta resposta de RPC em 1.000 linhas (db-max-rows) sem avisar.
 * Resposta no teto pode estar truncada: um número a menos seria pior que o
 * modo parcial, que pelo menos se declara parcial. (Em prod, 20/10/2026, o
 * maior funil tem 22 linhas.)
 */
const POSTGREST_MAX_ROWS = 1000;

const FUSO_PADRAO = "America/Sao_Paulo";

function fusoDoNavegador(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FUSO_PADRAO;
  } catch {
    return FUSO_PADRAO;
  }
}

interface RpcRow {
  stage_key: string | null;
  outcome: string | null;
  month_key: string | null;
  cnt: number | string | null;
  total: number | string | null;
}

function toFiniteOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchDesfechoPorMes(args: {
  pipelineId: string;
  orgId: string;
  tz: string;
}): Promise<DesfechoPorMesPorEtapa | null> {
  // `as never`: RPC mais nova que o types.ts gerado de prod; morre no regen.
  const { data, error } = await supabase.rpc(
    "get_funil_desfecho_por_mes" as never,
    { p_pipeline_id: args.pipelineId, p_org_id: args.orgId, p_tz: args.tz } as never,
  );
  if (error) throw error;

  const rows = (data ?? []) as RpcRow[];
  if (rows.length >= POSTGREST_MAX_ROWS) return null;

  const porEtapa: DesfechoPorMesPorEtapa = {};
  for (const row of rows) {
    if (!row.stage_key || !row.month_key) continue;
    if (row.outcome !== "won" && row.outcome !== "lost") continue;
    const count = toFiniteOrNull(row.cnt);
    if (count === null || count <= 0) continue;
    (porEtapa[row.stage_key] ??= []).push({
      outcome: row.outcome,
      monthKey: row.month_key,
      count,
      total: toFiniteOrNull(row.total),
    });
  }
  return porEtapa;
}

export function useFunilDesfechoPorMes(
  pipelineId: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { organizationId, isReady } = useOrganization();
  const tz = fusoDoNavegador();
  const ativo = enabled && isReady && !!organizationId && !!pipelineId;

  const query = useQuery({
    queryKey: [DESFECHO_POR_MES_KEY, pipelineId, organizationId, tz] as const,
    queryFn: () => fetchDesfechoPorMes({ pipelineId: pipelineId!, orgId: organizationId!, tz }),
    enabled: ativo,
    staleTime: 30_000,
    // O resumo é um extra: falhou, a pilha mostra o carregado e se declara
    // parcial. Repetir só multiplicaria o 404 enquanto a migration não sobe.
    retry: false,
  });

  return {
    // Desligado (ex.: filtro ativo no board) NÃO devolve o que ficou no cache:
    // o resumo é da etapa sem recorte, e a coluna filtrada é outra conta.
    porEtapa: ativo && !query.isError ? (query.data ?? null) : null,
    isLoading: ativo && query.isLoading,
    isError: query.isError,
  };
}
