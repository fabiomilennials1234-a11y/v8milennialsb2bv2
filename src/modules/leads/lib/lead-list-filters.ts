/**
 * Fonte única da semântica de filtro da lista de leads.
 *
 * Módulo PURO — sem dependência de React/Supabase-client. Recebe um query
 * builder do Supabase (postgrest) já escopado por tenant e aplica os filtros
 * visíveis ao usuário (busca, origem, UF, qualificação). Reutilizado por:
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
  /** Tier de qualificação, ou os sentinels `"all"` (sem filtro) e `"none"`
   * (leads sem tier — `qualification_tier IS NULL`, ≠ do tier "desqualificado"). */
  filterQualification?: string;
  /**
   * Gaveta do lead: `"lead" | "cliente" | "indefinido"`, ou `"all"` (sem
   * recorte). Filtra no BANCO, não na página carregada — a lista é paginada, e
   * filtrar no cliente mostraria "3 de 12.686" em vez dos 3 de verdade.
   */
  filterClassificacao?: string;
  filterUf?: string;
  /** Instante ISO (inclusive) — limite inferior de `created_at`. */
  createdFrom?: string;
  /** Instante ISO (inclusive) — limite superior de `created_at`. */
  createdTo?: string;
  /**
   * Recorte por atribuição. `"unassigned"` = lead sem responsável em NENHUMA
   * das quatro colunas.
   *
   * As quatro, não duas: o RLS de leads e o predicado do chat consideram
   * pre_sale, sale, sdr e closer, e elas divergem entre si em milhares de
   * registros. Um recorte com duas listaria como "sem responsável" lead que o
   * produto considera atribuído — e o admin atribuiria por cima do dono real.
   */
  filterAssignment?: "all" | "unassigned";
  /**
   * Recorte pelo **Dono da conta** — a coluna que a lista exibe. Aceita o id de
   * um `team_member`, ou os sentinels `"all"` (sem filtro) e `"none"` (leads sem
   * dono).
   *
   * Distinto de `filterAssignment`, e de propósito: `filterAssignment` responde
   * "quem enxerga este lead?" (as quatro colunas que o RLS e o chat consideram —
   * pre_sale, sale, sdr, closer) e serve ao deep-link da política de isolamento.
   * Este responde "de quem é este lead na tela?", que é a precedência
   * `sale ?? pre_sale ?? responsible` renderizada em `LeadListRow`. Unificar os
   * dois faria um dos lados mentir: filtrar por Fulano devolveria linha cuja
   * célula diz outro nome, ou "sem dono" esconderia linha que a tela mostra
   * vazia.
   */
  filterResponsible?: string;
}

/**
 * Colunas do "Dono da conta", na MESMA ordem de precedência que a lista pinta
 * (`LeadListRow`: `sale_responsible ?? pre_sale_responsible ?? responsible`).
 *
 * Mudou a precedência lá? Muda aqui junto — senão o filtro passa a devolver
 * linha cujo nome na célula é outro.
 */
const OWNER_COLUMNS = [
  "sale_responsible_id",
  "pre_sale_responsible_id",
  "responsible_id",
] as const;

/** Sentinel do filtro de dono: leads sem nenhuma das colunas de `OWNER_COLUMNS`. */
const OWNER_NONE = "none";

/**
 * Um id de `team_member` só entra no `or()` do PostgREST depois de provado
 * UUID. O valor vem de um Select nosso, mas também de localStorage (visão
 * salva persistida) — e ali é texto que o usuário pode editar. Sem esta
 * checagem, uma vírgula ou parêntese no valor reescreve a árvore de filtros.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Predicado PostgREST que casa EXATAMENTE as linhas cuja célula "Dono da conta"
 * mostra `memberId` — não basta `col.eq.X` nas três, porque um lead com
 * `sale_responsible = A` e `responsible = B` exibe "A" e não pode aparecer ao
 * filtrar por B. Por isso cada nível carrega o `is.null` dos anteriores.
 */
function buildOwnerMatch(memberId: string): string {
  return OWNER_COLUMNS.map((col, i) => {
    const anteriores = OWNER_COLUMNS.slice(0, i).map((c) => `${c}.is.null`);
    const igual = `${col}.eq.${memberId}`;
    return anteriores.length ? `and(${[...anteriores, igual].join(",")})` : igual;
  }).join(",");
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
/** Colunas que o produto considera "responsável" por um lead. */
const RESPONSIBLE_COLUMNS = [
  "pre_sale_responsible_id",
  "sale_responsible_id",
  "sdr_id",
  "closer_id",
] as const;

export function applyLeadListFilters<Q>(query: Q, filters: LeadListFilterValues): Q {
  // O tipo do postgrest builder é encadeável mas difícil de anotar
  // genericamente; tratamos como `any` internamente, preservando `Q` na saída.
  let q = query as any;

  if (filters.filterAssignment === "unassigned") {
    for (const col of RESPONSIBLE_COLUMNS) q = q.is(col, null);
  }

  const owner = filters.filterResponsible;
  if (owner && owner !== "all") {
    if (owner === OWNER_NONE) {
      for (const col of OWNER_COLUMNS) q = q.is(col, null);
    } else if (UUID_RE.test(owner)) {
      q = q.or(buildOwnerMatch(owner));
    }
    // Valor fora do contrato (visão salva adulterada): ignorado — mesma escolha
    // de `parseInstantParam` na página. Não vira predicado cru.
  }

  const search = filters.searchQuery?.trim();
  if (search) {
    const pattern = `%${search}%`;
    const clauses = [
      `name.ilike.${pattern}`,
      `company.ilike.${pattern}`,
      `email.ilike.${pattern}`,
      `phone.ilike.${pattern}`,
      // 🔴 EXIGE a migration `20270921000010` APLICADA. A lista mostra o lead
      // como "1234 - João" e digitar o código tem que achá-lo; mas o PostgREST
      // devolve 400 para coluna inexistente, e um 400 aqui não degrada — apaga a
      // busca inteira. Aplicar a migration ANTES de mergear o frontend.
      `erp_code.ilike.${pattern}`,
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

  if (filters.filterClassificacao && filters.filterClassificacao !== "all") {
    q = q.eq("classificacao", filters.filterClassificacao);
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
