/**
 * Chaves de cache da tela de Leads — aninhadas sob `["leads", …]`.
 *
 * Antes eram três raízes (`leads`, `leads-count`, `leads-stats`). Duas
 * consequências que este arquivo desfaz:
 *   - mutação que invalidava `["leads"]` não atualizava contagem nem card —
 *     criar um lead deixava "Leads 123" na aba até o staleTime vencer;
 *   - o realtime não tinha como dizer "a lista agora, a contagem quando ela
 *     tiver um minuto": eram chaves sem parentesco.
 *
 * Hoje `["leads"]` cobre tudo (mutações), `["leads","list",org]` só as páginas,
 * `["leads","count",org]` só as contagens, `["leads","stats",org]` só os cards.
 *
 * Módulo PURO. Os parâmetros são declarados aqui (e não importados de
 * `hooks/useLeads`) para não criar ciclo lib → hooks.
 */
import type { LeadListSort } from "./lead-list-sort";

export interface LeadsKeyFilters {
  searchQuery?: string;
  filterOrigin?: string;
  filterQualification?: string;
  filterClassificacao?: string;
  usaLeiDoErp?: boolean;
  usaCadastroErpCafeJurere?: boolean;
  filterUf?: string;
  createdFrom?: string;
  createdTo?: string;
  filterAssignment?: "all" | "unassigned";
  filterResponsible?: string;
}

type Org = string | null | undefined;

export const leadsKeys = {
  all: ["leads"] as const,

  lists: (org: Org) => ["leads", "list", org] as const,
  /**
   * Ordem e recorte entram na chave junto com filtros e página. Sem sort.*, o
   * cache devolve a página da ordem antiga; sem filterAssignment, mistura
   * "todos" com "sem responsável". Espalhados (e não como objeto) para a chave
   * continuar legível no devtools.
   */
  list: (org: Org, page: number, f: LeadsKeyFilters, sort: LeadListSort) =>
    [
      "leads", "list", org, page,
      f.searchQuery, f.filterOrigin, f.filterQualification, f.filterClassificacao, f.usaLeiDoErp,
      f.usaCadastroErpCafeJurere, f.filterUf, f.createdFrom, f.createdTo, f.filterAssignment, f.filterResponsible,
      sort.key, sort.direction,
    ] as const,

  counts: (org: Org) => ["leads", "count", org] as const,
  /** Sem ordem: contagem não depende dela, e incluí-la refaria o total a cada clique no cabeçalho. */
  count: (org: Org, f: LeadsKeyFilters) =>
    [
      "leads", "count", org,
      f.searchQuery, f.filterOrigin, f.filterQualification, f.filterClassificacao, f.usaLeiDoErp,
      f.usaCadastroErpCafeJurere, f.filterUf, f.createdFrom, f.createdTo, f.filterAssignment, f.filterResponsible,
    ] as const,

  allStats: (org: Org) => ["leads", "stats", org] as const,
  stats: (org: Org, timeZone: string, f: Omit<LeadsKeyFilters, "filterAssignment">) =>
    [
      "leads", "stats", org, timeZone,
      f.searchQuery, f.filterOrigin, f.filterQualification, f.filterClassificacao, f.usaLeiDoErp,
      f.usaCadastroErpCafeJurere, f.filterUf, f.createdFrom, f.createdTo, f.filterResponsible,
    ] as const,
};
