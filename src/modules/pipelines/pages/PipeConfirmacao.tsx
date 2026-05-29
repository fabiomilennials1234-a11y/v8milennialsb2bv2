import { useState, useMemo, useEffect, useCallback } from "react";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { motion } from "framer-motion";
import { Search, Plus, Calendar, LayoutGrid, List, Settings2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { usePipeConfirmacao, useUpdatePipeConfirmacao, useCreatePipeConfirmacao, useDeletePipeConfirmacao, PipeConfirmacaoStatus } from "@/modules/pipelines/hooks/usePipeConfirmacao";
import { usePipelineStages, stagesToColumns, getPipelineTypeName } from "@/modules/pipelines/hooks/usePipelineStages";
import { PipeSettingsDialog } from "@/modules/pipelines/components/shared/PipeSettingsDialog";
import { useDeleteAllLeadsInPipe, useUpdateLead } from "@/modules/leads";
import { useCreatePipeProposta } from "@/modules/pipelines/hooks/usePipePropostas";
import { useResponsibleMembers } from "@/modules/identity";
import { LeadModal } from "@/modules/leads";
import { AddMeetingModal } from "@/modules/pipelines/components/legacy/confirmacao/AddMeetingModal";
import { RescheduleModal } from "@/modules/pipelines/components/legacy/confirmacao/RescheduleModal";
import { ConfirmacaoStats } from "@/modules/pipelines/components/legacy/confirmacao/ConfirmacaoStats";
import { type MetricsPeriodState, getDateRange, createInitialPeriodState } from "@/lib/metrics-period";
import { MetricsPeriodSelector } from "@/modules/pipelines/components/shared/MetricsPeriodSelector";
import { GhostLeadsBanner } from "@/modules/pipelines/components/shared/GhostLeadsBanner";
import { LeadCard, type LeadCardData } from "@/modules/leads";
import { LeadPanelProvider, useLeadSheet, LeadDetailSheet } from "@/modules/leads";
import { LeadPanelLayout } from "@/modules/platform/components/layout/LeadPanelLayout";
import { KanbanFilterPanel, FilterChips, type FilterSectionConfig } from "@/modules/pipelines/components/kanban/KanbanFilterPanel";
import { MeetingTimeline } from "@/modules/pipelines/components/legacy/confirmacao/MeetingTimeline";
import { CompareceuModal } from "@/modules/pipelines/components/legacy/confirmacao/CompareceuModal";
import { ExportStageDialog } from "@/modules/pipelines/components/kanban/ExportStageDialog";
import { useConfirmacaoOverdueDays, isConfirmacaoOverdue } from "@/modules/identity";
import { format, isToday, startOfWeek, endOfWeek, isWithinInterval, isTomorrow, isPast, startOfDay, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLogLeadAction } from "@/modules/leads";
import { useCreateAcaoDoDia } from "@/modules/engagement/hooks/useAcoesDoDia";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/modules/identity";
import { useLeadsWithScheduledMessages } from "@/modules/communication/hooks/useScheduledMessages";
import { track, trackModuleVisit } from "@/lib/analytics";
import { useFeaturePermission } from "@/modules/identity";
import { useIdentity } from "@/modules/identity";
import { useTags } from "@/modules/leads/hooks/useTags";
import { useBulkSelection } from "@/shared/hooks/useBulkSelection";
import { BulkActionBar } from "@/modules/leads/components/bulk-actions/BulkActionBar";
import { SavedViewsDropdown } from "@/modules/platform/components/saved-views/SavedViewsDropdown";
import { useSearchParams } from "react-router-dom";
import { matchesResponsibleFilter } from "@/lib/kanban-filters";

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
  selectedResponsibleId: string;
  viewMode: "kanban" | "timeline";
  membroDefaultApplied?: boolean;
};

const DEFAULT_CONFIRMACAO_FILTERS: ConfirmacaoFilterState = {
  searchQuery: "",
  originFilter: "all",
  timeFilter: "all",
  urgencyFilter: "all",
  selectedStatuses: [],
  selectedTags: [],
  selectedResponsibleId: "all",
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
    selectedResponsibleId,
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
  const setSelectedResponsibleId = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, selectedResponsibleId: v })),
    [setFilterState]
  );
  const setViewMode = useCallback(
    (v: "kanban" | "timeline") => setFilterState((f) => ({ ...f, viewMode: v })),
    [setFilterState]
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeViewId, setActiveViewId] = useState<string | null>(searchParams.get("view"));
  const handleActiveViewChange = useCallback((viewId: string | null) => {
    setActiveViewId(viewId);
    setSearchParams(viewId ? { view: viewId } : {}, { replace: true });
  }, [setSearchParams]);
  const { data: leadsWithSchedule } = useLeadsWithScheduledMessages();
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

  const { openLead } = useLeadSheet();
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [isMeetingModalOpen, setIsMeetingModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
  const [periodState, setPeriodState] = useState<MetricsPeriodState>(createInitialPeriodState);
  const [stageToDelete, setStageToDelete] = useState<{ id: string; title: string } | null>(null);
  const [stageToExport, setStageToExport] = useState<{ id: string; title: string; count: number } | null>(null);

  const { organizationId } = useOrganization();
  useEffect(() => { trackModuleVisit("pipe_confirmacao", organizationId); }, []);

  const overdueDays = useConfirmacaoOverdueDays();
  const { data: pipeData, isLoading, refetch } = usePipeConfirmacao();
  const { data: pipelineStages = [] } = usePipelineStages("confirmacao");
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
  const createPipeProposta = useCreatePipeProposta();
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
    { type: "responsible", value: selectedResponsibleId, onChange: setSelectedResponsibleId, members: responsibleMembers },
    { type: "origin-single", value: originFilter, onChange: setOriginFilter as (v: string) => void },
    { type: "tags", value: selectedTags, onChange: setSelectedTags, tags: orgTags },
    { type: "urgency", value: urgencyFilter, onChange: setUrgencyFilter as (v: string) => void },
    { type: "status-multi", value: selectedStatuses, onChange: setSelectedStatuses, options: statusColumns },
    { type: "scheduled", value: filterScheduled, onChange: setFilterScheduled },
  ], [selectedResponsibleId, originFilter, selectedTags, urgencyFilter, selectedStatuses, filterScheduled, responsibleMembers, orgTags, statusColumns, setSelectedResponsibleId, setOriginFilter, setSelectedTags, setUrgencyFilter, setSelectedStatuses]);

  const handleClearAllFilters = useCallback(() => {
    setOriginFilter("all" as OriginFilter);
    setTimeFilter("all" as TimeFilter);
    setUrgencyFilter("all" as UrgencyFilter);
    setSelectedStatuses([]);
    setSelectedTags([]);
    setSelectedResponsibleId("all");
    setFilterScheduled(false);
  }, [setOriginFilter, setTimeFilter, setUrgencyFilter, setSelectedStatuses, setSelectedTags, setSelectedResponsibleId]);

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
  const metricsRange = useMemo(() => getDateRange(periodState), [periodState]);
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

  const columns = useMemo((): KanbanColumn<LeadCardData>[] => {
    if (!pipeData) return statusColumns.map(col => ({ ...col, items: [] }));

    const now = new Date();
    const weekStart = startOfWeek(now, { locale: ptBR });
    const weekEnd = endOfWeek(now, { locale: ptBR });

    const knownStageIds = new Set(statusColumns.map(c => c.id));

    const filterConfirmacao = (item: any) => {
      const lead = item.lead;
      if (!lead) return false;

      if (metricsRange) {
        if (!item.created_at) return false;
        if (item.created_at < metricsRange.startStr || item.created_at > metricsRange.endStr) return false;
      }

      const matchesSearch = searchQuery === "" ||
        lead?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead?.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead?.phone?.includes(searchQuery);

      let matchesOrigin = originFilter === "all" || lead?.origin === originFilter;
      let matchesUrgency = urgencyFilter === "all" || lead?.urgency === urgencyFilter;

      let matchesTime = true;
      if (timeFilter === "today" && item.meeting_date) {
        matchesTime = isToday(new Date(item.meeting_date));
      } else if (timeFilter === "tomorrow" && item.meeting_date) {
        matchesTime = isTomorrow(new Date(item.meeting_date));
      } else if (timeFilter === "week" && item.meeting_date) {
        matchesTime = isWithinInterval(new Date(item.meeting_date), { start: weekStart, end: weekEnd });
      } else if (timeFilter === "overdue") {
        matchesTime = isConfirmacaoOverdue(item.status, item.updated_at, overdueDays);
      }

      const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(item.status);
      // Shared helper covers all 9 responsibility fields (entry + lead),
      // including pre_sale_responsible_id / sale_responsible_id.
      const matchesResponsible = matchesResponsibleFilter(item, selectedResponsibleId);

      const matchesTags = selectedTags.length === 0 ||
        (lead?.lead_tags?.some((lt: any) => selectedTags.includes(lt.tag?.id)) ?? false);
      const matchesScheduled = !filterScheduled || (leadsWithSchedule?.has(item.lead_id) ?? false);

      return matchesSearch && matchesOrigin && matchesUrgency && matchesTime && matchesStatus && matchesResponsible && matchesTags && matchesScheduled;
    };

    const sortByCreated = (a: any, b: any) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    };

    const result = statusColumns.map(col => {
      const columnItems = pipeData
        .filter(item => item.status === col.id)
        .filter(filterConfirmacao)
        .sort(sortByCreated)
        .map(transformToCard);

      return { ...col, items: columnItems };
    });

    if (result.length > 0) {
      const orphanItems = pipeData
        .filter(item => !knownStageIds.has(item.status))
        .filter(filterConfirmacao)
        .sort(sortByCreated)
        .map(transformToCard);
      result[0].items = [...result[0].items, ...orphanItems];
    }

    return result;
  }, [pipeData, statusColumns, searchQuery, originFilter, urgencyFilter, timeFilter, selectedStatuses, selectedTags, selectedResponsibleId, overdueDays, filterScheduled, leadsWithSchedule, metricsRange]);

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

  const handleCompareceuConfirm = async (sdrId: string | null, closerId: string | null) => {
    if (!pendingCompareceuItem) return;

    setIsProcessingCompareceu(true);
    try {
      // Find the success stage to get the configured status and target
      const successStage = pipelineStages.find(s => s.is_final_positive);
      const successStageKey = successStage?.stage_key || "compareceu";
      const targetStageKey = successStage?.target_stage_key || "marcar_compromisso"; // fallback

      // Update confirmacao with SDR and Closer
      await updatePipeConfirmacao.mutateAsync({
        id: pendingCompareceuItem.id,
        status: successStageKey as PipeConfirmacaoStatus,
        sdr_id: sdrId,
        closer_id: closerId,
        leadId: pendingCompareceuItem.lead_id,
        assignedTo: sdrId || closerId,
      });

      // Create proposta with selected closer and configured target stage
      await createPipeProposta.mutateAsync({
        lead_id: pendingCompareceuItem.lead_id,
        closer_id: closerId,
        status: targetStageKey,
      });

      logAction({ leadId: pendingCompareceuItem.lead_id, action: "meeting_attended", description: `Lead compareceu à reunião e movido para Gestão de Propostas` });
      toast.success("Lead movido para Gestão de Propostas!");
      setIsCompareceuModalOpen(false);
      setPendingCompareceuItem(null);
    } catch (error) {
      toast.error("Erro ao processar comparecimento");
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
      openLead(item.lead_id, item.id);
    }
  };

  if (isLoading) {
    return <TorqueLoader variant="inline" />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold"
          >
            Confirmação de Reunião
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Arraste os cards para alterar o status • Compareceu → move para Propostas
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center border rounded-lg p-1">
            <Button 
              variant={viewMode === "kanban" ? "secondary" : "ghost"} 
              size="sm"
              onClick={() => setViewMode("kanban")}
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
            <Button 
              variant={viewMode === "timeline" ? "secondary" : "ghost"} 
              size="sm"
              onClick={() => setViewMode("timeline")}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={() => setIsSettingsOpen(true)}>
            <Settings2 className="w-4 h-4 mr-2" />
            Configurações
          </Button>
          <Button size="sm" className="gradient-gold" onClick={() => setIsMeetingModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nova Reunião
          </Button>
        </div>
      </div>

      <PipeSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        pipeType="confirmacao"
        stages={pipelineStages}
      />

      {/* Ghost leads (RLS divergente entre pipe e leads) */}
      <GhostLeadsBanner pipeType="confirmacao" ghostCount={ghostLeadsCount} />

      {/* Período das métricas */}
      <MetricsPeriodSelector state={periodState} onChange={setPeriodState} />

      {/* Stats */}
      <ConfirmacaoStats data={statsData} />

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar lead, empresa..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearchQuery("")}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Quick Time Filters (inline, not in Sheet) */}
          <div className="flex gap-2 flex-wrap">
            {timeOptions.map((option) => (
              <Button
                key={option.value}
                variant={timeFilter === option.value ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setTimeFilter(option.value)}
                className={cn(
                  "transition-all",
                  timeFilter === option.value && "ring-1 ring-primary/30"
                )}
              >
                {option.value === "overdue" && timeFilter === option.value && (
                  <span className="w-2 h-2 rounded-full bg-destructive mr-1.5 animate-pulse" />
                )}
                {option.label}
              </Button>
            ))}
          </div>

          {/* Filter Panel Button */}
          <SavedViewsDropdown
            entityType="pipe_confirmacao"
            currentFilters={filterState}
            defaultFilters={DEFAULT_CONFIRMACAO_FILTERS}
            onApplyFilters={(f) => setFilterState(() => f)}
            activeViewId={activeViewId}
            onActiveViewChange={handleActiveViewChange}
          />
          <KanbanFilterPanel
            sections={filterSections}
            onClearAll={handleClearAllFilters}
          />
        </div>
        <FilterChips
          sections={filterSections}
          onClearAll={handleClearAllFilters}
        />
      </div>

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
      {viewMode === "kanban" ? (
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
            openLead(meeting.lead_id, meeting.id);
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

      {/* Bulk Action Bar */}
      <BulkActionBar selectedIds={bulk.selectedIds} onClear={bulk.clearSelection} leadIds={allLeadIds} />

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

export default function PipeConfirmacao() {
  return (
    <LeadPanelProvider>
      <LeadPanelLayout panel={<LeadDetailSheet />}>
        <PipeConfirmacaoInner />
      </LeadPanelLayout>
    </LeadPanelProvider>
  );
}
