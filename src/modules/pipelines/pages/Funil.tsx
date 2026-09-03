import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Settings2,
  Plus,
  MoreHorizontal,
  Loader2,
  AlertTriangle,
  Kanban,
  LayoutGrid,
  List,
  BarChart3,
  Send,
  Calendar as CalendarIcon,
} from "lucide-react";
import { toast } from "sonner";

import { usePipelines } from "@/modules/pipelines/hooks/model/usePipelines";
import { resolveFunil } from "@/modules/pipelines/lib/resolve-funil";
import { funilIcon } from "@/modules/pipelines/lib/funil-icons";
import {
  useFunilStages,
  usePaginatedFunil,
} from "@/modules/pipelines/hooks/model/usePaginatedFunil";
import type { PaginatedFilters } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";
import {
  useFunilFilters,
  createInitialFunilFilterState,
  type FunilFilterState,
} from "@/modules/pipelines/hooks/model/useFunilFilters";
import { useFunilMetrics } from "@/modules/pipelines/hooks/config/useFunilMetrics";
import {
  useCustomPipeline,
  useRemoveLeadFromCustomPipe,
} from "@/modules/pipelines/hooks/custom/useCustomPipelines";
// Delete GENÉRICO de entry (o corpo apaga `pipeline_entries` por id, com
// checagem de RLS via .select) — o nome é herança da página de Propostas.
import { useDeletePipeProposta as useDeleteEntry } from "@/modules/pipelines/hooks/legacy/usePipePropostas";
import { usePipelineStages } from "@/modules/pipelines/hooks/model/usePipelineStages";
import { FunilKanban, type FunilEntry } from "@/modules/pipelines/components/funis/FunilKanban";
import { useFunilMoveFlow, type FunilFlowEntry } from "@/modules/pipelines/components/funis/useFunilMoveFlow";
import { FunilAnalytics } from "@/modules/pipelines/components/funis/FunilAnalytics";
import { KanbanFilterPanel, FilterChips, type FilterSectionConfig } from "@/modules/pipelines/components/kanban/KanbanFilterPanel";
import { PipelineListView } from "@/modules/pipelines/components/kanban/PipelineListView";
import { CreateOpportunityModal } from "@/modules/pipelines/components/kanban/CreateOpportunityModal";
import { MeetingTimeline } from "@/modules/pipelines/components/legacy/confirmacao/MeetingTimeline";
import { AddMeetingModal } from "@/modules/pipelines/components/legacy/confirmacao/AddMeetingModal";
import { PipeSettingsDialog } from "@/modules/pipelines/components/shared/PipeSettingsDialog";
import { StageWorkflowsBadgeWrapper } from "@/modules/pipelines/components/kanban/StageWorkflowsBadgeWrapper";
import { useStageWorkflowCounts } from "@/modules/workflows/hooks/useStageWorkflows";
import { AutoCreateLeadToggle } from "@/modules/pipelines/components/shared/AutoCreateLeadToggle";
import { CreateProposalModal } from "@/modules/carteira/components/proposal/CreateProposalModal";
import { useViewport } from "@/shared/hooks/use-viewport";
import {
  DealPanelProvider,
  useDealSheet,
  LeadPanelProvider,
  DealCardPanel,
  LeadCardPanel,
  LeadModal,
  useBatchedLeadMetrics,
  useDeleteAllLeadsInPipe,
} from "@/modules/leads";
import { LeadPanelLayout } from "@/modules/platform/components/layout/LeadPanelLayout";
import { AddLeadToPipeModal } from "@/modules/pipelines/components/custom/AddLeadToPipeModal";
import { CustomPipeSettingsDialog } from "@/modules/pipelines/components/custom/CustomPipeSettingsDialog";
import { DisparoWizard, type DisparoBoardFilter, type DisparoSource } from "../components/disparo";
import { FunnelControlBar } from "@/modules/pipelines/components/shared/FunnelControlBar";
import { FunnelViewsMenu } from "@/modules/pipelines/components/shared/FunnelViewsMenu";
import { revivePeriodState, createInitialPeriodState, type MetricsPeriodState } from "@/lib/metrics-period";
import { priorityBandToRating, calorBandToBounds, CONFIRMACAO_OVERDUE_EXCLUDE_STATUS_KEYS } from "@/modules/pipelines/lib/kanbanFilterParams";
import { calcularEtapaPorDataDaReuniao, podeAplicarDx } from "@/modules/pipelines/lib/meeting-dx";
import {
  useFeaturePermission,
  useConfirmacaoOverdueDays,
  useOrganization,
  useResponsibleMembers,
} from "@/modules/identity";
import { useTags } from "@/modules/leads/hooks/useTags";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { trackModuleVisit } from "@/lib/analytics";
import {
  startOfDay,
  endOfDay,
  addDays,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function formatPeriodLabel(range: { startStr: string; endStr: string }): string {
  const [sy, sm, sd] = range.startStr.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = range.endStr.slice(0, 10).split("-").map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  if (sy === ey) return `${sd} ${MONTHS_PT[sm - 1]} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  return `${sd} ${MONTHS_PT[sm - 1]} ${sy} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
}

type FunilViewMode = "kanban" | "list" | "timeline" | "analytics";

/** Papel efetivo da etapa — `open` quando a governança ainda não a marcou. */
const roleDe = (s: { stage_role?: import("@/contracts/pipe").StageRole | null }) =>
  s.stage_role ?? "open";

/** Faixas de reunião (porte do quick-filter da Confirmação). */
type TimeFilter = "all" | "today" | "tomorrow" | "week" | "overdue";
const TIME_OPTIONS: { value: TimeFilter; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "tomorrow", label: "Amanhã" },
  { value: "week", label: "Semana" },
  { value: "overdue", label: "Atrasadas" },
];

/**
 * Dimensões que NÃO são universais (SCRUM-633) — portadas das páginas velhas
 * e ligadas por CAPACIDADE do funil, não por slug: faixas de reunião aparecem
 * quando o funil tem etapas de reunião; calor/prioridade/tipo de produto
 * quando o funil tem etapa `won` (é onde valor faz sentido); status-multi
 * sempre (qualquer board multi-coluna filtra por etapa).
 */
type ExtraFilterState = {
  timeFilter: TimeFilter;
  urgencyFilter: string;
  selectedStatuses: string[];
  productType: string;
  calor: string;
  priority: string;
};

const DEFAULT_EXTRA_FILTERS: ExtraFilterState = {
  timeFilter: "all",
  urgencyFilter: "all",
  selectedStatuses: [],
  productType: "all",
  calor: "all",
  priority: "all",
};

/**
 * Payload da saved view (SCRUM-634): o estado universal do controller + as
 * dimensões extras + busca + visão, num objeto serializável só. Range custom
 * de período carrega `Date` — revive na aplicação.
 */
type FunilBoardState = { [K in keyof FunilFilterState]: FunilFilterState[K] } &
  ExtraFilterState & {
    searchQuery: string;
    viewMode: FunilViewMode;
  };

/**
 * `/funil/:slug` — a página ÚNICA de funil (SCRUM-632 → fechada na SCRUM-637).
 *
 * Paridade rica com as 3 páginas de sistema, generalizada por `stage_role`:
 * fluxos de move com desfecho (`useFunilMoveFlow`), painel completo de filtros
 * (`useFunilFilters` + seções extras por capacidade), analytics por funil
 * (`FunilAnalytics` + `useFunilMetrics`), timeline de reuniões e recálculo D-x
 * quando o funil tem o trilho. As rotas `/pipe-*` viraram redirects pra cá.
 */
function FunilPageInner() {
  const { slug: param } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const { openDeal } = useDealSheet();
  const { organizationId } = useOrganization();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: pipelines = [], isLoading: loadingPipelines } = usePipelines();
  const pipeline = resolveFunil(pipelines, param);
  const ehCustom = pipeline?.type === "custom";
  const ehSystem = pipeline?.type === "system";
  /** Slug de sistema do trio legado — liga os portes específicos de família. */
  const trioSlug =
    ehSystem &&
    (pipeline?.slug === "whatsapp" || pipeline?.slug === "confirmacao" || pipeline?.slug === "propostas")
      ? pipeline.slug
      : null;

  useEffect(() => {
    // Mantém a série histórica dos 3 slugs (`pipe_*`); funil novo entra como `funil_*`.
    if (pipeline?.slug) {
      trackModuleVisit(trioSlug ? `pipe_${trioSlug}` : `funil_${pipeline.slug}`, organizationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline?.slug]);

  // Linha RICA do funil custom (lifecycle, metas, config) — os diálogos
  // reaproveitados (settings/delete/import) falam este shape.
  const { data: customRow } = useCustomPipeline(ehCustom ? pipeline?.slug : undefined);

  const { data: stages = [], isLoading: loadingStages } = useFunilStages(pipeline?.id);
  // Editor de etapas dos funis de sistema (PipeSettingsDialog fala o shape da
  // família por pipe_type — mesmo diálogo das páginas velhas). Hook incondicional
  // (regra de hooks); o resultado só é usado quando `trioSlug` existe.
  const { data: familyStages = [] } = usePipelineStages(trioSlug ?? "whatsapp");
  const responsibleMembers = useResponsibleMembers();
  // Workflows de funil de sistema seguem configurados por pipe_type — o badge
  // por slug entra como override no board (custom usa o badge por pipeline_id).
  const { data: systemWorkflowCounts = {} } = useStageWorkflowCounts(trioSlug ?? undefined);

  // ── Filtros: bloco universal (SCRUM-633) + dimensões extras por capacidade ─
  const controller = useFunilFilters(pipeline?.id);
  const [viewMode, setViewMode] = useState<FunilViewMode>("kanban");
  const [extra, setExtra] = useState<ExtraFilterState>(DEFAULT_EXTRA_FILTERS);
  const patchExtra = useCallback(
    (patch: Partial<ExtraFilterState>) => setExtra((s) => ({ ...s, ...patch })),
    [],
  );

  const overdueDays = useConfirmacaoOverdueDays();
  const { data: orgTags = [] } = useTags();

  const temEtapaMeeting = useMemo(
    () => stages.some((s) => roleDe(s) === "meeting_booked" || roleDe(s) === "meeting_held"),
    [stages],
  );
  const temEtapaWon = useMemo(
    () => stages.some((s) => roleDe(s) === "won" || (roleDe(s) === "open" && s.is_final_positive)),
    [stages],
  );
  /** Chaves de desfecho por PAPEL — âncora de período dos fechados (motor 633). */
  const closedStatusKeys = useMemo(
    () =>
      stages
        .filter(
          (s) =>
            roleDe(s) === "won" ||
            roleDe(s) === "lost" ||
            (roleDe(s) === "open" && (s.is_final_positive || s.is_final_negative)),
        )
        .map((s) => s.stage_key),
    [stages],
  );

  // Faixas de reunião → params server-side (mesma matemática da página velha).
  const timeParams = useMemo(() => {
    const now = new Date();
    if (extra.timeFilter === "today") {
      return { meetingAfter: startOfDay(now).toISOString(), meetingBefore: endOfDay(now).toISOString() };
    }
    if (extra.timeFilter === "tomorrow") {
      const t = addDays(now, 1);
      return { meetingAfter: startOfDay(t).toISOString(), meetingBefore: endOfDay(t).toISOString() };
    }
    if (extra.timeFilter === "week") {
      return {
        meetingAfter: startOfWeek(now, { locale: ptBR }).toISOString(),
        meetingBefore: endOfWeek(now, { locale: ptBR }).toISOString(),
      };
    }
    if (extra.timeFilter === "overdue") {
      const limit = new Date();
      limit.setDate(limit.getDate() - overdueDays);
      return {
        updatedBefore: limit.toISOString(),
        overdueExcludeStatusKeys: [...CONFIRMACAO_OVERDUE_EXCLUDE_STATUS_KEYS],
      };
    }
    return {};
  }, [extra.timeFilter, overdueDays]);

  const filters = useMemo<PaginatedFilters>(
    () => ({
      ...controller.paginatedFilters,
      urgency: extra.urgencyFilter !== "all" ? extra.urgencyFilter : undefined,
      statusKeys: extra.selectedStatuses.length ? extra.selectedStatuses : undefined,
      productType: extra.productType !== "all" ? extra.productType : undefined,
      ...priorityBandToRating(extra.priority),
      ...calorBandToBounds(extra.calor),
      // Âncora de período dos FECHADOS por stage_role (metrics_period_at →
      // fallback updated_at) — a mesma âncora canônica do motor de métricas.
      closedStatusKeys:
        controller.metricsRange && closedStatusKeys.length ? closedStatusKeys : undefined,
      ...timeParams,
    }),
    [controller.paginatedFilters, controller.metricsRange, extra, closedStatusKeys, timeParams],
  );

  const { stageData, isLoading: loadingBoard } = usePaginatedFunil(pipeline?.id, stages, filters);

  const allItems = useMemo(
    () => stages.flatMap((s) => stageData[s.stage_key]?.items ?? []),
    [stages, stageData],
  );

  // ── Métricas de funil (SCRUM-633) — alimentam o viewMode Analytics ────────
  const metrics = useFunilMetrics(pipeline?.id, controller.metricsRange);

  // ── Contadores por lead nos cards (comentários/checklists, 2 queries) ─────
  const loadedLeadIds = useMemo(
    () => [...new Set(allItems.filter((it: any) => it.lead_id).map((it: any) => it.lead_id as string))],
    [allItems],
  );
  const { data: metricsMap = {} } = useBatchedLeadMetrics(loadedLeadIds);

  // ── Fluxos ricos de move (por stage_role — SCRUM-637) ─────────────────────
  const findEntry = useCallback(
    (entryId: string): FunilFlowEntry | undefined =>
      allItems.find((e: any) => e.id === entryId) as FunilFlowEntry | undefined,
    [allItems],
  );
  const flow = useFunilMoveFlow({ pipeline, pipelines, stages, findEntry });

  const handleMove = useCallback(
    (entryId: string, stage: (typeof stages)[number]) => {
      flow.requestMove(entryId, stage);
    },
    [flow],
  );

  // ── Recálculo D-x: etapa segue a data da reunião (porte da Confirmação) ───
  const stageKeySet = useMemo(() => new Set(stages.map((s) => s.stage_key)), [stages]);
  const dxRunning = useRef(false);
  useEffect(() => {
    if (!flow.temTrilhoDx || allItems.length === 0 || dxRunning.current) return;
    dxRunning.current = true;
    (async () => {
      try {
        for (const item of allItems as any[]) {
          const meetingDate = item.meeting_date ? new Date(item.meeting_date) : null;
          const alvo = calcularEtapaPorDataDaReuniao(meetingDate, item.status);
          if (podeAplicarDx(stageKeySet, alvo) && alvo !== item.status) {
            try {
              await flow.updateEntryConfirmacao.mutateAsync({
                id: item.id,
                status: alvo as never,
                leadId: item.lead_id,
                assignedTo: item.sdr_id || item.closer_id,
              });
            } catch (error) {
              console.error("[Funil] Erro no recálculo D-x:", error);
            }
          }
        }
      } finally {
        dxRunning.current = false;
      }
    })();
    // Roda quando o volume carregado muda — mesmo guarda da página velha
    // contra loop infinito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.temTrilhoDx, allItems.length]);

  // ── Saved views (SCRUM-634): payload único e serializável ─────────────────
  const [activeViewId, setActiveViewId] = useState<string | null>(searchParams.get("view"));
  const handleActiveViewChange = useCallback(
    (viewId: string | null) => {
      setActiveViewId(viewId);
      setSearchParams(viewId ? { view: viewId } : {}, { replace: true });
    },
    [setSearchParams],
  );

  const currentBoardState = useMemo<FunilBoardState>(
    () => ({
      ...controller.state,
      ...extra,
      searchQuery: controller.search,
      viewMode,
    }),
    [controller.state, controller.search, extra, viewMode],
  );
  const defaultBoardState = useMemo<FunilBoardState>(
    () => ({
      ...createInitialFunilFilterState(),
      ...DEFAULT_EXTRA_FILTERS,
      searchQuery: "",
      viewMode: "kanban",
    }),
    [],
  );
  const applyBoardState = useCallback(
    (f: FunilBoardState) => {
      const { searchQuery, viewMode: vm, timeFilter, urgencyFilter, selectedStatuses, productType, calor, priority, ...universal } = f;
      controller.setState({
        ...universal,
        // Datas de range custom voltam do JSON como string — revive.
        period: revivePeriodState(universal.period as MetricsPeriodState),
      });
      setExtra({ timeFilter, urgencyFilter, selectedStatuses, productType, calor, priority });
      controller.setSearch(searchQuery ?? "");
      setViewMode(vm ?? "kanban");
    },
    [controller],
  );

  // ── Seções do painel: universais + extras por capacidade ──────────────────
  const filterSections: FilterSectionConfig[] = useMemo(() => {
    const extras: FilterSectionConfig[] = [];
    if (temEtapaMeeting) {
      extras.push({
        type: "single-choice",
        id: "time-bucket",
        label: "Reunião",
        value: extra.timeFilter,
        onChange: (v: string) => patchExtra({ timeFilter: v as TimeFilter }),
        options: TIME_OPTIONS,
        allValue: "all",
      });
      extras.push({ type: "urgency", value: extra.urgencyFilter, onChange: (v: string) => patchExtra({ urgencyFilter: v }) });
    }
    if (temEtapaWon) {
      extras.push({ type: "product-type", value: extra.productType, onChange: (v: string) => patchExtra({ productType: v }) });
      extras.push({ type: "calor", value: extra.calor, onChange: (v: string) => patchExtra({ calor: v }) });
      extras.push({ type: "priority", value: extra.priority, onChange: (v: string) => patchExtra({ priority: v }) });
    }
    if (stages.length > 1) {
      extras.push({
        type: "status-multi",
        value: extra.selectedStatuses,
        onChange: (v: string[]) => patchExtra({ selectedStatuses: v }),
        options: stages.map((s) => ({ id: s.stage_key, title: s.name, color: s.color || "#64748b" })),
      });
    }
    return [...controller.sections, ...extras];
  }, [controller.sections, extra, temEtapaMeeting, temEtapaWon, stages, patchExtra]);

  const handleClearFilters = useCallback(() => {
    // Busca e visão sobrevivem ao "limpar filtros" — mesmo recorte de sempre.
    controller.clearAll();
    setExtra(DEFAULT_EXTRA_FILTERS);
  }, [controller]);

  // ── Disparo: fonte "Filtro ativo" + seed manual do bulk (porte) ───────────
  const [isDisparoOpen, setIsDisparoOpen] = useState(false);
  const [disparoSource, setDisparoSource] = useState<DisparoSource>("estagio");
  const [disparoManualIds, setDisparoManualIds] = useState<string[]>([]);

  const disparoBoardFilter: DisparoBoardFilter = useMemo(() => {
    const chips: string[] = [];
    const term = controller.search.trim();
    if (term) chips.push(`Busca: "${term}"`);
    if (controller.state.responsibleId !== "all") {
      const member = controller.sections.find((s) => s.type === "responsible");
      const name =
        member && "members" in member
          ? member.members.find((m) => m.id === controller.state.responsibleId)?.name
          : undefined;
      chips.push(`Responsável: ${name ?? "selecionado"}`);
    }
    if (controller.state.tagIds.length > 0) {
      const names = controller.state.tagIds
        .map((id) => orgTags.find((t: any) => t.id === id)?.name)
        .filter(Boolean) as string[];
      if (names.length > 0) chips.push(`Tags: ${names.join(", ")}`);
    }
    return {
      search: controller.search,
      responsibleId: controller.state.responsibleId,
      tagIds: controller.state.tagIds,
      chips,
    };
  }, [controller.search, controller.state.responsibleId, controller.state.tagIds, controller.sections, orgTags]);

  const handleOpenDisparoStage = useCallback(() => {
    setDisparoManualIds([]);
    setDisparoSource("estagio");
    setIsDisparoOpen(true);
  }, []);
  const handleDispararManual = useCallback((leadIds: string[]) => {
    setDisparoManualIds(leadIds);
    setDisparoSource("manual");
    setIsDisparoOpen(true);
  }, []);

  // ── Criação por família (porte dos primaryActions das páginas velhas) ─────
  const [showAddLead, setShowAddLead] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSystemSettings, setShowSystemSettings] = useState(false);
  const [removeEntryId, setRemoveEntryId] = useState<string | null>(null);
  const [showCreateOpportunity, setShowCreateOpportunity] = useState(false);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const [showCreateMeeting, setShowCreateMeeting] = useState(false);
  const [showCreateProposal, setShowCreateProposal] = useState(false);

  const removeLead = useRemoveLeadFromCustomPipe();
  const deleteEntry = useDeleteEntry();
  // "Mover etapa pra lixeira" — o motor de delete em massa é chaveado pelas
  // views do trio; hook incondicional (regra de hooks), oferecido só no trio.
  const deleteAllLeadsInPipe = useDeleteAllLeadsInPipe(trioSlug ?? "whatsapp");
  const [stageToDelete, setStageToDelete] = useState<{ id: string; title: string } | null>(null);
  const { allowed: canDeleteCards } = useFeaturePermission("pipeline.delete_cards");

  const isLoading = loadingPipelines || loadingStages;

  // ── Mobile: lista por stage ───────────────────────────────────────────────
  const { isMobile } = useViewport();
  const mobileStages = useMemo(
    () => stages.map((s) => ({ id: s.id, name: s.name, stage_key: s.stage_key, color: s.color ?? undefined })),
    [stages],
  );
  const mobileLeads = useMemo(
    () =>
      stages.flatMap((s) =>
        ((stageData[s.stage_key]?.items ?? []) as FunilEntry[]).map((e) => ({
          id: e.id,
          name: e.lead?.name || "Sem nome",
          company: e.lead?.company || undefined,
          phone: e.lead?.phone || undefined,
          rating: e.lead?.rating || 0,
          stage_key: e.stage_key,
          created_at: e.created_at,
        })),
      ),
    [stages, stageData],
  );
  const handleMobileLeadClick = useCallback(
    (entryId: string) => {
      const entry = findEntry(entryId);
      if (entry?.lead_id) openDeal(entry.id, entry.lead_id);
    },
    [findEntry, openDeal],
  );
  const handleMobileMove = useCallback(
    (entryId: string, stageKey: string) => {
      const stage = stages.find((s) => s.stage_key === stageKey);
      if (stage) handleMove(entryId, stage);
    },
    [stages, handleMove],
  );

  const handleRemoveEntry = async () => {
    if (!removeEntryId || !pipeline) return;
    try {
      if (ehCustom) {
        await removeLead.mutateAsync({ entry_id: removeEntryId, pipeline_id: pipeline.id });
      } else {
        await deleteEntry.mutateAsync(removeEntryId);
      }
      toast.success("Lead removido do funil");
      setRemoveEntryId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover lead");
    }
  };

  // Timeline: entradas com reunião, fora das etapas de desfecho (por PAPEL).
  const timelineItems = useMemo(() => {
    const closed = new Set(closedStatusKeys);
    return (allItems as any[]).filter((it) => it.meeting_date && !closed.has(it.status));
  }, [allItems, closedStatusKeys]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <AlertTriangle className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Funil não encontrado</h2>
        <Button variant="outline" onClick={() => navigate("/funis")}>
          Ver todos os funis
        </Button>
      </div>
    );
  }

  const PipeIcon = funilIcon(pipeline.icon);
  const periodRange = controller.metricsRange;

  const viewOptions: { value: FunilViewMode; icon: typeof LayoutGrid; label: string }[] = [
    { value: "kanban", icon: LayoutGrid, label: "Kanban" },
    { value: "list", icon: List, label: "Lista" },
    ...(temEtapaMeeting ? [{ value: "timeline" as const, icon: CalendarIcon, label: "Timeline" }] : []),
    { value: "analytics", icon: BarChart3, label: "Analytics" },
  ];

  const primaryAction = ehCustom ? (
    <Button size="sm" className="h-9 gradient-gold" onClick={() => setShowAddLead(true)}>
      <Plus className="w-4 h-4 mr-2" />
      Adicionar Lead
    </Button>
  ) : trioSlug === "whatsapp" ? (
    <Button size="sm" className="h-9 gradient-gold" onClick={() => setShowCreateOpportunity(true)}>
      <Plus className="w-4 h-4 mr-2" />
      Novo negócio
    </Button>
  ) : trioSlug === "confirmacao" ? (
    <Button size="sm" className="h-9 gradient-gold" onClick={() => setShowCreateMeeting(true)}>
      <Plus className="w-4 h-4 mr-2" />
      Nova Reunião
    </Button>
  ) : trioSlug === "propostas" ? (
    <Button size="sm" className="h-9 gradient-gold" onClick={() => setShowCreateProposal(true)}>
      <Plus className="w-4 h-4 mr-2" />
      Nova Proposta
    </Button>
  ) : undefined;

  return (
    <div className="space-y-4">
      <FunnelControlBar
        funnelKey={ehCustom ? `custom:${pipeline.id}` : `sys:${pipeline.slug}`}
        funnelLabel={pipeline.name}
        funnelColor={pipeline.color}
        search={controller.search}
        onSearchChange={controller.setSearch}
        views={
          <FunnelViewsMenu
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            viewOptions={viewOptions}
            pipelineId={pipeline.id}
            currentFilters={currentBoardState}
            defaultFilters={defaultBoardState}
            onApplyFilters={applyBoardState}
            activeViewId={activeViewId}
            onActiveViewChange={handleActiveViewChange}
          />
        }
        filters={
          <>
            <PipeIcon
              className="hidden size-4 shrink-0 sm:block"
              style={{ color: pipeline.color }}
              aria-hidden
            />
            {stages.length > 0 && viewMode !== "analytics" && (
              <KanbanFilterPanel sections={filterSections} onClearAll={handleClearFilters} />
            )}
          </>
        }
        actions={
          <>
            {ehCustom && customRow && (
              <Button size="sm" variant="ghost" className="h-9" onClick={() => setShowSettings(true)}>
                <Settings2 className="w-4 h-4 mr-2" />
                Configurações
              </Button>
            )}
            {trioSlug && (
              <Button size="sm" variant="ghost" className="h-9" onClick={() => setShowSystemSettings(true)}>
                <Settings2 className="w-4 h-4 mr-2" />
                Configurações
              </Button>
            )}

            {stages.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 px-2"
                    aria-label="Mais ações do funil"
                    data-testid="funnel-overflow"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem onClick={handleOpenDisparoStage}>
                    <Send className="w-4 h-4 mr-2 text-primary" />
                    Disparo
                  </DropdownMenuItem>
                  {trioSlug === "whatsapp" && (
                    <DropdownMenuItem onClick={() => setShowCreateLead(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      Novo lead
                    </DropdownMenuItem>
                  )}
                  {trioSlug && (
                    <>
                      <DropdownMenuSeparator />
                      <div className="px-2 py-1.5">
                        <AutoCreateLeadToggle />
                      </div>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
        primaryAction={primaryAction}
        chips={
          viewMode !== "analytics" ? (
            <FilterChips sections={filterSections} onClearAll={handleClearFilters} />
          ) : null
        }
      />

      {pipeline.description && (
        <p className="-mt-2 truncate text-sm text-muted-foreground">{pipeline.description}</p>
      )}

      {/* Sem GhostLeadsBanner de propósito: `get_pipeline_page` usa INNER JOIN
          com `leads` sob RLS — entry cujo lead o usuário não enxerga nem chega
          na tela, e a contagem da coluna sai do MESMO recorte. */}

      {/* Indicador de período ativo (porte das páginas velhas) */}
      {viewMode !== "analytics" && periodRange && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground">
          <CalendarIcon className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            Exibindo cards criados em{" "}
            <span className="text-foreground font-medium">{formatPeriodLabel(periodRange)}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              controller.setState((s) => ({ ...s, period: createInitialPeriodState() }))
            }
          >
            Ver todos
          </Button>
        </div>
      )}

      {stages.length > 0 ? (
        viewMode === "analytics" ? (
          <FunilAnalytics
            pipeline={pipeline}
            stages={stages}
            stageData={stageData}
            allItems={allItems}
            metrics={metrics}
            periodRange={periodRange}
            responsibleMembers={responsibleMembers}
          />
        ) : viewMode === "timeline" ? (
          <MeetingTimeline
            meetings={timelineItems}
            onMeetingClick={(meeting) => {
              if (meeting.lead_id) openDeal(meeting.id, meeting.lead_id);
            }}
          />
        ) : isMobile || viewMode === "list" ? (
          <PipelineListView
            stages={mobileStages}
            leads={mobileLeads}
            onLeadClick={handleMobileLeadClick}
            onMoveLeadToStage={handleMobileMove}
            isLoading={loadingBoard}
          />
        ) : (
          <FunilKanban
            pipelineId={pipeline.id}
            stages={stages}
            stageData={stageData}
            onMove={handleMove}
            onRemoveEntry={canDeleteCards ? (id) => setRemoveEntryId(id) : undefined}
            onClickEntry={(entry) => openDeal(entry.id, entry.lead_id)}
            metricsMap={metricsMap}
            onDisparar={handleDispararManual}
            onDeleteAllLeads={
              trioSlug
                ? (stageKey, stageTitle) => setStageToDelete({ id: stageKey, title: stageTitle })
                : undefined
            }
            renderStageBadge={
              trioSlug
                ? (col) => {
                    const allCounts = systemWorkflowCounts["__all__"] || { total: 0, active: 0 };
                    const stageCounts = systemWorkflowCounts[col.id] || { total: 0, active: 0 };
                    return (
                      <StageWorkflowsBadgeWrapper
                        pipeType={trioSlug}
                        stageKey={col.id}
                        stageName={col.title}
                        counts={{
                          total: stageCounts.total + allCounts.total,
                          active: stageCounts.active + allCounts.active,
                        }}
                      />
                    );
                  }
                : undefined
            }
          />
        )
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Kanban className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">Nenhuma etapa configurada</p>
          {ehCustom && customRow ? (
            <>
              <p className="text-sm mt-1">Abra as configurações para criar etapas.</p>
              <Button variant="outline" className="mt-4" onClick={() => setShowSettings(true)}>
                <Settings2 className="w-4 h-4 mr-2" />
                Configurar Etapas
              </Button>
            </>
          ) : (
            <p className="text-sm mt-1">Este funil ainda não tem etapas ativas.</p>
          )}
        </div>
      )}

      {/* Diálogos dos fluxos ricos de move (won/lost/reunião/destinos) */}
      {flow.dialogs}

      {/* Modals de criação/gestão por família */}
      {ehCustom && pipeline && stages.length > 0 && (
        <AddLeadToPipeModal
          open={showAddLead}
          onOpenChange={setShowAddLead}
          pipelineId={pipeline.id}
          pipelineName={pipeline.name}
          stages={stages}
        />
      )}

      {ehCustom && customRow && (
        <CustomPipeSettingsDialog
          open={showSettings}
          onOpenChange={setShowSettings}
          pipeline={customRow}
          stages={stages}
        />
      )}

      {trioSlug && (
        <PipeSettingsDialog
          open={showSystemSettings}
          onOpenChange={setShowSystemSettings}
          pipeType={trioSlug}
          stages={familyStages}
        />
      )}

      {trioSlug === "whatsapp" && (
        <>
          <CreateOpportunityModal
            open={showCreateOpportunity}
            onOpenChange={setShowCreateOpportunity}
            onSuccess={() => {}}
          />
          <LeadModal
            open={showCreateLead}
            onOpenChange={setShowCreateLead}
            lead={null}
            onSuccess={() => {}}
          />
        </>
      )}

      {trioSlug === "confirmacao" && (
        <AddMeetingModal
          open={showCreateMeeting}
          onOpenChange={setShowCreateMeeting}
          onSuccess={() => {}}
        />
      )}

      {trioSlug === "propostas" && (
        <CreateProposalModal
          open={showCreateProposal}
          onOpenChange={setShowCreateProposal}
          onSuccess={() => {}}
        />
      )}

      {isDisparoOpen && pipeline && (
        <DisparoWizard
          open={isDisparoOpen}
          onOpenChange={setIsDisparoOpen}
          context={
            /* Kind canônico da fatia B: UM pipelineId serve qualquer funil —
               os shapes legados (system/custom) seguem aceitos na leitura. */
            { kind: "pipeline", pipelineId: pipeline.id }
          }
          boardFilter={disparoBoardFilter}
          initialSource={disparoSource}
          initialManualLeadIds={disparoManualIds}
        />
      )}

      {/* Mover leads de uma etapa pra lixeira (trio de sistema) */}
      <AlertDialog open={!!stageToDelete} onOpenChange={(open) => { if (!open) setStageToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mover leads da etapa "{stageToDelete?.title}" para lixeira</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os leads da etapa "{stageToDelete?.title}" serão movidos para a lixeira. Leads em
              outras etapas não serão afetados. Você pode restaurá-los pela página de lixeira.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!stageToDelete) return;
                try {
                  const result = await deleteAllLeadsInPipe.mutateAsync({ stageId: stageToDelete.id });
                  setStageToDelete(null);
                  toast.success(
                    result?.deleted
                      ? `${result.deleted} leads movidos para lixeira.`
                      : "Leads movidos para lixeira.",
                  );
                } catch {
                  toast.error("Erro ao mover leads para lixeira.");
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteAllLeadsInPipe.isPending ? "Movendo para lixeira..." : "Mover para lixeira"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar remoção de lead */}
      <AlertDialog open={!!removeEntryId} onOpenChange={() => setRemoveEntryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Lead do Funil</AlertDialogTitle>
            <AlertDialogDescription>
              O lead será removido deste funil, mas continuará existindo no sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveEntry}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {(removeLead.isPending || deleteEntry.isPending) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function FunilPage() {
  const { slug: param } = useParams<{ slug: string }>();
  const { hasFeature } = useOrgFeatures();

  // Agendamentos foi mergeado em Oportunidades — board standalone aposentado
  // (ADR-0004). Mesma guarda que a página velha de Confirmação carregava.
  if (param === "confirmacao" && hasFeature("merged_opportunity_funnel")) {
    return <Navigate to="/funis" replace />;
  }

  return (
    <LeadPanelProvider>
      <DealPanelProvider>
        <LeadPanelLayout
          panel={
            <>
              <DealCardPanel />
              <LeadCardPanel />
            </>
          }
        >
          <FunilPageInner />
        </LeadPanelLayout>
      </DealPanelProvider>
    </LeadPanelProvider>
  );
}
