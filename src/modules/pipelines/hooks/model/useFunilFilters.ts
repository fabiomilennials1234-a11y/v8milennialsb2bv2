import { useCallback, useMemo, useState } from "react";
import { useResponsibleMembers } from "@/modules/identity";
import { useTags } from "@/modules/leads";
import {
  createInitialPeriodState,
  getDateRange,
  type DateRange,
  type MetricsPeriodState,
} from "@/lib/metrics-period";
import { getStalledBucket, STALLED_ALL } from "@/modules/pipelines/lib/stalled-buckets";
import type { FilterSectionConfig } from "@/modules/pipelines/lib/kanban-filter-config";
import type { PaginatedFilters } from "./usePaginatedPipeline";
import type { PipelineLeadIdsParams } from "./usePipelineLeadIds";

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

export interface FunilFiltersController {
  /** Estado bruto (serializável — contrato da saved view). */
  state: FunilFilterState;
  setState: React.Dispatch<React.SetStateAction<FunilFilterState>>;
  /** Busca livre (nome/telefone/empresa) — fora do painel, no toolbar. */
  search: string;
  setSearch: (v: string) => void;
  /** Seções declarativas prontas p/ `<KanbanFilterPanel sections={…}>` e `<FilterChips>`. */
  sections: FilterSectionConfig[];
  /** Recorte server-side p/ `usePaginatedFunil` / `usePaginatedPipeline` (badge == cards). */
  paginatedFilters: PaginatedFilters;
  /** Subconjunto honrado por `get_pipeline_lead_ids` — p/ `usePipelineLeadIds`. */
  leadIdsParams: PipelineLeadIdsParams;
  /**
   * Dimensões ATIVAS no board que o resolvedor de público NÃO honra
   * (scheduled/period/stalled não existem em get_pipeline_lead_ids). O wizard
   * de Disparo usa isto pra ser honesto sobre o recorte, como o
   * DisparoBoardFilter legado fazia com origin/scheduled/period.
   */
  leadIdsUnsupportedDims: string[];
  /** Range derivado de `state.period` — plugável no MetricsPeriodSelector/metrics. */
  metricsRange: DateRange | null;
  /** Nº de dimensões ativas (badge do botão Filtros). */
  activeCount: number;
  clearAll: () => void;
}

/**
 * Controller de filtros de UM funil por `pipeline_id` — o bloco plugável que a
 * página unificada `/funil/:slug` (SCRUM-632) consome. Contexto = SÓ o
 * pipelineId; membros e tags vêm de dentro (org do auth context), e o painel
 * (`KanbanFilterPanel`) segue 100% apresentacional recebendo `sections`.
 *
 * Superfície: as dimensões UNIVERSAIS de qualquer funil (valem sobre
 * `pipeline_entries` + `leads`, sem depender da família): período de criação,
 * parado-há, responsável, origem (multi), tags, tier IA/venda, agendados.
 * Dimensões específicas de um funil (urgency/product-type/status-multi/
 * meeting buckets dos 3 pipes de sistema) NÃO entram aqui — o host pode
 * concatenar seções extras no array antes de renderizar o painel e mapear os
 * params extras por cima de `paginatedFilters` (ambos são valores simples).
 *
 * "Parado há" entra sem gate (o interruptor legado morreu com as páginas): os
 * params `p_stalled_*` existem na assinatura de prod pós-W3 (20270908003000
 * recriou `get_pipeline_page` já com eles; sonda PostgREST de 2026-09-02
 * resolveu a chamada com os params — sem PGRST202).
 */
export function useFunilFilters(
  pipelineId: string | null | undefined,
  options: { initialState?: Partial<FunilFilterState> } = {},
): FunilFiltersController {
  const [state, setState] = useState<FunilFilterState>(() => ({
    ...createInitialFunilFilterState(),
    ...options.initialState,
  }));
  const [search, setSearch] = useState("");

  const responsibleMembers = useResponsibleMembers();
  const { data: orgTags = [] } = useTags();

  const patch = useCallback(
    <K extends keyof FunilFilterState>(key: K) =>
      (value: FunilFilterState[K]) =>
        setState((s) => ({ ...s, [key]: value })),
    [],
  );

  const sections = useMemo<FilterSectionConfig[]>(
    () => [
      { type: "created-period", value: state.period, onChange: patch("period") },
      { type: "stalled-days", value: state.stalled, onChange: patch("stalled") },
      {
        type: "responsible",
        value: state.responsibleId,
        onChange: patch("responsibleId"),
        members: responsibleMembers,
      },
      { type: "origin-multi", value: state.origins, onChange: patch("origins") },
      { type: "tags", value: state.tagIds, onChange: patch("tagIds"), tags: orgTags },
      {
        type: "qualification-tier",
        value: state.qualificationTier,
        onChange: patch("qualificationTier"),
      },
      {
        type: "pre-qualification-tier",
        value: state.preQualificationTier,
        onChange: patch("preQualificationTier"),
      },
      { type: "scheduled", value: state.scheduled, onChange: patch("scheduled") },
    ],
    [state, patch, responsibleMembers, orgTags],
  );

  const metricsRange = useMemo(() => getDateRange(state.period), [state.period]);
  const stalledBucket = useMemo(() => getStalledBucket(state.stalled), [state.stalled]);

  const paginatedFilters = useMemo<PaginatedFilters>(
    () => ({
      search,
      responsibleId: state.responsibleId,
      tagIds: state.tagIds,
      origins: state.origins.length ? state.origins : undefined,
      qualificationTier: state.qualificationTier,
      preQualificationTier: state.preQualificationTier,
      scheduled: state.scheduled || undefined,
      periodAfter: metricsRange?.startStr ?? undefined,
      periodBefore: metricsRange?.endStr ?? undefined,
      stalledMinDays: stalledBucket?.minDays ?? null,
      stalledMaxDays: stalledBucket?.maxDays ?? null,
    }),
    [search, state, metricsRange, stalledBucket],
  );

  const leadIdsParams = useMemo<PipelineLeadIdsParams>(
    () => ({
      search,
      responsibleId: state.responsibleId,
      tagIds: state.tagIds,
      qualificationTier: state.qualificationTier,
      preQualificationTier: state.preQualificationTier,
      origin: state.origins,
    }),
    [search, state],
  );

  const leadIdsUnsupportedDims = useMemo(() => {
    const dims: string[] = [];
    if (state.scheduled) dims.push("scheduled");
    if (metricsRange) dims.push("period");
    if (stalledBucket) dims.push("stalled");
    return dims;
  }, [state.scheduled, metricsRange, stalledBucket]);

  const activeCount = useMemo(() => {
    let n = 0;
    if (state.responsibleId !== "all") n++;
    if (state.origins.length) n++;
    if (state.tagIds.length) n++;
    if (state.qualificationTier.length) n++;
    if (state.preQualificationTier.length) n++;
    if (state.scheduled) n++;
    if (metricsRange) n++;
    if (stalledBucket) n++;
    return n;
  }, [state, metricsRange, stalledBucket]);

  const clearAll = useCallback(() => {
    setState(createInitialFunilFilterState());
  }, []);

  // pipelineId não entra em nenhum param hoje — os filtros são dimensões de
  // lead/entry, e o alvo do funil viaja separado (usePaginatedFunil /
  // usePipelineLeadIds recebem o id direto). O parâmetro existe no contrato
  // para (a) deixar o call site autoexplicativo e (b) permitir que dimensões
  // por-funil futuras (ex.: status-multi das etapas) entrem aqui sem mudar a
  // assinatura da costura.
  void pipelineId;

  return {
    state,
    setState,
    search,
    setSearch,
    sections,
    paginatedFilters,
    leadIdsParams,
    leadIdsUnsupportedDims,
    metricsRange,
    activeCount,
    clearAll,
  };
}
