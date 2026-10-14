/**
 * reconcileMissingTitulos — fecha os títulos que o ERP deixou de devolver
 * (Chamado 065e4890). Lógica pura sobre um port de store, como
 * `upsertCanonicalTitulo`.
 *
 * 🔴 Por que existe: o Toth **omite** título quitado da resposta de
 * `/cobrancas` — não o devolve com saldo 0. O sync era só upsert do que veio,
 * então título pago ficava para sempre com o último status visto. Medido em
 * 13/10 na Café Jurerê: 544 títulos, **zero** `pago`, e 260 `atrasado`
 * (R$ 653 mil em 160 clientes) que o ERP já tinha baixado — mais de 90% da
 * inadimplência exibida era falsa.
 *
 * Ausência só prova baixa quando a pergunta feita ao ERP OBRIGAVA o título a
 * vir. Daí as três condições, todas necessárias:
 *
 *  1. **Resposta inequívoca** (`BatchEvidence.complete`). Erro no corpo, token
 *     vencido, forma inesperada ou linha sem id: nada fecha. Resposta errada
 *     zerando a carteira é pior que fantasma.
 *  2. **Título dentro da pergunta.** A janela do Toth casa "emitida OU vence OU
 *     alterada no período": aberto que VENCE na janela tem que vir. Vencido
 *     antes dela pode faltar só por estar fora — esse fica para a varredura
 *     `full`, que não tem janela.
 *  3. **Trava de proporção** (abaixo). Defende contra a resposta que parece
 *     válida mas veio incompleta.
 *
 * Fechar = `status='pago'`, `pago_em` NULL: o ERP não diz QUANDO foi pago, e
 * inventar a data do sync contaminaria qualquer métrica de prazo de recebimento.
 */

import { extractApiError } from "../toth-mappers.ts";

export interface OpenTitulo {
  id: string;
  externalId: string;
  clientId: string;
  /** ISO `aaaa-mm-dd`, ou null quando o ERP não informou. */
  vencimento: string | null;
}

export interface TituloReconcileStore {
  /** Títulos `aberto`/`atrasado` da origem, só dos clientes dados. */
  listOpenTitulosForClients(
    organizationId: string,
    source: string,
    clientIds: string[],
  ): Promise<OpenTitulo[]>;
  /** Marca como pagos, em lote. Devolve quantos de fato mudaram. */
  markTitulosPaid(organizationId: string, ids: string[]): Promise<number>;
}

/** O que a resposta de um lote prova sobre os títulos dos seus clientes. */
export type BatchEvidence =
  | { kind: "complete"; externalIds: ReadonlySet<string> }
  | { kind: "untrusted"; reason: string };

/**
 * Janela usada na consulta, em ISO inclusivo, ou `"full"` quando a consulta
 * foi sem janela.
 */
export type ReconcileWindow = { from: string; to: string } | "full";

export interface ReconcileParams {
  organizationId: string;
  source: string;
  clientIds: string[];
  evidence: BatchEvidence;
  window: ReconcileWindow;
}

export type ReconcileResult =
  | { action: "skipped"; reason: string }
  | { action: "refused"; wouldClose: number; open: number }
  | { action: "reconciled"; closed: number };

/**
 * Trava: um lote não fecha mais da METADE dos títulos abertos dos seus clientes
 * quando isso passa de 20 títulos.
 *
 * O cenário que ela pega: o fornecedor disse que `cnpj=a,b,c` devolve os três
 * "pelo que vi" — não é contrato. Se um dia o ERP honrar só o primeiro CNPJ, a
 * resposta é um array válido e os outros 49 clientes parecem ter quitado tudo.
 *
 * Por que estes números, medidos em 14/10 na Café Jurerê: 265 clientes com
 * título aberto em 12,6 mil — ~1 por lote de 50 —, no máximo 11 abertos por
 * cliente, e no máximo 11 fantasmas por cliente. Fechar 20+ num lote só não
 * acontece com dado real; acontece com resposta truncada. A exigência dupla
 * (proporção E contagem) deixa passar o cliente pequeno que quitou tudo —
 * 4 de 4 é 100%, e é legítimo.
 */
export const RECONCILE_GUARD_MAX_RATIO = 0.5;
export const RECONCILE_GUARD_MIN_COUNT = 20;

export async function reconcileMissingTitulos(
  store: TituloReconcileStore,
  params: ReconcileParams,
): Promise<ReconcileResult> {
  const { organizationId, source, clientIds, evidence, window } = params;

  if (evidence.kind !== "complete") return { action: "skipped", reason: evidence.reason };
  if (clientIds.length === 0) return { action: "skipped", reason: "no_clients" };

  const open = await store.listOpenTitulosForClients(organizationId, source, clientIds);

  const toClose = open.filter((t) => {
    if (evidence.externalIds.has(t.externalId)) return false;
    if (window === "full") return true;
    // Sem vencimento não dá para dizer que estava dentro da pergunta.
    if (!t.vencimento) return false;
    const venc = t.vencimento.slice(0, 10);
    return venc >= window.from && venc <= window.to;
  });

  if (toClose.length === 0) return { action: "reconciled", closed: 0 };

  if (
    toClose.length > RECONCILE_GUARD_MIN_COUNT &&
    toClose.length > open.length * RECONCILE_GUARD_MAX_RATIO
  ) {
    return { action: "refused", wouldClose: toClose.length, open: open.length };
  }

  const closed = await store.markTitulosPaid(
    organizationId,
    toClose.map((t) => t.id),
  );
  return { action: "reconciled", closed };
}

/**
 * Decide se a resposta de `/cobrancas` de um lote prova ausência.
 *
 * Só um **array cru** de objetos, sem erro no corpo, e com TODAS as linhas
 * mapeadas para um id serve. Cada exigência fecha uma porta:
 *  - envelope ou objeto: o Toth responde array na raiz; outra forma é algo que
 *    não entendemos, e `extractRows` devolveria `[]` — "ninguém deve nada";
 *  - erro no corpo (`[{"error":"Acesso nao autorizado! "}]`): é uma linha, não
 *    um título — e a lista "sem títulos" fecharia todos;
 *  - linha sem id: o id dela pode ser justamente o do título que fecharíamos.
 *
 * `mapped` vem do laço de upsert, que já mapeou as linhas — não remapear aqui
 * mantém um único ponto de verdade sobre o que é o id de uma cobrança.
 */
export function tothBatchEvidence(
  payload: unknown,
  mapped: { externalIds: string[]; unmapped: number },
): BatchEvidence {
  if (!Array.isArray(payload)) return { kind: "untrusted", reason: "payload_not_array" };
  const apiError = extractApiError(payload);
  if (apiError) return { kind: "untrusted", reason: "payload_api_error" };
  if (payload.some((row) => typeof row !== "object" || row === null || Array.isArray(row))) {
    return { kind: "untrusted", reason: "payload_bad_row" };
  }
  if (mapped.unmapped > 0) return { kind: "untrusted", reason: "row_without_id" };
  return { kind: "complete", externalIds: new Set(mapped.externalIds) };
}
