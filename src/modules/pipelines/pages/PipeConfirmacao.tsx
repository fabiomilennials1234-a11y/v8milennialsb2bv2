import { useState, useMemo, useEffect, useCallback } from "react";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { Plus, Calendar, LayoutGrid, List, BarChart3, Settings2, Send, MoreHorizontal } from "lucide-react";
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
import { DraggableKanbanBoard, DraggableItem, KanbanColumn } from "@/modules/pipelines/components/kanban/DraggableKanbanBoard";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { useCanDo } from "@/modules/identity";
import { StageWorkflowsBadgeWrapper } from "@/modules/pipelines/components/kanban/StageWorkflowsBadgeWrapper";
import { useStageWorkflowCounts } from "@/modules/workflows/hooks/useStageWorkflows";
import { usePipeConfirmacao, useUpdatePipeConfirmacao, useCreatePipeConfirmacao, useDeletePipeConfirmacao, PipeConfirmacaoStatus } from "@/modules/pipelines/hooks/legacy/usePipeConfirmacao";
import { usePipelineStages, stagesToColumns, getPipelineTypeName } from "@/modules/pipelines/hooks/model/usePipelineStages";
import { upsertLeadIntoCustomPipe } from "@/modules/pipelines/lib/stageTransition";
import { moverNegocio, invalidateAfterMove } from "@/modules/pipelines/lib/moverNegocio";
import { usePipelineId } from "@/modules/pipelines/hooks/model/usePipelineEntries";
import { useQueryClient } from "@tanstack/react-query";
import { usePaginatedPipeline } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";
import { PipeSettingsDialog } from "@/modules/pipelines/components/shared/PipeSettingsDialog";
import { useDeleteAllLeadsInPipe, useUpdateLead } from "@/modules/leads";
import { useResponsibleMembers } from "@/modules/identity";
import { LeadModal } from "@/modules/leads";
import { AddMeetingModal } from "@/modules/pipelines/components/legacy/confirmacao/AddMeetingModal";
import { RescheduleModal } from "@/modules/pipelines/components/legacy/confirmacao/RescheduleModal";
import { FunnelControlBar } from "@/modules/pipelines/components/shared/FunnelControlBar";
import { FunnelViewsMenu } from "@/modules/pipelines/components/shared/FunnelViewsMenu";
import { AutoCreateLeadToggle } from "@/modules/pipelines/components/shared/AutoCreateLeadToggle";
import { PipeConfirmacaoAnalytics } from "@/modules/pipelines/components/shared/PipeConfirmacaoAnalytics";
import { type MetricsPeriodState, getDateRange, createInitialPeriodState } from "@/lib/metrics-period";
import {
  getStalledBucket,
  STALLED_ALL,
  STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES,
} from "@/modules/pipelines/lib/stalled-buckets";
import { GhostLeadsBanner } from "@/modules/pipelines/components/shared/GhostLeadsBanner";
import { LeadCard, type LeadCardData } from "@/modules/leads";
import {
  DealPanelProvider,
  useDealSheet,
  LeadPanelProvider,
  DealCardPanel,
  LeadCardPanel,
} from "@/modules/leads";
import { LeadPanelLayout } from "@/modules/platform/components/layout/LeadPanelLayout";
import { KanbanFilterPanel, FilterChips, type FilterSectionConfig } from "@/modules/pipelines/components/kanban/KanbanFilterPanel";
import { MeetingTimeline } from "@/modules/pipelines/components/legacy/confirmacao/MeetingTimeline";
import { CompareceuModal } from "@/modules/leads";
import { ExportStageDialog } from "@/modules/pipelines/components/kanban/ExportStageDialog";
import { useConfirmacaoOverdueDays } from "@/modules/identity";
import { format, isToday, startOfWeek, endOfWeek, isPast, startOfDay, endOfDay, addDays, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { useCreateAcaoDoDia } from "@/modules/engagement/hooks/useAcoesDoDia";
import { toast } from "sonner";
import { useOrganization } from "@/modules/identity";
import { track, trackModuleVisit } from "@/lib/analytics";
import { useFeaturePermission } from "@/modules/identity";
import { useIdentity } from "@/modules/identity";
import { useTags } from "@/modules/leads/hooks/useTags";
import { useBulkSelection } from "@/shared/hooks/useBulkSelection";
import { BulkActionBar } from "@/modules/leads/components/bulk-actions/BulkActionBar";
import { DisparoWizard, type DisparoBoardFilter, type DisparoSource } from "@/modules/pipelines/components/disparo";
import { useSearchParams, Navigate } from "react-router-dom";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { CONFIRMACAO_OVERDUE_EXCLUDE_STATUS_KEYS } from "@/modules/pipelines/lib/kanbanFilterParams";

// Filter type aliases (previously from ConfirmacaoFilters)
type OriginFilter = "all" | "whatsapp" | "meta_ads" | "instagram" | "tiktok" | "google_ads" | "site" | "landing_page" | "remarketing" | "indicacao" | "evento" | "prospeccao_ativa" | "cal" | "outro";
type TimeFilter = "all" | "today" | "tomorrow" | "week" | "overdue";
type UrgencyFilter = "all" | "imediato" | "1-mes" | "2-3-meses" | "6-meses";

// Time quick-filter options (inline buttons, not in Sheet)
const timeOptions: { value: TimeFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "today", label: "Hoje" },
  { value: "tomorrow", label: "Amanhã" },
  { value: "week", label: "Semana" },
  { value: "overdue", label: "Atrasadas" },
];

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function formatPeriodLabel(range: { startStr: string; endStr: string }): string {
  const [sy, sm, sd] = range.startStr.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = range.endStr.slice(0, 10).split("-").map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  if (sy === ey) return `${sd} ${MONTHS_PT[sm - 1]} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  return `${sd} ${MONTHS_PT[sm - 1]} ${sy} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
}

// Calculate correct status based on meeting date using CALENDAR DAYS (not hours)
// Note: pre_confirmada and confirmada_no_dia are NOT used as statuses anymore
// They are visual states controlled by is_confirmed field
function calculateStatusByDate(meetingDate: Date | null, currentStatus: PipeConfirmacaoStatus): PipeConfirmacaoStatus | null {
  if (!meetingDate) return null;

  // Don't auto-update terminal statuses
  if (["compareceu", "perdido", "remarcar"].includes(currentStatus)) {
    // Check if remarcar should be updated (meeting date was changed to future)
    if (currentStatus === "remarcar") {
      if (!isPast(startOfDay(meetingDate)) || isToday(meetingDate)) {
        // Meeting is no longer overdue, recalculate
      } else {
        return null; // Still overdue
      }
    } else {
      return null;
    }
  }

  const today = startOfDay(new Date());
  const meetingDay = startOfDay(meetingDate);

  // Use differenceInCalendarDays to count actual calendar days, not 24h periods
  const calendarDays = differenceInCalendarDays(meetingDay, today);

  // If meeting day is in the past (negative days), it's overdue - should remarcar
  if (calendarDays < 0) {
    return "remarcar";
  }

  // If meeting is today (0 days)
  if (calendarDays === 0) {
    return "confirmacao_no_dia";
  }

  // If meeting is tomorrow (1 day) - D-1
  if (calendarDays === 1) {
    return "confirmar_d1";
  }

  // If meeting is in 2 days - D-2
  if (calendarDays === 2) {
    return "confirmar_d2";
  }

  // If meeting is in 3 days - D-3
  if (calendarDays === 3) {
    return "confirmar_d3";
  }

  // If meeting is in 4-5 days - D-5
  if (calendarDays === 4 || calendarDays === 5) {
    return "confirmar_d5";
  }

  // If meeting is more than 5 days away
  if (calendarDays > 5) {
    return "reuniao_marcada";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Persisted filter state — scoped per org + user, TTL 24 h
// ---------------------------------------------------------------------------
type ConfirmacaoFilterState = {
  searchQuery: string;
  originFilter: OriginFilter;
  timeFilter: TimeFilter;
  urgencyFilter: UrgencyFilter;
  selectedStatuses: string[];
  selectedTags: string[];
  selectedQualificationTier: string[];
  selectedPreQualificationTier: string[];
  selectedResponsibleId: string;
  /** Data de criação. Saiu do cabeçalho pro painel de Filtros (protótipo). */
  periodState: MetricsPeriodState;
  /** Dias na etapa atual — id de `STALLED_BUCKETS`, ou "all". */
  filterStalled: string;
  viewMode: "kanban" | "timeline" | "analytics";
  membroDefaultApplied?: boolean;
};

const DEFAULT_CONFIRMACAO_FILTERS: ConfirmacaoFilterState = {
  searchQuery: "",
  originFilter: "all",
  timeFilter: "all",
  urgencyFilter: "all",
  selectedStatuses: [],
  selectedTags: [],
  selectedQualificationTier: [],
  selectedPreQualificationTier: [],
  selectedResponsibleId: "all",
  periodState: createInitialPeriodState(),
  filterStalled: STALLED_ALL,
  viewMode: "kanban",
  membroDefaultApplied: false,
};

function PipeConfirmacaoInner() {
  const [filterState, setFilterState] = usePersistedState(
    "confirmacao",
    DEFAULT_CONFIRMACAO_FILTERS
  );

  const {
    searchQuery,
    originFilter,
    timeFilter,
    urgencyFilter,
    selectedStatuses,
    selectedTags,
    selectedQualificationTier,
    selectedPreQualificationTier,
    selectedResponsibleId,
    periodState,
    filterStalled,
    viewMode,
  } = filterState;

  const setSearchQuery = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, searchQuery: v })),
    [setFilterState]
  );
  const setOriginFilter = useCallback(
    (v: OriginFilter) => setFilterState((f) => ({ ...f, originFilter: v })),
    [setFilterState]
  );
  const setTimeFilter = useCallback(
    (v: TimeFilter) => setFilterState((f) => ({ ...f, timeFilter: v })),
    [setFilterState]
  );
  const setUrgencyFilter = useCallback(
    (v: UrgencyFilter) => setFilterState((f) => ({ ...f, urgencyFilter: v })),
    [setFilterState]
  );
  const setSelectedStatuses = useCallback(
    (v: string[]) => setFilterState((f) => ({ ...f, selectedStatuses: v })),
    [setFilterState]
  );
  const setSelectedTags = useCallback(
    (v: string[]) => setFilterState((f) => ({ ...f, selectedTags: v })),
    [setFilterState]
  );
  const setSelectedQualificationTier = useCallback(
    (v: string[]) => setFilterState((f) => ({ ...f, selectedQualificationTier: v })),
    [setFilterState]
  );
  const setSelectedPreQualificationTier = useCallback(
    (v: string[]) => setFilterState((f) => ({ ...f, selectedPreQualificationTier: v })),
    [setFilterState]
  );
  const setSelectedResponsibleId = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, selectedResponsibleId: v })),
    [setFilterState]
  );
  const setPeriodState = useCallback(
    (v: MetricsPeriodState) => setFilterState((f) => ({ ...f, periodState: v })),
    [setFilterState]
  );
  const setFilterStalled = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, filterStalled: v })),
    [setFilterState]
  );
  const setViewMode = useCallback(
    (v: "kanban" | "timeline" | "analytics") => setFilterState((f) => ({ ...f, viewMode: v })),
    [setFilterState]
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeViewId, setActiveViewId] = useState<string | null>(searchParams.get("view"));
  const handleActiveViewChange = useCallback((viewId: string | null) => {
    setActiveViewId(viewId);
    setSearchParams(viewId ? { view: viewId } : {}, { replace: true });
  }, [setSearchParams]);
  const [filterScheduled, setFilterScheduled] = useState(false);

  // Filtro defensivo: membros começam vendo só os próprios leads. Admin/Master veem tudo.
  const { teamMemberId } = useOrganization();
  const { isAdmin, isMaster } = useIdentity();
  useEffect(() => {
    if (filterState.membroDefaultApplied) return;
    if (!teamMemberId || isAdmin || isMaster) return;
    setFilterState((f) => ({
      ...f,
      selectedResponsibleId: f.selectedResponsibleId === "all" ? teamMemberId : f.selectedResponsibleId,
      membroDefaultApplied: true,
    }));
  }, [teamMemberId, isAdmin, isMaster, filterState.membroDefaultApplied, setFilterState]);

  const { openDeal } = useDealSheet();
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [isMeetingModalOpen, setIsMeetingModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDisparoOpen, setIsDisparoOpen] = useState(false);
  const [disparoSource, setDisparoSource] = useState<DisparoSource>("estagio");
  const [disparoManualIds, setDisparoManualIds] = useState<string[]>([]);
  const [editingLead, setEditingLead] = useState<any>(null);

  // Reschedule modal state
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);
  const [pendingRescheduleItem, setPendingRescheduleItem] = useState<any>(null);

  // Compareceu modal state
  const [isCompareceuModalOpen, setIsCompareceuModalOpen] = useState(false);
  const [pendingCompareceuItem, setPendingCompareceuItem] = useState<any>(null);
  const [isProcessingCompareceu, setIsProcessingCompareceu] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pipeId: string; leadId: string } | null>(null);
  const [deleteAllLeadsDialogOpen, setDeleteAllLeadsDialogOpen] = useState(false);
  const [stageToDelete, setStageToDelete] = useState<{ id: string; title: string } | null>(null);
  const [stageToExport, setStageToExport] = useState<{ id: string; title: string; count: number } | null>(null);

  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  useEffect(() => { trackModuleVisit("pipe_confirmacao", organizationId); }, []);

  const overdueDays = useConfirmacaoOverdueDays();
  const { data: pipelineStages = [] } = usePipelineStages("confirmacao");
  const metricsRange = useMemo(() => getDateRange(periodState), [periodState]);
  const stalledBucket = useMemo(
    () => (STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES ? getStalledBucket(filterStalled) : null),
    [filterStalled],
  );
  // Time bucket → generic server params (meeting-date range, or overdue =
  // stale updated_at excluding compareceu/perdido). Mirrors the legacy client
  // logic; timezone math stays here so the RPC only does range comparisons.
  const timeParams = useMemo(() => {
    const now = new Date();
    if (timeFilter === "today") {
      return { meetingAfter: startOfDay(now).toISOString(), meetingBefore: endOfDay(now).toISOString() };
    }
    if (timeFilter === "tomorrow") {
      const t = addDays(now, 1);
      return { meetingAfter: startOfDay(t).toISOString(), meetingBefore: endOfDay(t).toISOString() };
    }
    if (timeFilter === "week") {
      return {
        meetingAfter: startOfWeek(now, { locale: ptBR }).toISOString(),
        meetingBefore: endOfWeek(now, { locale: ptBR }).toISOString(),
      };
    }
    if (timeFilter === "overdue") {
      const limit = new Date();
      limit.setDate(limit.getDate() - overdueDays);
      return {
        updatedBefore: limit.toISOString(),
        overdueExcludeStatusKeys: [...CONFIRMACAO_OVERDUE_EXCLUDE_STATUS_KEYS],
      };
    }
    return {};
  }, [timeFilter, overdueDays]);
  const { stageData, allItems: pipeData, isLoading } = usePaginatedPipeline(
    "confirmacao",
    pipelineStages,
    {
      search: searchQuery,
      responsibleId: selectedResponsibleId,
      tagIds: selectedTags,
      // Client-only dimensions, now resolved server-side so the column count
      // matches the filtered cards (origin / urgency / status / scheduled /
      // period / time bucket / tier).
      origins: originFilter !== "all" ? [originFilter] : undefined,
      urgency: urgencyFilter !== "all" ? urgencyFilter : undefined,
      statusKeys: selectedStatuses.length ? selectedStatuses : undefined,
      qualificationTier: selectedQualificationTier,
      preQualificationTier: selectedPreQualificationTier,
      scheduled: filterScheduled || undefined,
      periodAfter: metricsRange?.startStr ?? undefined,
      periodBefore: metricsRange?.endStr ?? undefined,
      stalledMinDays: stalledBucket?.minDays ?? null,
      stalledMaxDays: stalledBucket?.maxDays ?? null,
      ...timeParams,
    }
  );
  const refetch = useCallback(() => {}, []);
  const { data: workflowCounts = {} } = useStageWorkflowCounts("confirmacao");
  const responsibleMembers = useResponsibleMembers();
  const { data: orgTags = [] } = useTags();
  const bulk = useBulkSelection();
  const allLeadIds = useMemo(() => {
    if (!pipeData) return [];
    return pipeData.filter(item => item.lead).map(item => item.lead_id);
  }, [pipeData]);
  const updatePipeConfirmacao = useUpdatePipeConfirmacao();
  const { allowed: canMovePipe } = useCanDo("move_pipe_record");
  // O funil de destino do "compareceu". A tela precisa do id porque o move é uma
  // troca de `pipeline_id` — antes só o hook de criação conhecia esse id, e por
  // isso a tela não tinha como mover, só como criar card novo.
  const { data: propostasPipelineId } = usePipelineId("propostas");
  const createPipeConfirmacao = useCreatePipeConfirmacao();
  const deletePipeConfirmacao = useDeletePipeConfirmacao();
  const deleteAllLeadsInPipe = useDeleteAllLeadsInPipe("confirmacao");
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const createAcaoDoDia = useCreateAcaoDoDia();
  const { allowed: canDeleteCards } = useFeaturePermission("pipeline.delete_cards");

  // Transform team members for filter
  const teamMemberOptions = useMemo(() =>
    responsibleMembers.map(m => ({ id: m.id, name: m.name, role: m.role })),
    [responsibleMembers]
  );

  // Converte etapas do banco para o formato do Kanban (com fallback)
  const statusColumns = useMemo(() => {
    if (pipelineStages.length === 0) {
      // Fallback para etapas padrão enquanto carrega
      return [
        { id: "reuniao_marcada", title: "Reunião Marcada", color: "#6366f1" },
        { id: "confirmar_d5", title: "Confirmar D-5", color: "#8b5cf6" },
        { id: "confirmar_d3", title: "Confirmar D-3", color: "#a855f7" },
        { id: "confirmar_d2", title: "Confirmar D-2", color: "#f59e0b" },
        { id: "confirmar_d1", title: "Confirmar D-1", color: "#f97316" },
        { id: "confirmacao_no_dia", title: "Confirmação no Dia", color: "#ef4444" },
        { id: "remarcar", title: "Remarcar 📅", color: "#f97316" },
        { id: "compareceu", title: "Compareceu ✓", color: "#22c55e" },
        { id: "perdido", title: "Perdido ✗", color: "#ef4444" },
      ];
    }
    return stagesToColumns(pipelineStages);
  }, [pipelineStages]);

  // Build declarative sections for KanbanFilterPanel (Sheet filters)
  const filterSections: FilterSectionConfig[] = useMemo(() => [
    // Os dois filtros de tempo do redesenho, mais a faixa de reunião que antes
    // era uma fileira de botões solta no cabeçalho — todo filtro num lugar só.
    { type: "created-period", value: periodState, onChange: setPeriodState },
    // "Parado há" só entra com a migration 20270729000010 aplicada — ver
    // STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES.
    ...(STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES
      ? [{ type: "stalled-days", value: filterStalled, onChange: setFilterStalled } as const]
      : []),
    {
      type: "single-choice",
      id: "time-bucket",
      label: "Reunião",
      value: timeFilter,
      onChange: setTimeFilter as (v: string) => void,
      options: timeOptions.filter((o) => o.value !== "all"),
      allValue: "all",
    },
    { type: "responsible", value: selectedResponsibleId, onChange: setSelectedResponsibleId, members: responsibleMembers },
    { type: "origin-single", value: originFilter, onChange: setOriginFilter as (v: string) => void },
    { type: "tags", value: selectedTags, onChange: setSelectedTags, tags: orgTags },
    { type: "qualification-tier", value: selectedQualificationTier, onChange: setSelectedQualificationTier },
    { type: "pre-qualification-tier", value: selectedPreQualificationTier, onChange: setSelectedPreQualificationTier },
    { type: "urgency", value: urgencyFilter, onChange: setUrgencyFilter as (v: string) => void },
    { type: "status-multi", value: selectedStatuses, onChange: setSelectedStatuses, options: statusColumns },
    { type: "scheduled", value: filterScheduled, onChange: setFilterScheduled },
  ], [periodState, filterStalled, timeFilter, selectedResponsibleId, originFilter, selectedTags, selectedQualificationTier, selectedPreQualificationTier, urgencyFilter, selectedStatuses, filterScheduled, responsibleMembers, orgTags, statusColumns, setPeriodState, setFilterStalled, setTimeFilter, setSelectedResponsibleId, setOriginFilter, setSelectedTags, setSelectedQualificationTier, setSelectedPreQualificationTier, setUrgencyFilter, setSelectedStatuses]);

  const handleClearAllFilters = useCallback(() => {
    setOriginFilter("all" as OriginFilter);
    setTimeFilter("all" as TimeFilter);
    setUrgencyFilter("all" as UrgencyFilter);
    setSelectedStatuses([]);
    setSelectedTags([]);
    setSelectedQualificationTier([]);
    setSelectedPreQualificationTier([]);
    setSelectedResponsibleId("all");
    setFilterScheduled(false);
    setPeriodState(createInitialPeriodState());
    setFilterStalled(STALLED_ALL);
  }, [setOriginFilter, setTimeFilter, setUrgencyFilter, setSelectedStatuses, setSelectedTags, setSelectedQualificationTier, setSelectedPreQualificationTier, setSelectedResponsibleId, setPeriodState, setFilterStalled]);

  // Board filter handed to the Disparo "Filtro ativo" source. Mirrors EXACTLY
  // the dimensions usePaginatedPipeline resolves server-side (search,
  // responsible, tags) — origin/urgency/time/status/scheduled are page-only and
  // deliberately excluded. Chips carry human labels (page owns the dictionaries).
  const disparoBoardFilter: DisparoBoardFilter = useMemo(() => {
    const chips: string[] = [];
    const term = searchQuery.trim();
    if (term) chips.push(`Busca: "${term}"`);
    if (selectedResponsibleId && selectedResponsibleId !== "all") {
      const member = responsibleMembers.find((m: any) => m.id === selectedResponsibleId);
      chips.push(`Responsável: ${member?.name ?? "selecionado"}`);
    }
    if (selectedTags.length > 0) {
      const names = selectedTags
        .map((id) => orgTags.find((t: any) => t.id === id)?.name)
        .filter(Boolean) as string[];
      if (names.length > 0) chips.push(`Tags: ${names.join(", ")}`);
    }
    return { search: searchQuery, responsibleId: selectedResponsibleId, tagIds: selectedTags, chips };
  }, [searchQuery, selectedResponsibleId, selectedTags, responsibleMembers, orgTags]);

  // Header "Disparo" button opens the stage source.
  const handleOpenDisparoStage = useCallback(() => {
    setDisparoManualIds([]);
    setDisparoSource("estagio");
    setIsDisparoOpen(true);
  }, []);

  // Bulk-bar → Disparo (Manual): seed the selection and open in manual mode.
  const handleDispararManual = useCallback((leadIds: string[]) => {
    setDisparoManualIds(leadIds);
    setDisparoSource("manual");
    setIsDisparoOpen(true);
  }, []);

  // Auto-update statuses based on meeting dates
  const autoUpdateStatuses = useCallback(async () => {
    if (!pipeData) return;

    const terminalStatuses: PipeConfirmacaoStatus[] = ["compareceu", "perdido"];

    for (const item of pipeData) {
      // Skip terminal statuses
      if (terminalStatuses.includes(item.status as PipeConfirmacaoStatus)) continue;

      // Skip remarcar status unless it's no longer overdue (meeting date changed)
      if (item.status === "remarcar") {
        const meetingDate = item.meeting_date ? new Date(item.meeting_date) : null;
        if (meetingDate && (isPast(meetingDate) && !isToday(meetingDate))) {
          continue; // Still overdue, keep in remarcar
        }
      }

      const meetingDate = item.meeting_date ? new Date(item.meeting_date) : null;
      const calculatedStatus = calculateStatusByDate(meetingDate, item.status as PipeConfirmacaoStatus);

      if (calculatedStatus && calculatedStatus !== item.status) {
        try {
          await updatePipeConfirmacao.mutateAsync({
            id: item.id,
            status: calculatedStatus,
            leadId: item.lead_id,
            assignedTo: item.sdr_id || item.closer_id,
          });
        } catch (error) {
          console.error("Error auto-updating status:", error);
        }
      }
    }
  }, [pipeData, updatePipeConfirmacao]);

  // Run auto-update on mount and when data changes
  useEffect(() => {
    autoUpdateStatuses();
  }, [pipeData?.length]); // Only run when data length changes to avoid infinite loops

  // Dados para ConfirmacaoStats: "Geral" = todo o pipe; outros modos = filtrado por período em UTC
  const statsData = useMemo(() => {
    if (!pipeData) return [];
    if (!metricsRange) return pipeData;
    const startMs = new Date(metricsRange.startStr).getTime();
    const endMs = new Date(metricsRange.endStr).getTime();
    return pipeData.filter((item: any) => {
      const at = item.metrics_period_at
        ? new Date(item.metrics_period_at).getTime()
        : new Date(item.created_at).getTime();
      return at >= startMs && at <= endMs;
    });
  }, [pipeData, metricsRange]);

  const transformToCard = (item: any): LeadCardData => {
    const lead = item.lead;
    const preSale = item.pre_sale_responsible ?? lead?.pre_sale_responsible ?? null;
    const sale    = item.sale_responsible    ?? lead?.sale_responsible    ?? null;
    return {
      id: item.id,
      name: lead?.name || "Sem nome",
      company: lead?.company || "Sem empresa",
      email: lead?.email,
      phone: lead?.phone,
      rating: lead?.rating || 0,
      origin: lead?.origin || "outro",
      responsible: item.responsible?.name || item.sdr?.name || item.closer?.name || lead?.responsible?.name || lead?.sdr?.name || lead?.closer?.name,
      assignees: [...new Set([item.responsible?.name, item.sdr?.name, item.closer?.name, item.pre_sale_responsible?.name, item.sale_responsible?.name, lead?.responsible?.name, lead?.sdr?.name, lead?.closer?.name, lead?.pre_sale_responsible?.name, lead?.sale_responsible?.name].filter(Boolean))] as string[],
      tags: lead?.lead_tags?.map((lt: any) => ({ name: lt.tag?.name, color: lt.tag?.color || "#888" })).filter((t: any) => t.name) || [],
      leadId: item.lead_id,
      faturamento: lead?.faturamento,
      urgency: lead?.urgency,
      date: item.meeting_date ? new Date(item.meeting_date) : null,
      dateLabel: item.meeting_date
        ? format(new Date(item.meeting_date), "dd MMM, HH:mm", { locale: ptBR })
        : undefined,
      meetLink: item.meet_link ?? null,
      createdAt: item.created_at,
      stageEnteredAt: item.stage_entered_at || item.updated_at,
      preQualTier: lead?.pre_qualification_tier ?? null,
      qualTier:    lead?.qualification_tier    ?? null,
      avatarUrl:   lead?.avatar_url ?? null,
      preSaleResponsible: preSale ? { name: preSale.name, avatar_url: preSale.avatar_url } : null,
      saleResponsible:    sale    ? { name: sale.name,    avatar_url: sale.avatar_url    } : null,
    };
  };

  // Build columns from server-paginated stageData. All board filters
  // (origin / urgency / status / scheduled / period / time bucket) are now
  // applied server-side by usePaginatedPipeline, so items and totalCount come
  // from the same filtered query and the column badge matches the cards.
  const columns = useMemo((): KanbanColumn<LeadCardData>[] => {
    return statusColumns.map(col => {
      const sd = stageData[col.id];
      const items = sd ? sd.items.map(transformToCard) : [];
      return {
        ...col,
        items,
        totalCount: sd?.totalCount ?? items.length,
        hasMore: sd?.hasMore ?? false,
        isFetchingMore: sd?.isFetchingMore ?? false,
        onLoadMore: sd?.fetchMore,
      };
    });
  }, [stageData, statusColumns]);

  // Count ghost leads — rows visíveis no pipe cujo join com leads é null.
  // Indica divergência entre RLS do pipe e de leads (ver GhostLeadsBanner).
  const ghostLeadsCount = useMemo(() => {
    if (!pipeData) return 0;
    return pipeData.filter(item => item.lead == null).length;
  }, [pipeData]);

  const handleStatusChange = async (itemId: string, newStatus: string) => {
    const item = pipeData?.find(p => p.id === itemId);
    if (!item) return;

    // Intercept: moving to "reuniao_marcada" opens schedule modal (date/time picker)
    if (newStatus === "reuniao_marcada") {
      setPendingRescheduleItem(item);
      setIsRescheduleModalOpen(true);
      return;
    }

    const stageLabel = statusColumns.find(c => c.id === newStatus)?.title || newStatus;

    // Check if moving to a success stage
    const movedStage = pipelineStages.find(s => s.stage_key === newStatus);
    if (movedStage?.is_final_positive) {
      // Destino = funil customizado (target_pipeline_id/target_stage_id). Trata
      // antes do fallback "propostas" para não abrir o CompareceuModal por engano.
      const hasCustomTarget = !!(movedStage.target_pipeline_id && movedStage.target_stage_id);
      if (hasCustomTarget) {
        try {
          await updatePipeConfirmacao.mutateAsync({
            id: itemId,
            status: newStatus as PipeConfirmacaoStatus,
            leadId: item.lead_id,
            assignedTo: item.sdr_id || item.closer_id,
          });
          if (organizationId) {
            await upsertLeadIntoCustomPipe({
              leadId: item.lead_id,
              organizationId,
              targetPipelineId: movedStage.target_pipeline_id!,
              targetStageId: movedStage.target_stage_id!,
            });
            queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
          }
          logAction({ leadId: item.lead_id, action: "stage_changed", description: `Etapa alterada para "${stageLabel}" no Pipe Confirmação` });
          if (organizationId) track({ event: "card_moved", organizationId, entityType: "pipe_confirmacao", entityId: itemId, metadata: { from_stage: item.status, to_stage: newStatus } });
          toast.success("Lead movido para o funil de destino automaticamente!");
        } catch (error) {
          toast.error("Erro ao atualizar status");
        }
        return;
      }

      const targetPipe = movedStage.target_pipe_type || "propostas"; // fallback

      // If target is propostas, open CompareceuModal to select SDR/Closer
      if (targetPipe === "propostas") {
        setPendingCompareceuItem(item);
        setIsCompareceuModalOpen(true);
        return;
      }

      // For other target pipes, create entry directly
      try {
        const targetStage = movedStage.target_stage_key;
        const targetPipeName = getPipelineTypeName(targetPipe as any);

        await updatePipeConfirmacao.mutateAsync({
          id: itemId,
          status: newStatus as PipeConfirmacaoStatus,
          leadId: item.lead_id,
          assignedTo: item.sdr_id || item.closer_id,
        });

        if (targetPipe === "confirmacao" && targetStage) {
          await createPipeConfirmacao.mutateAsync({
            lead_id: item.lead_id,
            sdr_id: item.sdr_id,
            closer_id: item.closer_id,
            status: targetStage,
          });
        }

        logAction({ leadId: item.lead_id, action: "stage_changed", description: `Etapa alterada para "${stageLabel}" no Pipe Confirmação` });
        if (organizationId) track({ event: "card_moved", organizationId, entityType: "pipe_confirmacao", entityId: itemId, metadata: { from_stage: item.status, to_stage: newStatus } });
        toast.success(`Lead movido para ${targetPipeName} automaticamente!`);
      } catch (error) {
        toast.error("Erro ao atualizar status");
      }
      return;
    }

    try {
      await updatePipeConfirmacao.mutateAsync({
        id: itemId,
        status: newStatus as PipeConfirmacaoStatus,
        leadId: item.lead_id,
        assignedTo: item.sdr_id || item.closer_id,
      });
      logAction({ leadId: item.lead_id, action: "stage_changed", description: `Etapa alterada para "${stageLabel}" no Pipe Confirmação` });
      if (organizationId) track({ event: "card_moved", organizationId, entityType: "pipe_confirmacao", entityId: itemId, metadata: { from_stage: item.status, to_stage: newStatus } });
      toast.success("Status atualizado!");
    } catch (error) {
      toast.error("Erro ao atualizar status");
    }
  };

  /**
   * ADR-0023 decisão 4: o negócio MOVE para Orçamentos, não é copiado para lá.
   *
   * O caminho de 95 organizações. Antes daqui saíam duas escritas — o UPDATE da
   * origem e um `createPipeProposta` que INSERIA um card novo. A origem ficava
   * em "compareceu" para sempre, e o mesmo negócio passava a existir em dois
   * funis.
   *
   * A ordem das duas chamadas abaixo NÃO é estilo:
   *
   *  1. `updatePipeConfirmacao` é o passo que grava o responsável e leva o card
   *     à etapa de sucesso. É ELE que dispara `meeting_held` — o gatilho de
   *     métrica reage à TRANSIÇÃO para "compareceu", não à permanência. Mantido
   *     exatamente como estava justamente para a contagem não mudar.
   *  2. `moverNegocio` só troca o funil, com `stageOrigem: null` porque o passo
   *     1 já aconteceu. Passar a etapa aqui de novo seria um UPDATE inerte.
   *
   * Se o passo 2 falhar, o card fica em "compareceu" na Confirmação — que é o
   * estado de hoje menos o gêmeo. Degrada para trás, e é retentável.
   *
   * ⚠️ A assinatura mudou de `(sdrId, closerId)` para `(responsibleId)`, e isso
   * é conserto: `CompareceuModal.onConfirm` é `(responsibleId: string | null)`,
   * um argumento só. O `closerId` NUNCA chegava — era `undefined` em toda
   * chamada, e ia assim para o card novo. O modal pede UM responsável; a
   * aridade de dois era resto de uma versão anterior.
   */
  const handleCompareceuConfirm = async (responsibleId: string | null) => {
    if (!pendingCompareceuItem) return;

    setIsProcessingCompareceu(true);
    try {
      const successStage = pipelineStages.find(s => s.is_final_positive);
      const successStageKey = successStage?.stage_key || "compareceu";
      const targetStageKey = successStage?.target_stage_key || "marcar_compromisso"; // fallback

      if (!propostasPipelineId) {
        throw new Error("Funil de Orçamentos não encontrado nesta organização");
      }

      // Passo 1 — responsável + etapa de sucesso. Produz `meeting_held`.
      await updatePipeConfirmacao.mutateAsync({
        id: pendingCompareceuItem.id,
        status: successStageKey as PipeConfirmacaoStatus,
        sdr_id: responsibleId,
        leadId: pendingCompareceuItem.lead_id,
        assignedTo: responsibleId,
      });

      // Passo 2 — a MESMA linha troca de funil. Nenhum card novo.
      await moverNegocio({
        entryId: pendingCompareceuItem.id,
        targetPipelineId: propostasPipelineId,
        targetStageKey,
        stageOrigem: null,
        assignedTo: responsibleId,
      });

      invalidateAfterMove(queryClient, pendingCompareceuItem.lead_id);

      logAction({ leadId: pendingCompareceuItem.lead_id, action: "meeting_attended", description: `Lead compareceu à reunião e movido para Gestão de Propostas` });
      if (organizationId) {
        // Os outros ramos desta tela já emitiam `card_moved` e este não —
        // agora que ele de fato move, emite igual.
        track({ event: "card_moved", organizationId, entityType: "pipe_confirmacao", entityId: pendingCompareceuItem.id, metadata: { from_stage: successStageKey, to_stage: targetStageKey, moved_to_pipe: "propostas" } });
      }
      toast.success("Negócio movido para Gestão de Propostas!");
      setIsCompareceuModalOpen(false);
      setPendingCompareceuItem(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro ao processar comparecimento";
      toast.error(msg);
    } finally {
      setIsProcessingCompareceu(false);
    }
  };

  const handleOpenDeleteDialog = (pipeId: string, leadId: string) => {
    setDeleteDialog({ open: true, pipeId, leadId });
  };

  const handleDeleteFromPipe = async () => {
    if (!deleteDialog) return;
    try {
      await deletePipeConfirmacao.mutateAsync(deleteDialog.pipeId);
      toast.success("Oportunidade removida do funil!");
      setDeleteDialog(null);
    } catch (error) {
      toast.error("Erro ao excluir");
    }
  };

  const handleCardClick = (card: LeadCardData) => {
    const item = pipeData?.find(p => p.id === card.id);
    if (item) {
      openDeal(item.id, item.lead_id);
    }
  };

  if (isLoading) {
    return <TorqueLoader variant="inline" />;
  }

  return (
    <div className="space-y-6">
      {/* Faixa única de controles — Modelo 1 do protótipo
          `.specs/mockups/funis-redesign/`, o mesmo componente que Qualificação
          usa. O cabeçalho anterior gastava três fileiras (título + seis botões,
          seletor de período, busca + faixas de tempo + views + filtros) antes do
          board aparecer. Disparo e auto-criar descem pro overflow em vez de
          sumir; as faixas de tempo viraram uma seção do painel de Filtros. */}
      <FunnelControlBar
        funnelKey="sys:confirmacao"
        funnelLabel="Confirmação"
        funnelColor="#22c55e"
        search={searchQuery}
        onSearchChange={setSearchQuery}
        views={
          <FunnelViewsMenu
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            viewOptions={[
              { value: "kanban", icon: LayoutGrid, label: "Kanban" },
              { value: "timeline", icon: List, label: "Timeline" },
              { value: "analytics", icon: BarChart3, label: "Analytics" },
            ]}
            entityType="pipe_confirmacao"
            currentFilters={filterState}
            defaultFilters={DEFAULT_CONFIRMACAO_FILTERS}
            onApplyFilters={(f) => setFilterState(() => f)}
            activeViewId={activeViewId}
            onActiveViewChange={handleActiveViewChange}
          />
        }
        filters={
          viewMode !== "analytics" ? (
            <KanbanFilterPanel sections={filterSections} onClearAll={handleClearAllFilters} />
          ) : null
        }
        actions={
          <>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => setIsSettingsOpen(true)}>
              <Settings2 className="w-4 h-4 mr-2" />
              Configurações
            </Button>

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
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5">
                  <AutoCreateLeadToggle />
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
        primaryAction={
          <Button size="sm" className="h-9 gradient-gold" onClick={() => setIsMeetingModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nova Reunião
          </Button>
        }
        chips={
          viewMode !== "analytics" ? (
            <FilterChips sections={filterSections} onClearAll={handleClearAllFilters} />
          ) : null
        }
      />

      <PipeSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        pipeType="confirmacao"
        stages={pipelineStages}
      />

      {/* Ghost leads (RLS divergente entre pipe e leads) */}
      <GhostLeadsBanner pipeType="confirmacao" ghostCount={ghostLeadsCount} />

      {/* Period filter indicator — aparece quando um período está selecionado (apenas no kanban) */}
      {viewMode === "kanban" && metricsRange && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground">
          <Calendar className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            Exibindo cards criados em{" "}
            <span className="text-foreground font-medium">{formatPeriodLabel(metricsRange)}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setPeriodState(createInitialPeriodState())}
          >
            Ver todos
          </Button>
        </div>
      )}

      {/* Content */}
      {viewMode === "analytics" ? (
        <PipeConfirmacaoAnalytics items={statsData} responsibleMembers={responsibleMembers} />
      ) : viewMode === "kanban" ? (
        <DraggableKanbanBoard
          columns={columns}
          onStatusChange={handleStatusChange}
          disabled={!canMovePipe}
          onDeleteAllLeads={(stageId, stageTitle) => setStageToDelete({ id: stageId, title: stageTitle })}
          onExportStage={(stageId, stageTitle) => {
            const col = columns.find((c) => c.id === stageId);
            setStageToExport({ id: stageId, title: stageTitle, count: col?.items.length ?? 0 });
          }}
          renderColumnExtra={(col) => {
            const allCounts = workflowCounts["__all__"] || { total: 0, active: 0 };
            const stageCounts = workflowCounts[col.id] || { total: 0, active: 0 };
            const merged = { total: stageCounts.total + allCounts.total, active: stageCounts.active + allCounts.active };
            return (
              <StageWorkflowsBadgeWrapper pipeType="confirmacao" stageKey={col.id} stageName={col.title} counts={merged} />
            );
          }}
          renderCard={(card) => (
            <LeadCard
              lead={card}
              variant="confirmacao"
              density="compact"
              selected={bulk.isSelected(card.leadId || "")}
              onSelect={(e) => {
                const lid = card.leadId || "";
                if (e.shiftKey) bulk.toggleRange(lid, allLeadIds);
                else bulk.toggle(lid);
              }}
              onClick={() => handleCardClick(card)}
              onRemove={canDeleteCards ? () => handleOpenDeleteDialog(card.id, card.leadId || "") : undefined}
              onQuickAction={(title) => {
                createAcaoDoDia.mutate({ title, lead_id: card.leadId || undefined });
              }}
              onCalorChange={(calor) => {
                if (card.leadId) updateLead.mutate({ id: card.leadId, rating: calor });
              }}
              onInlineEdit={(field, value) => {
                if (card.leadId) updateLead.mutate({ id: card.leadId, [field]: value });
              }}
            />
          )}
        />
      ) : (
        <MeetingTimeline
          meetings={pipeData || []}
          onMeetingClick={(meeting) => {
            openDeal(meeting.id, meeting.lead_id);
          }}
        />
      )}

      {/* Modals */}
      <LeadModal
        open={isLeadModalOpen}
        onOpenChange={setIsLeadModalOpen}
        lead={editingLead}
        onSuccess={() => {
          refetch();
          setEditingLead(null);
        }}
      />

      <AddMeetingModal
        open={isMeetingModalOpen}
        onOpenChange={setIsMeetingModalOpen}
        onSuccess={refetch}
      />

      <RescheduleModal
        open={isRescheduleModalOpen}
        onOpenChange={setIsRescheduleModalOpen}
        mode="schedule"
        pipeItem={pendingRescheduleItem}
        onSuccess={() => {
          setPendingRescheduleItem(null);
          refetch();
        }}
      />

      <CompareceuModal
        open={isCompareceuModalOpen}
        onOpenChange={setIsCompareceuModalOpen}
        onConfirm={handleCompareceuConfirm}
        leadName={pendingCompareceuItem?.lead?.name || "Lead"}
        currentResponsibleId={pendingCompareceuItem?.responsible_id || pendingCompareceuItem?.sdr_id || pendingCompareceuItem?.closer_id}
        isLoading={isProcessingCompareceu}
      />

      {/* Export leads from a specific stage */}
      <ExportStageDialog
        open={!!stageToExport}
        onOpenChange={(o) => { if (!o) setStageToExport(null); }}
        stageId={stageToExport?.id ?? ""}
        stageTitle={stageToExport?.title ?? ""}
        pipe="confirmacao"
        leadCount={stageToExport?.count ?? 0}
      />

      {/* Bulk Action Bar — "Disparar" opens the full Disparo wizard pre-seeded
          with the selection (Manual source), instead of the in-bar QuickBlast. */}
      <BulkActionBar
        selectedIds={bulk.selectedIds}
        onClear={bulk.clearSelection}
        leadIds={allLeadIds}
        onDisparar={(leadIds) => {
          handleDispararManual(leadIds);
          bulk.clearSelection();
        }}
      />

      {/* Disparo Wizard (system funnel: confirmacao). Mounted only while open so
          its audience-resolution queries never run in the background. */}
      {isDisparoOpen && (
        <DisparoWizard
          open={isDisparoOpen}
          onOpenChange={setIsDisparoOpen}
          context={{ kind: "system", pipelineType: "confirmacao" }}
          boardFilter={disparoBoardFilter}
          initialSource={disparoSource}
          initialManualLeadIds={disparoManualIds}
        />
      )}

      {/* Delete single lead from pipe */}
      <AlertDialog open={deleteDialog?.open} onOpenChange={(open) => !open && setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Você irá remover esta oportunidade do funil. O lead será mantido no sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFromPipe}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover do Funil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete leads from a specific stage (Confirmação) confirmation */}
      <AlertDialog open={!!stageToDelete} onOpenChange={(open) => { if (!open) setStageToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mover leads da etapa "{stageToDelete?.title}" para lixeira</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os leads da etapa "{stageToDelete?.title}" serão movidos para a lixeira. Leads em outras etapas não serão afetados. Você pode restaurá-los pela página de lixeira.
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
                  refetch();
                  toast.success(result?.deleted ? `${result.deleted} leads movidos para lixeira.` : "Leads movidos para lixeira.");
                } catch (e) {
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
    </div>
  );
}

/**
 * Os dois cards do sistema (SCRUM-124). Antes daqui este funil abria o
 * `DealDetailDialog` legado enquanto o pipe-whatsapp já abria o card novo — dois
 * layouts para a mesma coisa, decididos pela porta por onde o usuário entrou.
 *
 * `LeadPanelProvider` PRECISA envolver o `DealPanelProvider`, não o contrário:
 * clicar na pessoa dentro do card do Negócio fecha esse e abre o card do Lead, e
 * sem o provider de fora o `useLeadSheet` não acha contexto e o link quebra.
 *
 * Nunca ficam empilhados — são as duas únicas fichas do produto, cada uma dona
 * de um assunto.
 */
export default function PipeConfirmacao() {
  const { hasFeature } = useOrgFeatures();
  // Agendamentos foi mergeado em Oportunidades — board standalone aposentado (ADR-0004).
  if (hasFeature("merged_opportunity_funnel")) return <Navigate to="/funis" replace />;

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
          <PipeConfirmacaoInner />
        </LeadPanelLayout>
      </DealPanelProvider>
    </LeadPanelProvider>
  );
}
