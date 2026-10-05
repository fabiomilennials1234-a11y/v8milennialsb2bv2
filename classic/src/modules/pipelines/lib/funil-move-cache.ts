import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  optimisticMovePipelineEntry,
  rollbackPipelineEntryMove,
  type OptimisticMoveSnapshot,
} from "./optimistic-move";

/**
 * Cache do board da página unificada `/funil/:slug` — o que um move faz com as
 * queries, num lugar só.
 *
 * Antes daqui, um move custava ~70 `get_pipeline_page` + 5 contagens em 6 s por
 * pessoa com o board aberto (CP-v2, 2026-10-05): duas rodadas imediatas de
 * invalidação por PREFIXO (`["pipeline-page"]` = todas as colunas de todos os
 * boards montados) e mais duas do eco do Realtime. Este módulo troca isso por:
 *
 *   1. otimismo — o card muda de coluna no cache na hora, com rollback no erro;
 *   2. UMA reconciliação, restrita às colunas de origem e destino + contagem
 *      daquele funil (o resto só é marcado como velho, sem ida ao banco);
 *   3. um registro de "eco próprio" que o Realtime consulta para não refazer a
 *      rodada que a reconciliação já fez;
 *   4. o plano de invalidação do Realtime: só as colunas afetadas pelo evento.
 *
 * Chaves (ver `usePaginatedFunil`): `["pipeline-page", pipelineId, stageKey,
 * orgId, filtersKey]` e `["pipeline-stage-counts", pipelineId, orgId, args]`.
 */

const PAGE = "pipeline-page";
const COUNTS = "pipeline-stage-counts";

// ── Otimismo ─────────────────────────────────────────────────────────────────

export interface MoveOtimista {
  snapshot: OptimisticMoveSnapshot;
  pipelineId: string;
  entryId: string;
  toStage: string;
}

/**
 * Move o card entre colunas no cache e registra o eco esperado. Devolve o
 * necessário para `reverterMoveOtimista` (rollback fiel) — `snapshot.fromStage`
 * é a coluna de origem que a reconciliação precisa.
 */
export function aplicarMoveOtimista(
  qc: QueryClient,
  { pipelineId, entryId, toStage }: { pipelineId: string; entryId: string; toStage: string },
): MoveOtimista {
  const snapshot = optimisticMovePipelineEntry(qc, { boardKey: pipelineId, id: entryId, toStage });
  registrarEcoProprio({ entryId, pipelineId, stageKey: toStage });
  return { snapshot, pipelineId, entryId, toStage };
}

export function reverterMoveOtimista(qc: QueryClient, move: MoveOtimista): void {
  rollbackPipelineEntryMove(qc, move.snapshot);
  esquecerEcoProprio(move.entryId);
}

/**
 * Cancela fetch em voo SÓ das colunas que o move toca + contagens do funil —
 * um refetch antigo que aterrissasse depois do otimismo desfaria o card na
 * tela. Cancelar o board inteiro interromperia carga de coluna alheia.
 */
export async function cancelarFetchDoMove(
  qc: QueryClient,
  { pipelineId, stages }: { pipelineId: string; stages: Array<string | null | undefined> },
): Promise<void> {
  const alvo = new Set(stages.filter((s): s is string => !!s));
  await Promise.all([
    ...[...alvo].map((stage) => qc.cancelQueries({ queryKey: [PAGE, pipelineId, stage] })),
    qc.cancelQueries({ queryKey: [COUNTS, pipelineId] }),
  ]);
}

/** Em que coluna do funil o card está no cache (`null` se em nenhuma). */
export function colunaDoCardNoCache(qc: QueryClient, pipelineId: string, entryId: string): string | null {
  for (const [key, data] of qc.getQueriesData({ queryKey: [PAGE, pipelineId] })) {
    const pages = (data as { pages?: unknown[][] } | undefined)?.pages;
    if (!Array.isArray(pages)) continue;
    for (const page of pages) {
      if ((page as Array<{ id?: string }>).some((e) => e?.id === entryId)) {
        return (key as unknown[])[2] as string;
      }
    }
  }
  return null;
}

// ── Reconciliação (UMA rodada por move) ──────────────────────────────────────

/**
 * Prefixos que o move deixa velhos em OUTRAS telas. Nenhum é montado na página
 * `/funil` — por isso `refetchType: "none"`: marca como velho (a tela refaz a
 * busca ao montar) sem ida ao banco agora. É o mesmo conjunto que
 * `invalidateAfterMove` + o `onSuccess` de `useMoveLeadInCustomPipe` cobriam,
 * só que sem disparar refetch ativo em cascata.
 *
 *  - views de compat `pipe_*` e `pipeline_entries`: telas legadas de funil;
 *  - `custom_pipe_*`: board custom legado;
 *  - `upsell_clients`: o move custom com destino carteira escreve lá;
 *  - `leads`, `leads-deals`, `leads-sales-metrics`: lista de Leads (rota
 *    própria; chave por org + página, não por lead).
 */
const PREFIXOS_DE_OUTRAS_TELAS = [
  "pipe_whatsapp",
  "pipe_confirmacao",
  "pipe_propostas",
  "pipeline_entries",
  "custom_pipe_entries",
  "custom_pipe_stage_counts",
  "upsell_clients",
  "leads",
  "leads-deals",
  "leads-sales-metrics",
] as const;

export interface ReconciliarMoveParams {
  pipelineId: string;
  entryId: string;
  leadId?: string | null;
  /** Coluna de origem; `null` quando desconhecida (card fora do cache). */
  fromStage: string | null;
  toStage: string;
}

/**
 * A única invalidação de um move na página `/funil`.
 *
 * Refetch ATIVO (só o que está montado busca):
 *   - colunas de origem e destino DESTE funil — onde o card saiu e entrou;
 *   - contagens DESTE funil — badges das colunas e cabeçalho;
 *   - `deal-card-extras` do card e `lead-pipes`/`lead_all_pipelines`/
 *     `lead-timeline` do lead — o painel do lead abre por cima do board
 *     (`LeadPanelLayout`); fechado, não há observer e nada busca.
 *
 * Marca como velho, sem refetch: boards de OUTROS funis (o move custom pode
 * atravessar para o funil de destino) e `PREFIXOS_DE_OUTRAS_TELAS`.
 */
export function reconciliarMoveNoFunil(qc: QueryClient, p: ReconciliarMoveParams): void {
  const outroFunil = (key: QueryKey) => key[1] !== p.pipelineId;
  qc.invalidateQueries({ queryKey: [PAGE], predicate: (q) => outroFunil(q.queryKey), refetchType: "none" });
  qc.invalidateQueries({ queryKey: [COUNTS], predicate: (q) => outroFunil(q.queryKey), refetchType: "none" });
  for (const prefixo of PREFIXOS_DE_OUTRAS_TELAS) {
    qc.invalidateQueries({ queryKey: [prefixo], refetchType: "none" });
  }

  if (p.fromStage) {
    const colunas = new Set([p.fromStage, p.toStage]);
    for (const stage of colunas) {
      qc.invalidateQueries({ queryKey: [PAGE, p.pipelineId, stage] });
    }
  } else {
    // Origem desconhecida: o card não estava em coluna carregada. Ainda assim
    // restrito a ESTE funil.
    qc.invalidateQueries({ queryKey: [PAGE, p.pipelineId] });
  }
  qc.invalidateQueries({ queryKey: [COUNTS, p.pipelineId] });
  qc.invalidateQueries({ queryKey: ["deal-card-extras", p.entryId] });

  if (p.leadId) {
    qc.invalidateQueries({ queryKey: ["lead-pipes", p.leadId] });
    qc.invalidateQueries({ queryKey: ["lead_all_pipelines", p.leadId] });
    qc.invalidateQueries({ queryKey: ["lead-timeline", p.leadId] });
  }
}

// ── Eco próprio ──────────────────────────────────────────────────────────────

/**
 * Janela em que o UPDATE do próprio move, ecoado pelo Realtime, é ignorado. A
 * reconciliação já buscou as colunas depois do commit; o eco só repetiria a
 * rodada. Folga larga porque o Realtime atrasa sob carga.
 */
export const ECO_PROPRIO_TTL_MS = 10_000;

/**
 * Janela do eco da escrita de METADATA (perda/venda gravam o desfecho antes do
 * move). Curta: o UPDATE do metadata e o do move saem um atrás do outro.
 */
export const ECO_METADATA_TTL_MS = 5_000;

interface EcoEsperado {
  pipelineId: string;
  stageKey: string;
  expiraEm: number;
}

/**
 * Ecos esperados por entrada — uma LISTA, porque um fluxo pode escrever a
 * mesma linha mais de uma vez (metadata na etapa de origem, depois o move para
 * o destino). Regras (volta 1, R1):
 *
 *  - CONSUMO: cada eco esperado é ignorado UMA vez. Sem isso, um eco que já
 *    chegou continuava "esperado" e engolia um evento legítimo idêntico de
 *    outro usuário (meu s0→s1; outro s1→s2→s1 em < 10 s ⇒ o s2→s1 era
 *    descartado, tela presa em s2 com o banco em s1);
 *  - DESVIO: evento do mesmo id que não casa com nenhum eco esperado significa
 *    que outra escrita passou na frente — a lista inteira é descartada e o
 *    evento é processado. Dali em diante nada daquele id é ignorado.
 */
const ecosEsperados = new Map<string, EcoEsperado[]>();

export function registrarEcoProprio(
  { entryId, pipelineId, stageKey }: { entryId: string; pipelineId: string; stageKey: string },
  agora: number = Date.now(),
  ttlMs: number = ECO_PROPRIO_TTL_MS,
): void {
  const lista = ecosEsperados.get(entryId) ?? [];
  lista.push({ pipelineId, stageKey, expiraEm: agora + ttlMs });
  ecosEsperados.set(entryId, lista);
}

export function esquecerEcoProprio(entryId: string): void {
  ecosEsperados.delete(entryId);
}

/**
 * O evento é eco de uma escrita feita NESTA aba? Casa id + funil + etapa com
 * um eco esperado e ainda válido — e o CONSOME. Não casar com nenhum (desvio)
 * descarta os ecos daquele id. Chamar só com evento real do Realtime: a
 * consulta tem efeito.
 */
export function ehEcoProprio(
  row: { id?: unknown; pipeline_id?: unknown; stage_key?: unknown } | null | undefined,
  agora: number = Date.now(),
): boolean {
  if (!row || typeof row.id !== "string") return false;
  const lista = ecosEsperados.get(row.id);
  if (!lista) return false;
  const vivos = lista.filter((e) => e.expiraEm >= agora);
  const i = vivos.findIndex((e) => e.pipelineId === row.pipeline_id && e.stageKey === row.stage_key);
  if (i < 0) {
    ecosEsperados.delete(row.id);
    return false;
  }
  vivos.splice(i, 1);
  if (vivos.length > 0) ecosEsperados.set(row.id, vivos);
  else ecosEsperados.delete(row.id);
  return true;
}

/** Só para teste: ecos ainda esperados de uma entrada (leitura sem consumo). */
export function __ecosEsperados(entryId: string): Array<{ pipelineId: string; stageKey: string }> {
  return (ecosEsperados.get(entryId) ?? []).map(({ pipelineId, stageKey }) => ({ pipelineId, stageKey }));
}

/** Só para teste: zera o registro entre casos. */
export function __limparEcosProprios(): void {
  ecosEsperados.clear();
}

// ── Plano do Realtime ────────────────────────────────────────────────────────

export interface EventoPipelineEntry {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
}

/**
 * Quais colunas DESTE funil um evento de `pipeline_entries` afeta.
 *
 * A origem vem do CACHE, não de `payload.old`: com RLS ligada o Realtime
 * entrega em `old` só a chave primária (e a tabela não tem REPLICA IDENTITY
 * FULL no repo), então `old.stage_key` não existe. O cache sabe em que coluna o
 * card estava — e se ele não está em coluna carregada, a coluna de origem não
 * tem o que corrigir na tela (a contagem cobre o número).
 *
 * Devolve `null` quando o evento não toca este funil (outro funil da mesma
 * org) ou é o eco do próprio move.
 */
export function planejarInvalidacaoRealtime(
  qc: QueryClient,
  pipelineId: string,
  evento: EventoPipelineEntry,
): { stages: string[] } | null {
  const novo = evento.eventType === "DELETE" ? null : evento.new ?? null;
  const id = (novo?.id ?? evento.old?.id) as string | undefined;
  if (!id) return null;
  if (novo && ehEcoProprio(novo)) return null;

  const stages = new Set<string>();
  const noCache = colunaDoCardNoCache(qc, pipelineId, id);
  if (noCache) stages.add(noCache);
  if (novo && novo.pipeline_id === pipelineId && typeof novo.stage_key === "string") {
    stages.add(novo.stage_key);
  }
  if (stages.size === 0) return null;
  return { stages: [...stages] };
}

/** Aplica um lote de colunas afetadas: só elas + contagens do funil. */
export function invalidarColunasDoFunil(qc: QueryClient, pipelineId: string, stages: Iterable<string>): void {
  for (const stage of stages) {
    qc.invalidateQueries({ queryKey: [PAGE, pipelineId, stage], refetchType: "active" });
  }
  qc.invalidateQueries({ queryKey: [COUNTS, pipelineId], refetchType: "active" });
}
