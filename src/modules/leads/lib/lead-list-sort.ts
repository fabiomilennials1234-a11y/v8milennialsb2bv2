/**
 * Fonte única da semântica de ORDENAÇÃO da lista de leads (ADR-0024 decisão 2).
 *
 * Módulo PURO — sem dependência de React ou do client Supabase, espelhando
 * `lead-list-filters.ts`. Recebe um query builder do postgrest já escopado por
 * tenant e aplica a ordem escolhida no cabeçalho da lista.
 *
 * ── POR QUE SÓ DUAS COLUNAS ORDENAM ───────────────────────────────────────
 * O cabeçalho tem sete rótulos e só `Nome` e `Data de criação` são colunas
 * reais de `leads`. As outras quatro não têm como ser ordenadas no servidor:
 *   - `Contatos` são dois campos (telefone e email), não um.
 *   - `Tags` é agregado de `lead_tags` — ordenar por ele pede RPC.
 *   - `Negócios` vem de `pipeline_entries`, carregado DEPOIS e em lote, só para
 *     os ids que já estão na página (`useLeadsDeals`).
 *   - `Dono da conta` é `COALESCE(venda, pré-venda, responsável)`; ordenar por
 *     um dos três não é ordenar pelo que a linha mostra.
 *
 * Ordenar essas quatro no cliente reordenaria as 50 linhas da página dentro de
 * uma org de 3.929 leads e chamaria isso de ordenação — a mesma mentira que a
 * decisão 2 acabou de tirar dos cards do topo. Enquanto não houver servidor
 * para elas, elas não são controle.
 *
 * ── O DESEMPATE NÃO É ENFEITE ─────────────────────────────────────────────
 * `ORDER BY` sem chave única não define a ordem DENTRO do empate, e a lista
 * pagina por OFFSET. Sem desempate o Postgres pode devolver a mesma linha na
 * página 2 e na 3, e sumir com outra — e nada disso aparece na página 1.
 *
 * Medido em prod 2026-08-04: 1.895 leads vivos dividem o `created_at` com algum
 * irmão da mesma org, e o maior grupo empatado tem 643 linhas — 13 páginas
 * inteiras. Por nome são 3.617 leads em nomes repetidos. O defeito já existia
 * na ordem-padrão por `created_at`; a ordenação por clique só o tornaria
 * diário. Por isso toda ordenação termina em `id` ASC — PK, nunca nula, nunca
 * repetida.
 *
 * Custo medido (EXPLAIN ANALYZE em prod, maior org): com o desempate,
 * `created_at DESC` continua servido por `idx_leads_org_not_shadow` via
 * Incremental Sort (2,9 ms na página 4); `name` ordena 3.9k linhas em memória
 * (~8 ms na última página, 524 kB de quicksort). Nenhum índice novo é preciso.
 *
 * ── CATÁLOGO FECHADO ──────────────────────────────────────────────────────
 * A ordem vem de `usePersistedState`, ou seja, de `localStorage` — entrada que
 * o usuário controla. O nome da coluna nunca é repassado cru ao `.order()`:
 * `normalizeLeadSort` só deixa passar chave que está em `LEAD_SORT_COLUMNS`, e
 * qualquer outra coisa vira o padrão.
 */

export type LeadSortKey = "created_at" | "name";
export type LeadSortDirection = "asc" | "desc";

export interface LeadListSort {
  readonly key: LeadSortKey;
  readonly direction: LeadSortDirection;
}

/**
 * Catálogo fechado das colunas ordenáveis.
 *
 * `firstClick` é a direção que o primeiro clique produz — e é o que a seta
 * fantasma do cabeçalho mostra no hover. Data começa da mais recente (é o que
 * a lista já fazia e o que se espera de um feed); nome começa de A.
 */
export const LEAD_SORT_COLUMNS: Record<LeadSortKey, { readonly firstClick: LeadSortDirection }> = {
  name: { firstClick: "asc" },
  created_at: { firstClick: "desc" },
};

/** A ordem que a lista sempre teve, agora explícita em vez de embutida. */
export const DEFAULT_LEAD_SORT: LeadListSort = { key: "created_at", direction: "desc" };

export function isLeadSortKey(value: unknown): value is LeadSortKey {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(LEAD_SORT_COLUMNS, value)
  );
}

/**
 * Converte um valor de origem duvidosa (localStorage, query string, view
 * salva antiga) numa ordenação válida. Nunca lança — o pior caso é a lista
 * voltar à ordem padrão.
 */
export function normalizeLeadSort(raw: unknown): LeadListSort {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_LEAD_SORT;

  const { key, direction } = raw as { key?: unknown; direction?: unknown };
  if (!isLeadSortKey(key)) return DEFAULT_LEAD_SORT;

  return {
    key,
    direction:
      direction === "asc" || direction === "desc"
        ? direction
        : LEAD_SORT_COLUMNS[key].firstClick,
  };
}

/**
 * O que um clique no cabeçalho faz: na coluna que já ordena, inverte; em
 * qualquer outra, adota a direção natural daquela coluna.
 */
export function toggleLeadSort(current: LeadListSort, key: LeadSortKey): LeadListSort {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: LEAD_SORT_COLUMNS[key].firstClick };
}

/**
 * Aplica a ordenação ao query builder. Sempre em dois `order`: a coluna pedida
 * e o desempate por `id`.
 *
 * `nullsFirst` fica de fora de propósito. As duas colunas do catálogo são NOT
 * NULL em prod, então a opção não muda resultado nenhum — mas passá-la muda o
 * plano: `created_at DESC` com `NULLS LAST` deixa de casar com o índice
 * `idx_leads_org_not_shadow` (índice DESC implica NULLS FIRST) e troca o
 * Incremental Sort de 2,9 ms por um sort completo da org inteira.
 */
export function applyLeadListSort<Q>(query: Q, sort: LeadListSort): Q {
  const q = query as unknown as OrderableQuery;
  return q
    .order(sort.key, { ascending: sort.direction === "asc" })
    .order("id", { ascending: true }) as unknown as Q;
}

/**
 * A fatia do builder postgrest que este módulo toca. Estreita de propósito: o
 * tipo real é encadeável e difícil de anotar genericamente, e `any` aqui
 * apagaria justamente a checagem que importa — que só `order` é chamado.
 */
interface OrderableQuery {
  order(column: string, options: { ascending: boolean }): OrderableQuery;
}
