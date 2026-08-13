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
  /** Busca livre — casa contra nome, empresa, e-mail e telefone. */
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
  /**
   * Aba **Clientes**: só quem já comprou.
   *
   * A prova é ter ao menos um NEGÓCIO GANHO (`deals.won`) — a definição do
   * ADR-0023 §7, onde Cliente é "uma palavra com um significado: alguém que
   * comprou". Monotônico: ganhou uma vez, é cliente para sempre.
   *
   * ⚠ Não usa `sale_events`, e a diferença é medível: na Milennials são 91
   * leads com negócio ganho contra 99 com venda no caderno. Os 8 de diferença
   * são venda registrada sem negócio no funil (produtor de Carteira, ou card
   * que andou depois da venda). Incluí-los aqui faria a aba mostrar gente cujo
   * "negócio fechado" a tela ao lado não consegue mostrar — e a coluna
   * Negócios apareceria vazia para eles.
   */
  apenasClientes?: boolean;
}

/**
 * Embed que transforma o filtro de clientes num INNER JOIN.
 *
 * PostgREST só filtra a tabela-pai por uma filha com `!inner` no SELECT — o
 * `.eq("deals.won", true)` sozinho filtraria o embed e devolveria todos os
 * leads, com o embed vazio nos que não têm negócio. Por isso a semântica mora
 * em dois pedaços que precisam andar juntos: este fragmento e o filtro abaixo.
 *
 * `deals_source_lead_id_fkey` é explícito porque `deals` tem mais de um caminho
 * para `leads`; sem nomear a FK, o PostgREST recusa por ambiguidade.
 */
export function embedDeClientes(apenasClientes?: boolean): string {
  return apenasClientes ? ",\n          deals!deals_source_lead_id_fkey!inner(id)" : "";
}

/**
 * Mínimo de dígitos para o termo ser tratado como busca de telefone. Abaixo
 * disso ("21", "9") o `ilike` casaria com praticamente toda a base e a busca
 * por nome com número no meio ("Loja 21") viraria ruído.
 */
const MIN_PHONE_SEARCH_DIGITS = 4;

/**
 * Extrai a sequência de dígitos de um termo de busca, ou `null` quando o termo
 * não parece um telefone. Só os dígitos entram na query — o que também os torna
 * seguros de interpolar no `or()` do PostgREST (nenhum caractere estrutural).
 */
function extractSearchDigits(search: string): string | null {
  const digits = search.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_SEARCH_DIGITS ? digits : null;
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
    const clauses = [
      `name.ilike.${pattern}`,
      `company.ilike.${pattern}`,
      `email.ilike.${pattern}`,
      `phone.ilike.${pattern}`,
    ];

    // Telefone é digitado com máscara ("(21) 99999-8888", "21 99999 8888") mas
    // gravado cru em `normalized_phone` ("5521999998888"). Comparar o texto
    // digitado contra a coluna normalizada nunca casaria, então extraímos os
    // dígitos e casamos por substring — o que também torna a busca parcial
    // (só o final do número, sem DDD) funcionar.
    const digits = extractSearchDigits(search);
    if (digits) {
      clauses.push(`normalized_phone.ilike.%${digits}%`);
    }

    q = q.or(clauses.join(","));
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

  // Par obrigatório do `embedDeClientes`: o embed faz o INNER JOIN, estas duas
  // linhas dizem QUAIS negócios contam. Negócio na lixeira não prova compra.
  if (filters.apenasClientes) {
    q = q.eq("deals.won", true).is("deals.deleted_at", null);
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
