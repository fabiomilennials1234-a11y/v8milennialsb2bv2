/**
 * Estado dos filtros do board unificado e o recorte server-side que sai dele.
 *
 * Puro e sem hooks: mora em `lib/` para que o prefetch do trilho
 * (`hooks/perf/usePrefetchPipes`) calcule o MESMO recorte da tela sem puxar
 * `useFunilFilters` — que importa `@/modules/leads` e fecharia ciclo com o
 * Sidebar (platform → pipelines → leads → … → pipelines).
 */
import {
  createInitialPeriodState,
  getDateRange,
  type DateRange,
  type MetricsPeriodState,
} from "@/lib/metrics-period";
import { getStalledBucket, STALLED_ALL } from "@/modules/pipelines/lib/stalled-buckets";
import type { PaginatedFilters } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";

/**
 * Estado serializável do filtro de um board unificado (SCRUM-633).
 *
 * POJO de propósito: é o shape que a saved view (SCRUM-634) pode persistir e
 * re-hidratar. Único campo com pegadinha de serialização é `period`
 * (`MetricsPeriodState` carrega `Date` em custom range) — ao re-hidratar de
 * JSON, passe-o por `revivePeriodState` de `@/lib/metrics-period`.
 */
export interface FunilFilterState {
  /** team_members.id ou "all". */
  responsibleId: string;
  /** leads.origin ∈ lista; [] = sem filtro. */
  origins: string[];
  /** Interseção: lead precisa ter TODAS. [] = sem filtro. */
  tagIds: string[];
  qualificationTier: string[];
  preQualificationTier: string[];
  /** true → só leads com scheduled_user_message 'scheduled'. */
  scheduled: boolean;
  /** Data de criação do lead (entrada) — "Geral" = sem filtro. */
  period: MetricsPeriodState;
  /** Bucket "Parado há" (id de STALLED_BUCKETS) ou STALLED_ALL. */
  stalled: string;
}

export function createInitialFunilFilterState(): FunilFilterState {
  return {
    responsibleId: "all",
    origins: [],
    tagIds: [],
    qualificationTier: [],
    preQualificationTier: [],
    scheduled: false,
    period: createInitialPeriodState(),
    stalled: STALLED_ALL,
  };
}

/**
 * Recorte server-side de um estado de filtros. Puro: é o MESMO cálculo para a
 * tela (`useFunilFilters`) e para o prefetch do trilho, que aquece o board com
 * o estado inicial — chave igual nos dois lados ou o prefetch vai para o lixo.
 */
export function paginatedFiltersDoEstado(
  state: FunilFilterState,
  search: string,
  responsibleIdEfetivo: string,
  // A tela passa os já calculados (memo por `state.period`): período relativo
  // ("últimos 7 dias") recalculado a cada tecla mudaria a chave à toa.
  derivados: {
    metricsRange: DateRange | null;
    stalledBucket: ReturnType<typeof getStalledBucket>;
  } = { metricsRange: getDateRange(state.period), stalledBucket: getStalledBucket(state.stalled) },
): PaginatedFilters {
  const { metricsRange, stalledBucket } = derivados;
  return {
    search,
    responsibleId: responsibleIdEfetivo,
    tagIds: state.tagIds,
    origins: state.origins.length ? state.origins : undefined,
    qualificationTier: state.qualificationTier,
    preQualificationTier: state.preQualificationTier,
    scheduled: state.scheduled || undefined,
    periodAfter: metricsRange?.startStr ?? undefined,
    periodBefore: metricsRange?.endStr ?? undefined,
    stalledMinDays: stalledBucket?.minDays ?? null,
    stalledMaxDays: stalledBucket?.maxDays ?? null,
  };
}

/** Dimensões extras do Funil (fora do painel universal) que entram no recorte. */
export interface ExtrasDoRecorte {
  urgencyFilter: string;
  selectedStatuses: string[];
  productType: string;
}

/** Extras com que `/funil/:slug` abre. */
export const EXTRAS_INICIAIS_DO_FUNIL: ExtrasDoRecorte = {
  urgencyFilter: "all",
  selectedStatuses: [],
  productType: "all",
};

/**
 * O recorte final do board: painel universal + extras do Funil + âncora de
 * período dos fechados + faixa de reunião. Puro — `Funil.tsx` e o prefetch do
 * trilho compõem pelo MESMO caminho (chave igual, ou o aquecimento vai para o lixo).
 */
export function comporFiltrosDoFunil(
  paginated: PaginatedFilters,
  extra: ExtrasDoRecorte,
  opcoes: {
    /** Chaves de desfecho por papel; só entram com período ativo. */
    closedStatusKeys: string[];
    temPeriodo: boolean;
    timeParams: Partial<PaginatedFilters>;
  },
): PaginatedFilters {
  return {
    ...paginated,
    urgency: extra.urgencyFilter !== "all" ? extra.urgencyFilter : undefined,
    statusKeys: extra.selectedStatuses.length ? extra.selectedStatuses : undefined,
    productType: extra.productType !== "all" ? extra.productType : undefined,
    // Âncora de período dos FECHADOS por stage_role (metrics_period_at →
    // fallback updated_at) — a mesma âncora canônica do motor de métricas.
    closedStatusKeys: opcoes.temPeriodo && opcoes.closedStatusKeys.length ? opcoes.closedStatusKeys : undefined,
    ...opcoes.timeParams,
  };
}
