/**
 * Carteira em rota própria (`/carteira`) — decisão CTO 2026-10-16.
 *
 * A carteira (lista de clientes + Cliente 360) era a aba "Clientes" de
 * `/leads`. Saiu para página própria, com porta própria na navegação. Este
 * arquivo é só dado e função pura: a chave do estado persistido da página, o
 * formato dos filtros e as duas regras que a migração da aba antiga precisa —
 * quais filtros da aba viajam para a Carteira e para onde o redirect leva.
 */

/** Rota da página. `/carteira/:clientId` (Cliente 360 legado) é outra rota. */
export const CARTEIRA_ROUTE = "/carteira";

/** Chave do `usePersistedState` da página (escopo org + membro, TTL 24 h). */
export const CARTEIRA_PERSIST_KEY = "carteira";

/** Valor que, na aba de Leads, significava "mostrar a carteira". */
export const CLASSIFICACAO_DA_CARTEIRA = "cliente";

export interface CarteiraFilterState {
  searchQuery: string;
  filterOrigin: string;
  filterQualification: string;
  /** Dono da conta: id de `team_member`, `"all"` ou `"none"` (sem dono). */
  filterResponsible: string;
}

export const DEFAULT_CARTEIRA_FILTERS: CarteiraFilterState = {
  searchQuery: "",
  filterOrigin: "all",
  filterQualification: "all",
  filterResponsible: "all",
};

/**
 * Os filtros que a aba Clientes mostrava, extraídos do estado de Leads.
 *
 * Quem chega pela aba antiga (estado persistido ou visão salva com
 * `cliente`) leva junto a busca e os três recortes que a aba exibia — senão
 * uma visão salva "clientes ouro do João" abriria a carteira inteira.
 * Campo ausente (visão gravada antes do filtro existir) cai no padrão.
 */
export function carteiraFiltersFromLeads(
  leads: Partial<Record<keyof CarteiraFilterState, unknown>>,
): CarteiraFilterState {
  const texto = (v: unknown, padrao: string) => (typeof v === "string" ? v : padrao);
  return {
    searchQuery: texto(leads.searchQuery, DEFAULT_CARTEIRA_FILTERS.searchQuery),
    filterOrigin: texto(leads.filterOrigin, DEFAULT_CARTEIRA_FILTERS.filterOrigin),
    filterQualification: texto(leads.filterQualification, DEFAULT_CARTEIRA_FILTERS.filterQualification),
    filterResponsible: texto(leads.filterResponsible, DEFAULT_CARTEIRA_FILTERS.filterResponsible),
  };
}

/**
 * Parâmetros de URL que a Carteira entende: o deep-link de lead (`?lead=`) e
 * o destaque de comentário que o acompanha (`?comment=`, consumido no feed).
 * O resto da query de `/leads` (`view`, `uf`, `from`, `to`, `atribuicao`) é
 * recorte da LISTA de leads — repassar faria a URL da Carteira prometer um
 * filtro que ela não aplica.
 */
const PARAMS_DA_CARTEIRA = ["lead", "comment"] as const;

/** Destino do redirect `/leads` (aba `cliente`) → `/carteira`. */
export function carteiraRedirectTarget(search: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const key of PARAMS_DA_CARTEIRA) {
    const value = search.get(key);
    if (value) next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `${CARTEIRA_ROUTE}?${qs}` : CARTEIRA_ROUTE;
}
