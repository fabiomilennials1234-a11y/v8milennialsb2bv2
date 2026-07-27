/**
 * Fonte única da semântica de filtro da lista de leads.
 *
 * Módulo PURO — sem dependência de React/Supabase-client. Recebe um query
 * builder do Supabase (postgrest) já escopado por tenant e aplica os filtros
 * visíveis ao usuário (busca, origem, UF, rating, qualificação). Reutilizado por:
 *   - `useLeads` / `useLeadsCount` (lista + contagem, via `applyLeadsFilters`)
 *   - `useExportLeads` (exportação espelha o que está na tela)
 *
 * Manter aqui — e só aqui — evita drift entre a lista e a exportação.
 */

/** Valores dos filtros da lista de leads aplicáveis a uma query. Todos opcionais;
 * o sentinel `"all"` (e vazio/undefined) significa "sem filtro". */
export interface LeadListFilterValues {
  searchQuery?: string;
  filterOrigin?: string;
  filterRating?: string;
  /** Tier de qualificação, ou os sentinels `"all"` (sem filtro) e `"none"`
   * (leads sem tier — `qualification_tier IS NULL`, ≠ do tier "desqualificado"). */
  filterQualification?: string;
  filterUf?: string;
  /** Instante ISO (inclusive) — limite inferior de `created_at`. */
  createdFrom?: string;
  /** Instante ISO (inclusive) — limite superior de `created_at`. */
  createdTo?: string;
}

/**
 * Aplica os filtros da lista a um query builder do Supabase.
 *
 * NÃO adiciona `organization_id` nem o guard `is_shadow` — tenancy é
 * responsabilidade de quem chama (a lista via `applyLeadsFilters`, a exportação
 * via `.eq("organization_id", …)` própria). O builder é mutado por
 * encadeamento e retornado para permitir `query = applyLeadListFilters(query, …)`.
 */
export function applyLeadListFilters<Q>(query: Q, filters: LeadListFilterValues): Q {
  // O tipo do postgrest builder é encadeável mas difícil de anotar
  // genericamente; tratamos como `any` internamente, preservando `Q` na saída.
  let q = query as any;

  const search = filters.searchQuery?.trim();
  if (search) {
    const pattern = `%${search}%`;
    q = q.or(`name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}`);
  }

  if (filters.filterOrigin && filters.filterOrigin !== "all") {
    q = q.eq("origin", filters.filterOrigin);
  }

  if (filters.filterUf) {
    q = q.eq("uf", filters.filterUf);
  }

  if (filters.filterRating && filters.filterRating !== "all") {
    if (filters.filterRating === "high") q = q.gte("rating", 7);
    else if (filters.filterRating === "medium") q = q.gte("rating", 4).lt("rating", 7);
    else if (filters.filterRating === "low") q = q.lt("rating", 4);
  }

  // Janela de criação (deep-link do card "Leads" do Comando). Os limites chegam
  // como instantes ISO absolutos já cortados na fronteira de dia do fuso da org
  // (`computePeriodRange`/`zoned-day`), então aqui é comparação direta de
  // timestamptz — mesma semântica do `get_dashboard_metrics` (`>=` / `<=`), o que
  // faz a lista bater com o número do card.
  if (filters.createdFrom) {
    q = q.gte("created_at", filters.createdFrom);
  }
  if (filters.createdTo) {
    q = q.lte("created_at", filters.createdTo);
  }

  if (filters.filterQualification && filters.filterQualification !== "all") {
    // Sentinel "none" = leads sem tier (qualification_tier IS NULL). Distinto do
    // tier real "desqualificado".
    if (filters.filterQualification === "none") {
      q = q.is("qualification_tier", null);
    } else {
      q = q.eq("qualification_tier", filters.filterQualification);
    }
  }

  return q as Q;
}
