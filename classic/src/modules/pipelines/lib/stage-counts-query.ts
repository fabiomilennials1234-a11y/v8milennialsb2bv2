import { supabase } from "@/integrations/supabase/client";

/**
 * Contagem por etapa de UM funil (`get_pipeline_stage_counts_by_id`) — chave e
 * busca compartilhadas pelo board (`usePaginatedFunil`) e pelo cabeçalho
 * (`useFunilMetrics`).
 *
 * Por que compartilhar: no mount do `/funil` as duas telas pediam a MESMA
 * contagem com objetos de argumento diferentes — o board manda o bloco inteiro
 * de filtros com nulos, o cabeçalho manda só período + chaves de desfecho — e a
 * RPC rodava duas vezes (CP-v2: 2 chamadas no mesmo segundo). A chave agora é
 * o recorte CANÔNICO: sem nulos, sem listas vazias, e sem
 * `p_closed_status_keys` quando não há período (no SQL ele só escolhe a âncora
 * da data do período — `20270908003000_rpcs_fundidas_por_pipeline_id.sql`,
 * linhas 160-161; sem período é inerte). Mesmo recorte ⇒ mesma chave ⇒ uma
 * ida só. Recortes diferentes continuam em chaves diferentes.
 *
 * O payload enviado NÃO é o canônico: vai o objeto do chamador, intacto. O
 * PostgREST resolve a função por nome + argumentos, e omitir parâmetro muda a
 * resolução (ver `sharedRpcFilterParams`, p_stalled_*).
 */

export type StageCountsArgs = Record<string, unknown> & { p_pipeline_id: string; p_org_id: string };

function vazio(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

export function recorteCanonicoDeContagem(args: Record<string, unknown>): Record<string, unknown> {
  const temPeriodo = !vazio(args.p_period_after) || !vazio(args.p_period_before);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(args).sort()) {
    const v = args[k];
    if (vazio(v)) continue;
    if (k === "p_closed_status_keys" && !temPeriodo) continue;
    out[k] = Array.isArray(v) ? [...v].sort() : v;
  }
  return out;
}

export function stageCountsQueryKey(pipelineId: string | null | undefined, args: Record<string, unknown>) {
  return [
    "pipeline-stage-counts",
    pipelineId,
    args.p_org_id ?? null,
    JSON.stringify(recorteCanonicoDeContagem(args)),
  ] as const;
}

/** Busca e agrega por `stage_key` (linha fantasma soma na key que carrega). */
export async function fetchStageCounts(args: StageCountsArgs): Promise<Record<string, number>> {
  // `as never`: RPC mais nova que o types.ts gerado de prod; morre no regen.
  const { data, error } = await supabase.rpc(
    "get_pipeline_stage_counts_by_id" as never,
    args as never,
  );
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ stage_key: string | null; cnt: number | string }>) {
    if (row.stage_key) map[row.stage_key] = (map[row.stage_key] ?? 0) + Number(row.cnt);
  }
  return map;
}
