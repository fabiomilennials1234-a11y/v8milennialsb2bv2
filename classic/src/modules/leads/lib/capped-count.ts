/**
 * Contagem de leads com TETO — no lugar de `count: "exact"`.
 *
 * ── POR QUÊ ───────────────────────────────────────────────────────────────
 * `count: exact` faz o Postgres percorrer o recorte INTEIRO, avaliando a RLS
 * de leads linha a linha, só para devolver um número. A tela pedia seis desses
 * por aba aberta (total, quatro abas, dois cards — o total coincide com a aba
 * ativa). Em 2026-10-05 isso era o grosso dos 60% do tempo do banco que a tela
 * de Leads consumia, e o `statement_timeout` de 8 s + `retry: 1` fazia a
 * contagem que estoura rodar duas vezes.
 *
 * Com teto, o banco para na milésima linha que casa. Abaixo do teto o número é
 * exato; no teto a tela diz "1.000+" — que é o que ela precisa dizer: a aba
 * com 12.686 leads e a com 1.001 pedem a mesma decisão de quem olha.
 *
 * Descartado: `count: "estimated"` (número do planejador; com RLS e `ilike` é
 * ficção, e abaixo do limiar o PostgREST roda o exato do mesmo jeito).
 *
 * ── PRÉ-CONDIÇÃO ──────────────────────────────────────────────────────────
 * O `max-rows` do PostgREST de prod precisa ser ≥ `LEADS_COUNT_CAP`. Se fosse
 * 500, um recorte de 2.000 devolveria 500 linhas e a tela diria "500" —
 * exato e errado. Evidência no repo de que é 1.000:
 * `supabase/functions/toth-sync-cobrancas/index.ts` (`.limit(3000)` devolvia
 * 1.000) e `src/modules/communication/lib/whatsappMessagesQuery.ts`
 * (`max_rows` de prod = 1000). Subir o teto exige subir o `max-rows` junto.
 *
 * O teto sobe quando a RLS de leads reescrita entrar (trilha separada): o
 * custo por linha cai e 1.000 deixa de ser o ponto certo.
 */

/** Uma constante só. Ver "PRÉ-CONDIÇÃO" acima antes de mudar. */
export const LEADS_COUNT_CAP = 1000;

export interface CappedCount {
  /** Linhas contadas, no máximo `LEADS_COUNT_CAP`. */
  value: number;
  /** `true` = há pelo menos `LEADS_COUNT_CAP`; `value` é piso, não total. */
  capped: boolean;
}

export const EMPTY_COUNT: CappedCount = { value: 0, capped: false };

export function countFromRows(rows: number): CappedCount {
  return rows >= LEADS_COUNT_CAP
    ? { value: LEADS_COUNT_CAP, capped: true }
    : { value: Math.max(0, rows), capped: false };
}

/** Fatia do builder postgrest que a contagem usa. */
interface LimitableQuery {
  limit(count: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
}

/**
 * Executa a contagem com teto num builder já com `select("id")` e filtros.
 * Sem `order`: a contagem não depende de ordem, e ordenar obrigaria o banco a
 * ler o recorte inteiro antes de cortar — exatamente o que o teto evita.
 */
export async function runCappedCount(query: unknown): Promise<CappedCount> {
  const { data, error } = await (query as LimitableQuery).limit(LEADS_COUNT_CAP);
  if (error) throw error;
  return countFromRows(data?.length ?? 0);
}

const nf = new Intl.NumberFormat("pt-BR");

/** "1.000+" no teto, o número exato abaixo, "—" sem dado. */
export function formatCappedCount(count: CappedCount | undefined): string {
  if (!count) return "—";
  return count.capped ? `${nf.format(count.value)}+` : nf.format(count.value);
}

/**
 * O total que a tela pode afirmar, dada a página que está mostrando.
 *
 * Passado o teto usa o que a navegação já provou: página cheia diz "1.250+"
 * (há pelo menos isso); página incompleta é o fim do recorte, e o total vira
 * exato.
 */
export function knownTotalLabel(count: CappedCount, page: number, pageSize: number, shown: number): string {
  if (!count.capped) return nf.format(count.value);
  const to = page * pageSize + shown;
  if (shown < pageSize && to >= count.value) return nf.format(to);
  return `${nf.format(Math.max(count.value, to))}+`;
}

/** Rodapé da lista: "Mostrando 1–50 de 1.000+". */
export function formatShownTotal(count: CappedCount, page: number, pageSize: number, shown: number): string {
  const from = page * pageSize + 1;
  const to = page * pageSize + shown;
  return `Mostrando ${nf.format(from)}–${nf.format(to)} de ${knownTotalLabel(count, page, pageSize, shown)}`;
}

export interface CappedPagination {
  /** Índice da última página com total EXATO; `null` no teto (fim ainda desconhecido). */
  lastPage: number | null;
  /** Há página depois desta? No teto, "esta página veio cheia". */
  hasNext: boolean;
}

/**
 * Paginação sobre contagem com teto. Total exato: há última página. No teto
 * não há — segue-se enquanto a página vem cheia, e a navegação além da 20ª
 * página continua possível.
 */
export function cappedPagination(
  count: CappedCount | undefined,
  page: number,
  pageSize: number,
  shown: number,
): CappedPagination {
  if (!count) return { lastPage: null, hasNext: false };
  if (!count.capped) {
    const lastPage = Math.max(0, Math.ceil(count.value / pageSize) - 1);
    return { lastPage, hasNext: page < lastPage };
  }
  return { lastPage: null, hasNext: shown === pageSize };
}
