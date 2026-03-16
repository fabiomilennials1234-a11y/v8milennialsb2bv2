import { useState, useMemo, useEffect, useCallback } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { motion } from "framer-motion";
import { Plus, Calendar, Loader2, LayoutGrid, List, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { DraggableKanbanBoard, DraggableItem, KanbanColumn } from "@/components/kanban/DraggableKanbanBoard";
import { useCanPerformAction } from "@/lib/permissions";
import { StageWorkflowsBadgeWrapper } from "@/components/kanban/StageWorkflowsBadgeWrapper";
import { useStageWorkflowCounts } from "@/hooks/useStageWorkflows";
import { usePipeConfirmacao, useUpdatePipeConfirmacao, useCreatePipeConfirmacao, useDeletePipeConfirmacao, PipeConfirmacaoStatus } from "@/hooks/usePipeConfirmacao";
import { usePipelineStages, stagesToColumns, getPipelineTypeName } from "@/hooks/usePipelineStages";
import { PipeSettingsDialog } from "@/components/pipelines/PipeSettingsDialog";
import { useDeleteAllLeadsInPipe, useUpdateLead } from "@/hooks/useLeads";
import { useCreatePipeProposta } from "@/hooks/usePipePropostas";
import { useResponsibleMembers } from "@/hooks/useTeamMembers";
import { LeadModal } from "@/components/leads/LeadModal";
import { AddMeetingModal } from "@/components/confirmacao/AddMeetingModal";
import { ConfirmacaoStats } from "@/components/confirmacao/ConfirmacaoStats";
import type { MetricsPeriod } from "@/hooks/usePipeMetrics";
import { LeadCard, type LeadCardData } from "@/components/leads/LeadCard";
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer";
import { ConfirmacaoContext } from "@/components/leads/funnel-contexts/ConfirmacaoContext";
import { ConfirmacaoFilters, OriginFilter, TimeFilter, UrgencyFilter } from "@/components/confirmacao/ConfirmacaoFilters";
import { MeetingTimeline } from "@/components/confirmacao/MeetingTimeline";
import { CompareceuModal } from "@/components/confirmacao/CompareceuModal";
import { useConfirmacaoOverdueDays, isConfirmacaoOverdue } from "@/hooks/useOrganizationSettings";
import { format, isToday, startOfWeek, endOfWeek, isWithinInterval, isTomorrow, isPast, startOfDay, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useCreateAcaoDoDia } from "@/hooks/useAcoesDoDia";
import { toast } from "sonner";
import { useOrganization } from "@/hooks/useOrganization";
import { track, trackModuleVisit } from "@/lib/analytics";
import { useFeaturePermission } from "@/hooks/useUserRole";

// ConfirmacaoCardData is now LeadCardData from the unified LeadCard component

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
  selectedResponsibleId: string;
  viewMode: "kanban" | "timeline";
};

const DEFAULT_CONFIRMACAO_FILTERS: ConfirmacaoFilterState = {
  searchQuery: "",
  originFilter: "all",
  timeFilter: "all",
  urgencyFilter: "all",
  selectedStatuses: [],
  selectedResponsibleId: "all",
  viewMode: "kanban",
};

export default function PipeConfirmacao() {
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
  const setSelectedResponsibleId = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, selectedResponsibleId: v })),
    [setFilterState]
  );
  const setViewMode = useCallback(
    (v: "kanban" | "timeline") => setFilterState((f) => ({ ...f, viewMode: v })),
    [setFilterState]
  );
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [isMeetingModalOpen, setIsMeetingModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<any>(null);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  // Compareceu modal state
  const [isCompareceuModalOpen, setIsCompareceuModalOpen] = useState(false);
  const [pendingCompareceuItem, setPendingCompareceuItem] = useState<any>(null);
  const [isProcessingCompareceu, setIsProcessingCompareceu] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pipeId: string; leadId: string } | null>(null);
  const [deleteAllLeadsDialogOpen, setDeleteAllLeadsDialogOpen] = useState(false);
  const [metricsPeriod, setMetricsPeriod] = useState<MetricsPeriod>("all");
  const now = new Date();
  const [selectedMetricsMonth, setSelectedMetricsMonth] = useState(now.getMonth() + 1);
  const [selectedMetricsYear, setSelectedMetricsYear] = useState(now.getFullYear());

  const { organizationId } = useOrganization();
  useEffect(() => { trackModuleVisit("pipe_confirmacao", organizationId); }, []);

  const overdueDays = useConfirmacaoOverdueDays();
  const { data: pipeData, isLoading, refetch } = usePipeConfirmacao();
  const { data: pipelineStages = [] } = usePipelineStages("confirmacao");
  const { data: workflowCounts = {} } = useStageWorkflowCounts("confirmacao");
  const responsibleMembers = useResponsibleMembers();
  const updatePipeConfirmacao = useUpdatePipeConfirmacao();
  const { allowed: canMovePipe } = useCanPerformAction("move_pipe_record");
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

  // Dados para ConfirmacaoStats: "Geral" = todo o pipe; "Este mês" = filtrado por período em UTC (igual à importação)
  const statsData = useMemo(() => {
    if (!pipeData) return [];
    if (metricsPeriod === "all") return pipeData;
    const startMs = Date.UTC(selectedMetricsYear, selectedMetricsMonth - 1, 1);
    const endMs = new Date(Date.UTC(selectedMetricsYear, selectedMetricsMonth, 0, 23, 59, 59, 999)).getTime();
    return pipeData.filter((item: any) => {
      const at = item.metrics_period_at
        ? new Date(item.metrics_period_at).getTime()
        : new Date(item.created_at).getTime();
      return at >= startMs && at <= endMs;
    });
  }, [pipeData, metricsPeriod, selectedMetricsMonth, selectedMetricsYear]);

  const transformToCard = (item: any): LeadCardData => {
    const lead = item.lead;
    return {
      id: item.id,
      name: lead?.name || "Sem nome",
      company: lead?.company || "Sem empresa",
      email: lead?.email,
      phone: lead?.phone,
      rating: lead?.rating || 0,
      origin: lead?.origin || "outro",
      responsible: item.sdr?.name || item.closer?.name || lead?.sdr?.name || lead?.closer?.name,
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
    };
  };

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

  const columns = useMemo((): KanbanColumn<LeadCardData>[] => {
    if (!pipeData) return statusColumns.map(col => ({ ...col, items: [] }));

    const now = new Date();
    const weekStart = startOfWeek(now, { locale: ptBR });
    const weekEnd = endOfWeek(now, { locale: ptBR });

    return statusColumns.map(col => {
      const columnItems = pipeData
        .filter(item => item.status === col.id)
        .filter(item => {
          const lead = item.lead;

          // Hide ghost leads (RLS blocked the lead data for this user)
          if (!lead) return false;

          const matchesSearch = searchQuery === "" ||
            lead?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            lead?.company?.toLowerCase().includes(searchQuery.toLowerCase());
          
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
          
          // Responsible filter
          const matchesResponsible = selectedResponsibleId === "all" || item.responsible_id === selectedResponsibleId;

          return matchesSearch && matchesOrigin && matchesUrgency && matchesTime && matchesStatus && matchesResponsible;
        })
        // Sort by created_at — leads mais recentes primeiro
        .sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        })
        .map(transformToCard);

      return { ...col, items: columnItems };
    });
  }, [pipeData, searchQuery, originFilter, urgencyFilter, timeFilter, selectedStatuses, selectedResponsibleId, overdueDays]);

  const handleStatusChange = async (itemId: string, newStatus: string) => {
    const item = pipeData?.find(p => p.id === itemId);
    if (!item) return;

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
      setSelectedItem(item);
      setIsDetailModalOpen(true);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-bold flex items-center gap-2"
          >
            <Calendar className="w-6 h-6 text-primary" />
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

      {/* Período das métricas: Este mês | Geral */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={metricsPeriod} onValueChange={(v) => setMetricsPeriod(v as MetricsPeriod)}>
          <TabsList className="h-9">
            <TabsTrigger value="all" className="gap-1.5 text-xs">Geral</TabsTrigger>
            <TabsTrigger value="month" className="gap-1.5 text-xs">Este mês</TabsTrigger>
          </TabsList>
        </Tabs>
        {metricsPeriod === "month" && (
          <>
            <Select value={String(selectedMetricsMonth)} onValueChange={(v) => setSelectedMetricsMonth(Number(v))}>
              <SelectTrigger className="w-[140px] h-9">
                <Calendar className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {format(new Date(selectedMetricsYear, m - 1), "MMMM", { locale: ptBR })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(selectedMetricsYear)} onValueChange={(v) => setSelectedMetricsYear(Number(v))}>
              <SelectTrigger className="w-[100px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[selectedMetricsYear - 2, selectedMetricsYear - 1, selectedMetricsYear, selectedMetricsYear + 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <span className="text-xs text-muted-foreground">
          {metricsPeriod === "all" ? "Métricas do pipe no geral" : `Métricas de ${format(new Date(selectedMetricsYear, selectedMetricsMonth - 1), "MMMM/yyyy", { locale: ptBR })}`}
        </span>
      </div>

      {/* Stats */}
      <ConfirmacaoStats data={statsData} />

      {/* Filters */}
      <ConfirmacaoFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        originFilter={originFilter}
        onOriginFilterChange={setOriginFilter}
        timeFilter={timeFilter}
        onTimeFilterChange={setTimeFilter}
        urgencyFilter={urgencyFilter}
        onUrgencyFilterChange={setUrgencyFilter}
        selectedStatuses={selectedStatuses}
        onStatusesChange={setSelectedStatuses}
        statusOptions={statusColumns}
        teamMembers={teamMemberOptions}
        selectedResponsibleId={selectedResponsibleId}
        onResponsibleFilterChange={setSelectedResponsibleId}
      />

      {/* Content */}
      {viewMode === "kanban" ? (
        <DraggableKanbanBoard
          columns={columns}
          onStatusChange={handleStatusChange}
          disabled={!canMovePipe}
          onDeleteAllLeads={() => setDeleteAllLeadsDialogOpen(true)}
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
              onClick={() => handleCardClick(card)}
              onRemove={canDeleteCards ? () => handleOpenDeleteDialog(card.id, card.leadId || "") : undefined}
              onQuickAction={(title) => {
                createAcaoDoDia.mutate({ title, lead_id: card.leadId || undefined });
              }}
              onCalorChange={(calor) => {
                if (card.leadId) updateLead.mutate({ id: card.leadId, rating: calor });
              }}
            />
          )}
        />
      ) : (
        <MeetingTimeline 
          meetings={pipeData || []} 
          onMeetingClick={(meeting) => {
            setSelectedItem(meeting);
            setIsDetailModalOpen(true);
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

      <LeadDetailDrawer
        open={isDetailModalOpen}
        onOpenChange={setIsDetailModalOpen}
        leadId={selectedItem?.lead_id || null}
        variant="confirmacao"
        pipeData={selectedItem}
        onSuccess={refetch}
        renderFunnelContext={({ lead, pipeData, onSuccess: onCtxSuccess }) => (
          <ConfirmacaoContext lead={lead} pipeData={pipeData} onSuccess={onCtxSuccess} />
        )}
      />

      <CompareceuModal
        open={isCompareceuModalOpen}
        onOpenChange={setIsCompareceuModalOpen}
        onConfirm={handleCompareceuConfirm}
        leadName={pendingCompareceuItem?.lead?.name || "Lead"}
        currentResponsibleId={pendingCompareceuItem?.responsible_id || pendingCompareceuItem?.sdr_id || pendingCompareceuItem?.closer_id}
        isLoading={isProcessingCompareceu}
      />

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

      {/* Delete ALL leads from THIS stage (Confirmação) confirmation */}
      <AlertDialog open={deleteAllLeadsDialogOpen} onOpenChange={setDeleteAllLeadsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir todos os leads desta etapa</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação irá excluir todos os leads que estão no funil de Confirmação e na base de dados (histórico, tags, etc.). Não afeta outros funis nem outras organizações. Não é possível desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  const result = await deleteAllLeadsInPipe.mutateAsync();
                  setDeleteAllLeadsDialogOpen(false);
                  refetch();
                  toast.success(result?.deleted ? `${result.deleted} leads excluídos desta etapa.` : "Todos os leads desta etapa foram excluídos.");
                } catch (e) {
                  toast.error("Erro ao excluir leads.");
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteAllLeadsInPipe.isPending ? "Excluindo..." : "Excluir todos os leads desta etapa"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
