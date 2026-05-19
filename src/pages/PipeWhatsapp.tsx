import { useState, useMemo, useEffect, useCallback } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { motion } from "framer-motion";
import { Search, Plus, Calendar, Settings2, AlertCircle, LayoutGrid, List, ChevronUp, ChevronDown } from "lucide-react";
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
import { DraggableKanbanBoard, KanbanColumn } from "@/components/kanban/DraggableKanbanBoard";
import { KanbanFilterPanel, FilterChips, type FilterSectionConfig } from "@/components/kanban/KanbanFilterPanel";
import { TorqueLoader } from "@/components/branding/TorqueLoader";
import { useCanPerformAction } from "@/lib/permissions";
import { StageWorkflowsBadgeWrapper } from "@/components/kanban/StageWorkflowsBadgeWrapper";
import { useStageWorkflowCounts } from "@/hooks/useStageWorkflows";
import { usePipeWhatsapp, useCreatePipeWhatsapp, useUpdatePipeWhatsapp, useDeletePipeWhatsapp, type PipeWhatsappStatus } from "@/hooks/usePipeWhatsapp";
import { usePipeWhatsappMetrics } from "@/hooks/usePipeMetrics";
import { type MetricsPeriodState, getDateRange, createInitialPeriodState } from "@/lib/metrics-period";
import { MetricsPeriodSelector } from "@/components/pipelines/MetricsPeriodSelector";
import { GhostLeadsBanner } from "@/components/pipelines/GhostLeadsBanner";
import { usePipelineStages, stagesToColumns, getPipelineTypeName } from "@/hooks/usePipelineStages";
import { PipeSettingsDialog } from "@/components/pipelines/PipeSettingsDialog";
import { useCreatePipeProposta } from "@/hooks/usePipePropostas";
import { useResponsibleMembers } from "@/hooks/useTeamMembers";
import { useDeleteAllLeadsInPipe, useUpdateLead } from "@/hooks/useLeads";
import { useUserRole, useFeaturePermission } from "@/hooks/useUserRole";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useCreateAcaoDoDia } from "@/hooks/useAcoesDoDia";
import { LeadCard, type LeadCardData } from "@/components/leads/LeadCard";
import { LeadPanelProvider, useLeadSheet, LeadDetailSheet } from "@/components/lead-detail";
import { LeadPanelLayout } from "@/components/layout/LeadPanelLayout";
import { LeadModal } from "@/components/leads/LeadModal";
import { CreateOpportunityModal } from "@/components/kanban/CreateOpportunityModal";
import { ExportStageDialog } from "@/components/kanban/ExportStageDialog";
import { AddMeetingModal } from "@/components/confirmacao/AddMeetingModal";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useOrganization } from "@/hooks/useOrganization";
import { track, trackModuleVisit } from "@/lib/analytics";
import { useLeadsWithScheduledMessages } from "@/hooks/useScheduledMessages";
import { useBatchedLeadMetrics } from "@/hooks/useBatchedLeadMetrics";
import { useTags } from "@/hooks/useTags";
import { useBulkSelection } from "@/hooks/useBulkSelection";
import { BulkActionBar } from "@/components/bulk-actions/BulkActionBar";
import { PipeTableView } from "@/components/kanban/PipeTableView";
import { PipelineListView } from "@/components/kanban/PipelineListView";
import { useViewport } from "@/hooks/use-viewport";
import { SavedViewsDropdown } from "@/components/saved-views/SavedViewsDropdown";
import { useSearchParams } from "react-router-dom";
import { matchesResponsibleFilter } from "@/lib/kanban-filters";


const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function formatPeriodLabel(range: { startStr: string; endStr: string }): string {
  const [sy, sm, sd] = range.startStr.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = range.endStr.slice(0, 10).split("-").map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  if (sy === ey) return `${sd} ${MONTHS_PT[sm - 1]} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  return `${sd} ${MONTHS_PT[sm - 1]} ${sy} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
}



// ---------------------------------------------------------------------------
// Persisted filter state — scoped per org + user, TTL 24 h
// ---------------------------------------------------------------------------
type WhatsappFilterState = {
  searchTerm: string;
  filterResponsible: string;
  filterOrigin: string;
  filterTags: string[];
  filterScheduled: boolean;
  viewMode: "kanban" | "list";
};

const DEFAULT_WHATSAPP_FILTERS: WhatsappFilterState = {
  searchTerm: "",
  filterResponsible: "all",
  filterOrigin: "all",
  filterTags: [],
  filterScheduled: false,
  viewMode: "kanban",
};

function PipeWhatsappInner() {
  const [filterState, setFilterState] = usePersistedState(
    "whatsapp",
    DEFAULT_WHATSAPP_FILTERS
  );

  const { searchTerm, filterResponsible, filterOrigin, filterTags, filterScheduled, viewMode } = filterState;
  const { isMobile } = useViewport();

  const setSearchTerm = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, searchTerm: v })),
    [setFilterState]
  );
  const setFilterResponsible = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, filterResponsible: v })),
    [setFilterState]
  );
  const setFilterOrigin = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, filterOrigin: v })),
    [setFilterState]
  );
  const setFilterTags = useCallback(
    (v: string[]) => setFilterState((f) => ({ ...f, filterTags: v })),
    [setFilterState]
  );
  const setFilterScheduled = useCallback(
    (v: boolean) => setFilterState((f) => ({ ...f, filterScheduled: v })),
    [setFilterState]
  );
  const setViewMode = useCallback(
    (v: "kanban" | "list") => setFilterState((f) => ({ ...f, viewMode: v })),
    [setFilterState]
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const [activeViewId, setActiveViewId] = useState<string | null>(searchParams.get("view"));
  const handleActiveViewChange = useCallback((viewId: string | null) => {
    setActiveViewId(viewId);
    setSearchParams(viewId ? { view: viewId } : {}, { replace: true });
  }, [setSearchParams]);
  const { data: leadsWithSchedule } = useLeadsWithScheduledMessages();
  const [isCreateLeadModalOpen, setIsCreateLeadModalOpen] = useState(false);
  const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { openLead } = useLeadSheet();
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pipeId: string; leadId: string } | null>(null);
  const [stageToDelete, setStageToDelete] = useState<{ id: string; title: string } | null>(null);
  const [stageToExport, setStageToExport] = useState<{ id: string; title: string; count: number } | null>(null);
  const [meetingModal, setMeetingModal] = useState<{
    open: boolean;
    leadId: string;
    sdrId: string | null;
    closerId: string | null;
  } | null>(null);
  const [periodState, setPeriodState] = useState<MetricsPeriodState>(createInitialPeriodState);
  const [metricsCollapsed, setMetricsCollapsed] = usePersistedState<boolean>("pipe-whatsapp-metrics-collapsed", false);

  const { organizationId } = useOrganization();
  useEffect(() => { trackModuleVisit("pipe_whatsapp", organizationId); }, []);

  const { data: pipeData, isLoading, isError, refetch } = usePipeWhatsapp();
  const { data: pipelineStages = [], isLoading: loadingStages } = usePipelineStages("whatsapp");
  const { data: workflowCounts = {} } = useStageWorkflowCounts("whatsapp");
  const metricsRange = useMemo(() => getDateRange(periodState), [periodState]);
  const { data: metricsByPeriod } = usePipeWhatsappMetrics(metricsRange);

  const { data: userRole } = useUserRole();
  const createPipeWhatsapp = useCreatePipeWhatsapp();
  const updatePipeWhatsapp = useUpdatePipeWhatsapp();
  const { allowed: canMovePipe } = useCanPerformAction("move_pipe_record");
  const deletePipeWhatsapp = useDeletePipeWhatsapp();
  const deleteAllLeadsInPipe = useDeleteAllLeadsInPipe("whatsapp");
  const createPipeProposta = useCreatePipeProposta();
  const logAction = useLogLeadAction();
  const createAcaoDoDia = useCreateAcaoDoDia();
  const updateLead = useUpdateLead();

  const { allowed: canDeleteCards } = useFeaturePermission("pipeline.delete_cards");

  const responsibleMembers = useResponsibleMembers();
  const { data: orgTags = [] } = useTags();
  const bulk = useBulkSelection();
  const allLeadIds = useMemo(() => {
    if (!pipeData) return [];
    return pipeData.filter(item => item.lead).map(item => item.lead_id);
  }, [pipeData]);

  // Build declarative sections for KanbanFilterPanel
  const filterSections: FilterSectionConfig[] = useMemo(() => [
    { type: "responsible", value: filterResponsible, onChange: setFilterResponsible, members: responsibleMembers },
    { type: "origin-single", value: filterOrigin, onChange: setFilterOrigin },
    { type: "tags", value: filterTags, onChange: setFilterTags, tags: orgTags },
    { type: "scheduled", value: filterScheduled, onChange: setFilterScheduled },
  ], [filterResponsible, filterOrigin, filterTags, filterScheduled, responsibleMembers, orgTags]);

  const handleClearAllFilters = useCallback(() => {
    setFilterState((f) => ({
      ...f,
      filterResponsible: "all",
      filterOrigin: "all",
      filterTags: [],
      filterScheduled: false,
    }));
  }, [setFilterState]);

  // Build IDs list pra fetch batched metrics
  const allRawLeadIds = useMemo(() => {
    if (!pipeData) return [] as string[];
    return [...new Set(pipeData.filter((it: any) => it.lead).map((it: any) => it.lead_id as string))];
  }, [pipeData]);
  const { data: metricsMap = {} } = useBatchedLeadMetrics(allRawLeadIds);

  // Transform pipe data to LeadCardData format
  const transformToCard = (item: any): LeadCardData => {
    const lead = item.lead;
    const preSale = item.pre_sale_responsible ?? lead?.pre_sale_responsible ?? null;
    const sale    = item.sale_responsible    ?? lead?.sale_responsible    ?? null;
    return {
      id: item.id,
      name: lead?.name || "Sem nome",
      company: lead?.company || "",
      phone: lead?.phone,
      email: lead?.email,
      rating: lead?.rating || 0,
      responsible: item.responsible?.name || item.sdr?.name || lead?.responsible?.name || lead?.sdr?.name,
      assignees: [...new Set([item.responsible?.name, item.sdr?.name, item.pre_sale_responsible?.name, item.sale_responsible?.name, lead?.responsible?.name, lead?.sdr?.name, lead?.pre_sale_responsible?.name, lead?.sale_responsible?.name].filter(Boolean))] as string[],
      tags: lead?.lead_tags?.map((lt: any) => ({ name: lt.tag?.name, color: lt.tag?.color || "#888" })).filter((t: any) => t.name) || [],
      createdAt: item.created_at,
      faturamento: lead?.faturamento,
      urgency: lead?.urgency,
      date: lead?.compromisso_date ? new Date(lead.compromisso_date) : null,
      dateLabel: lead?.compromisso_date ? format(new Date(lead.compromisso_date), "dd MMM, HH:mm", { locale: ptBR }) : undefined,
      leadId: item.lead_id,
      origin: lead?.origin,
      stageEnteredAt: item.stage_entered_at || item.updated_at,
      // Trello-style additions
      preQualTier: lead?.pre_qualification_tier ?? null,
      qualTier:    lead?.qualification_tier    ?? null,
      avatarUrl:   lead?.avatar_url ?? null,
      metrics: metricsMap[item.lead_id],
      preSaleResponsible: preSale ? { name: preSale.name, avatar_url: preSale.avatar_url } : null,
      saleResponsible:    sale    ? { name: sale.name,    avatar_url: sale.avatar_url    } : null,
    };
  };

  // Filter function for items
  // Filters out "ghost leads" where RLS blocks the lead data (lead relation is null)
  const filterItems = (item: any) => {
    const lead = item.lead;

    // Hide ghost leads (RLS blocked the lead data for this user)
    if (!lead) return false;

    // Date range filter (only when a period is selected)
    if (metricsRange) {
      if (!item.created_at) return false;
      if (item.created_at < metricsRange.startStr || item.created_at > metricsRange.endStr) return false;
    }

    // Search filter
    const matchesSearch = searchTerm === "" ||
      lead?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead?.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead?.phone?.includes(searchTerm);

    // Responsible filter — shared helper covers entry + lead, including
    // pre_sale_responsible_id / sale_responsible_id / sdr_id / closer_id.
    const matchesResponsible = matchesResponsibleFilter(item, filterResponsible);

    // Origin filter
    const matchesOrigin = filterOrigin === "all" || lead?.origin === filterOrigin;

    // Tags filter (multi-select — lead must have at least one of the selected tags)
    const matchesTags = filterTags.length === 0 ||
      (lead?.lead_tags?.some((lt: any) => filterTags.includes(lt.tag?.id)) ?? false);

    const matchesScheduled = !filterScheduled || (leadsWithSchedule?.has(item.lead_id) ?? false);
    return matchesSearch && matchesResponsible && matchesOrigin && matchesTags && matchesScheduled;
  };

  // Converte etapas do banco para o formato do Kanban (com fallback)
  const statusColumns = useMemo(() => {
    if (pipelineStages.length === 0) {
      // Fallback para etapas padrão enquanto carrega
      return [
        { id: "novo", title: "Novo", color: "#6366f1" },
        { id: "abordado", title: "Abordado", color: "#f59e0b" },
        { id: "respondeu", title: "Respondeu", color: "#3b82f6" },
        { id: "esfriou", title: "Esfriou", color: "#ef4444" },
        { id: "agendado", title: "Agendado ✓", color: "#22c55e" },
      ];
    }
    return stagesToColumns(pipelineStages);
  }, [pipelineStages]);

  // Organize data by status columns — orphan leads (stage_key not matching any column) fall into the first column
  const columns = useMemo((): KanbanColumn<LeadCardData>[] => {
    if (!pipeData) return statusColumns.map(col => ({ ...col, items: [] }));

    const knownStageIds = new Set(statusColumns.map(c => c.id));

    const result = statusColumns.map(col => {
      const columnItems = pipeData
        .filter(item => item.status === col.id)
        .filter(filterItems)
        .map(transformToCard);

      return {
        ...col,
        items: columnItems,
      };
    });

    if (result.length > 0) {
      const orphanItems = pipeData
        .filter(item => !knownStageIds.has(item.status))
        .filter(filterItems)
        .map(transformToCard);
      result[0].items = [...result[0].items, ...orphanItems];
    }

    return result;
  }, [pipeData, pipelineStages, statusColumns, searchTerm, filterResponsible, filterOrigin, filterTags, filterScheduled, leadsWithSchedule, metricsRange]);

  // ---------------------------------------------------------------------------
  // Mobile list view — derive stages + flat lead list from existing columns
  // ---------------------------------------------------------------------------
  const mobileStages = useMemo(
    () => statusColumns.map((col) => ({ id: col.id, name: col.title, stage_key: col.id, color: col.color })),
    [statusColumns]
  );

  const mobileLeads = useMemo(() => {
    if (!pipeData) return [];
    return pipeData
      .filter(filterItems)
      .map((item) => {
        const lead = item.lead;
        return {
          id: item.lead_id,
          pipeId: item.id,
          name: lead?.name || "Sem nome",
          company: lead?.company || undefined,
          phone: lead?.phone || undefined,
          rating: lead?.rating || 0,
          stage_key: item.status,
          created_at: item.created_at,
          updated_at: item.stage_entered_at || item.updated_at,
        };
      });
  }, [pipeData, searchTerm, filterResponsible, filterOrigin, filterTags, filterScheduled, leadsWithSchedule, metricsRange]);

  const handleMobileLeadClick = useCallback((leadId: string) => {
    const item = pipeData?.find((p) => p.lead_id === leadId);
    if (item) openLead(item.lead_id, item.id);
  }, [pipeData, openLead]);

  const handleMobileMove = useCallback(
    async (leadId: string, newStageKey: string) => {
      const item = pipeData?.find((p) => p.lead_id === leadId);
      if (item) await handleStatusChange(item.id, newStageKey);
    },
    [pipeData, handleStatusChange]
  );

  // Count "ghost leads" — rows do pipe que o usuário enxerga mas cujo join
  // com `leads` retornou null. Indica divergência entre RLS do pipe e de
  // `leads` (ex.: responsible_id do pipe aponta para o usuário, mas sdr_id
  // do lead aponta para outro — ou drift entre as duas tabelas).
  const ghostLeadsCount = useMemo(() => {
    if (!pipeData) return 0;
    return pipeData.filter(item => item.lead == null).length;
  }, [pipeData]);

  // Calculate stats based on FILTERED data (excludes ghost leads)
  const stats = useMemo(() => {
    if (!pipeData) return { total: 0, abordado: 0, respondeu: 0, scheduled: 0, pending: 0 };

    const filteredData = pipeData.filter(filterItems);

    const total = filteredData.length;
    const abordado = filteredData.filter(item => item.status === "abordado").length;
    const respondeu = filteredData.filter(item => item.status === "respondeu").length;
    const scheduled = filteredData.filter(item => item.status === "agendado").length;
    const pending = filteredData.filter(item => item.status === "novo").length;

    return { total, abordado, respondeu, scheduled, pending };
  }, [pipeData, searchTerm, filterResponsible, filterOrigin, filterTags, filterScheduled, leadsWithSchedule, metricsRange]);

  const displayStats = useMemo(() => {
    if (!metricsRange || !metricsByPeriod) return stats;
    return metricsByPeriod;
  }, [metricsRange, metricsByPeriod, stats]);

  // Handle status change from drag-and-drop
  const handleStatusChange = async (itemId: string, newStatus: string) => {
    const item = pipeData?.find(p => p.id === itemId);
    if (!item) return;

    const stageLabel = statusColumns.find(c => c.id === newStatus)?.title || newStatus;

    try {
      await updatePipeWhatsapp.mutateAsync({
        id: itemId,
        status: newStatus as PipeWhatsappStatus,
        leadId: item.lead_id,
        sdrId: item.sdr_id,
      });

      logAction({ leadId: item.lead_id, action: "stage_changed", description: `Etapa alterada para "${stageLabel}" no Funil WhatsApp` });
      if (organizationId) track({ event: "card_moved", organizationId, entityType: "pipe_whatsapp", entityId: itemId, metadata: { from_stage: item.status, to_stage: newStatus } });

      // If moved to a success stage, automatically create entry in the target pipe
      const movedStage = pipelineStages.find(s => s.stage_key === newStatus);
      if (movedStage?.is_final_positive) {
        const targetPipe = movedStage.target_pipe_type || "confirmacao"; // fallback
        const targetStage = movedStage.target_stage_key || "reuniao_marcada"; // fallback
        const targetPipeName = getPipelineTypeName(targetPipe as any);

        if (targetPipe === "confirmacao") {
          // Open AddMeetingModal so the user can enter date/time and Google Calendar details
          setMeetingModal({
            open: true,
            leadId: item.lead_id,
            sdrId: item.sdr_id ?? null,
            closerId: item.lead?.closer?.id ?? null,
          });
          return; // toast is shown by the modal on success
        } else if (targetPipe === "propostas") {
          await createPipeProposta.mutateAsync({
            lead_id: item.lead_id,
            closer_id: item.lead?.closer?.id || null,
            status: targetStage,
          });
        }

        toast.success(`Lead movido para ${targetPipeName} automaticamente!`);
      } else {
        toast.success("Status atualizado com sucesso!");
      }
    } catch (error) {
      toast.error("Erro ao atualizar status");
      console.error(error);
    }
  };

  // Handle delete — always removes only from this pipe, never deletes the full lead
  const handleDelete = async () => {
    if (!deleteDialog) return;

    try {
      await deletePipeWhatsapp.mutateAsync(deleteDialog.pipeId);
      toast.success("Oportunidade removida do funil!");
      setDeleteDialog(null);
    } catch (error: any) {
      toast.error("Erro ao excluir");
      console.error(error);
    }
  };

  const handleOpenDeleteDialog = (pipeId: string, leadId: string) => {
    setDeleteDialog({ open: true, pipeId, leadId });
  };

  if (isLoading && !pipeData) {
    return <TorqueLoader variant="inline" />;
  }

  if (isError && !pipeData) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="text-sm">Erro ao carregar o funil de qualificação.</p>
        <button
          onClick={() => refetch()}
          className="text-xs underline text-primary hover:text-primary/80"
        >
          Tentar novamente
        </button>
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
            className="text-2xl font-bold"
          >
            Funil de Qualificação
          </motion.h1>
          <p className="text-muted-foreground mt-1">
            Arraste os cards para alterar o status • Agendado → move para Confirmação
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
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={() => setIsSettingsOpen(true)}>
            <Settings2 className="w-4 h-4 mr-2" />
            Configurações
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIsCreateLeadModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Novo Lead
          </Button>
          <Button size="sm" className="gradient-gold" onClick={() => setIsOpportunityModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nova Oportunidade
          </Button>
        </div>
      </div>

      {/* Ghost leads (RLS divergente entre pipe e leads) */}
      <GhostLeadsBanner pipeType="whatsapp" ghostCount={ghostLeadsCount} />

      {/* Período + toggle recolher métricas */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <MetricsPeriodSelector state={periodState} onChange={setPeriodState} />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5 text-muted-foreground"
          onClick={() => setMetricsCollapsed(!metricsCollapsed)}
          aria-expanded={!metricsCollapsed}
        >
          {metricsCollapsed ? (
            <>
              <ChevronDown className="w-3.5 h-3.5" /> Mostrar métricas
            </>
          ) : (
            <>
              <ChevronUp className="w-3.5 h-3.5" /> Recolher métricas
            </>
          )}
        </Button>
      </div>

      {/* Stats Bar - colapsível */}
      {!metricsCollapsed && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4"
        >
          <div className="bg-card rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Total Leads</p>
            <p className="text-2xl font-bold mt-1">{displayStats.total}</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Abordados</p>
            <p className="text-2xl font-bold text-success mt-1">{displayStats.abordado}</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Respondeu</p>
            <p className="text-2xl font-bold text-blue-500 mt-1">{displayStats.respondeu}</p>
          </div>
          <div className="bg-card rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Agendados</p>
            <p className="text-2xl font-bold text-primary mt-1">{displayStats.scheduled}</p>
          </div>
        </motion.div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar lead, empresa, telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <SavedViewsDropdown
            entityType="pipe_whatsapp"
            currentFilters={filterState}
            defaultFilters={DEFAULT_WHATSAPP_FILTERS}
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

      {/* Period filter indicator — aparece quando um período está selecionado */}
      {metricsRange && (
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

      {/* Kanban Board / List View / Mobile List View */}
      {isMobile ? (
        <PipelineListView
          stages={mobileStages}
          leads={mobileLeads}
          onLeadClick={handleMobileLeadClick}
          onMoveLeadToStage={handleMobileMove}
          isLoading={isLoading && !pipeData}
        />
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
            const merged = {
              total: stageCounts.total + allCounts.total,
              active: stageCounts.active + allCounts.active,
            };
            return (
              <StageWorkflowsBadgeWrapper
                pipeType="whatsapp"
                stageKey={col.id}
                stageName={col.title}
                counts={merged}
              />
            );
          }}
          renderCard={(card) => (
            <LeadCard
              lead={card}
              variant="whatsapp"
              selected={bulk.isSelected(card.leadId || "")}
              onSelect={(e) => {
                const lid = card.leadId || "";
                if (e.shiftKey) bulk.toggleRange(lid, allLeadIds);
                else bulk.toggle(lid);
              }}
              onClick={() => {
                const item = pipeData?.find(p => p.id === card.id);
                if (item) {
                  openLead(item.lead_id, item.id);
                }
              }}
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
        <PipeTableView
          columns={columns}
          variant="whatsapp"
          onRowClick={(card) => {
            const item = pipeData?.find(p => p.id === card.id);
            if (item) {
              openLead(item.lead_id, item.id);
            }
          }}
          selectedIds={bulk.selectedIds}
        />
      )}

      {/* Pipe Settings Dialog */}
      <PipeSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        pipeType="whatsapp"
        stages={pipelineStages}
      />

      {/* Create Opportunity Modal */}
      <CreateOpportunityModal
        open={isOpportunityModalOpen}
        onOpenChange={setIsOpportunityModalOpen}
        onSuccess={() => refetch()}
      />

      {/* Create Lead Modal */}
      <LeadModal
        open={isCreateLeadModalOpen}
        onOpenChange={setIsCreateLeadModalOpen}
        lead={null}
        onSuccess={() => refetch()}
      />

      {/* Delete Confirmation Dialog */}
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
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover do Funil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete leads from a specific stage (Qualificação) confirmation */}
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
                  toast.error("Erro ao excluir leads.");
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteAllLeadsInPipe.isPending ? "Movendo para lixeira..." : "Mover para lixeira"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export leads from a specific stage */}
      <ExportStageDialog
        open={!!stageToExport}
        onOpenChange={(o) => { if (!o) setStageToExport(null); }}
        stageId={stageToExport?.id ?? ""}
        stageTitle={stageToExport?.title ?? ""}
        pipe="whatsapp"
        leadCount={stageToExport?.count ?? 0}
      />

      {/* Bulk Action Bar */}
      <BulkActionBar selectedIds={bulk.selectedIds} onClear={bulk.clearSelection} leadIds={allLeadIds} />

      {/* AddMeetingModal — opened when a lead is dragged to an "agendado" stage */}
      {meetingModal && (
        <AddMeetingModal
          open={meetingModal.open}
          onOpenChange={(isOpen) => {
            if (!isOpen) setMeetingModal(null);
          }}
          prefilledLeadId={meetingModal.leadId}
          prefilledSdrId={meetingModal.sdrId ?? undefined}
          prefilledCloserId={meetingModal.closerId ?? undefined}
          onSuccess={() => {
            setMeetingModal(null);
            refetch();
            toast.success("Reunião agendada e lead movido para Confirmação!");
          }}
        />
      )}

    </div>
  );
}

export default function PipeWhatsapp() {
  return (
    <LeadPanelProvider>
      <LeadPanelLayout panel={<LeadDetailSheet />}>
        <PipeWhatsappInner />
      </LeadPanelLayout>
    </LeadPanelProvider>
  );
}
