import { useState, useMemo, useEffect, useCallback } from "react";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { motion } from "framer-motion";
import { Search, Plus, Calendar, Settings2, AlertCircle, LayoutGrid, List, BarChart3, Send } from "lucide-react";
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
import { DraggableKanbanBoard, KanbanColumn } from "@/modules/pipelines/components/kanban/DraggableKanbanBoard";
import { KanbanFilterPanel, FilterChips, type FilterSectionConfig } from "@/modules/pipelines/components/kanban/KanbanFilterPanel";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { useCanDo } from "@/modules/identity";
import { StageWorkflowsBadgeWrapper } from "@/modules/pipelines/components/kanban/StageWorkflowsBadgeWrapper";
import { MergedFunnelCardActions } from "@/modules/pipelines/components/kanban/MergedFunnelCardActions";
import { supabase } from "@/integrations/supabase/client";
import { useStageWorkflowCounts } from "@/modules/workflows/hooks/useStageWorkflows";
import { useCreatePipeWhatsapp, useUpdatePipeWhatsapp, useDeletePipeWhatsapp, type PipeWhatsappStatus } from "@/modules/pipelines/hooks/legacy/usePipeWhatsapp";
import { usePaginatedPipeline } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";
import { upsertLeadIntoCustomPipe } from "@/modules/pipelines/lib/stageTransition";
import { useQueryClient } from "@tanstack/react-query";
import { type MetricsPeriodState, getDateRange, createInitialPeriodState } from "@/lib/metrics-period";
import { MetricsPeriodSelector } from "@/modules/pipelines/components/shared/MetricsPeriodSelector";
import { GhostLeadsBanner } from "@/modules/pipelines/components/shared/GhostLeadsBanner";
import { PipeWhatsappAnalytics } from "@/modules/pipelines/components/shared/PipeWhatsappAnalytics";
import { PipeViewToggle } from "@/modules/pipelines/components/shared/PipeViewToggle";
import { usePipelineStages, stagesToColumns, getPipelineTypeName } from "@/modules/pipelines/hooks/model/usePipelineStages";
import { PipeSettingsDialog } from "@/modules/pipelines/components/shared/PipeSettingsDialog";
import { useCreatePipeProposta } from "@/modules/pipelines/hooks/legacy/usePipePropostas";
import { useResponsibleMembers } from "@/modules/identity";
import { useDeleteAllLeadsInPipe, useUpdateLead } from "@/modules/leads";
import { useUserRole, useFeaturePermission } from "@/modules/identity";
import { useLogLeadAction } from "@/modules/leads";
import { useCreateAcaoDoDia } from "@/modules/engagement/hooks/useAcoesDoDia";
import { LeadCard, type LeadCardData } from "@/modules/leads";
import { LeadPanelProvider, useLeadSheet, LeadDetailSheet } from "@/modules/leads";
import { LeadPanelLayout } from "@/modules/platform/components/layout/LeadPanelLayout";
import { LeadModal } from "@/modules/leads";
import { CreateOpportunityModal } from "@/modules/pipelines/components/kanban/CreateOpportunityModal";
import { DisparoWizard, type DisparoBoardFilter, type DisparoSource } from "@/modules/pipelines/components/disparo";
import { ExportStageDialog } from "@/modules/pipelines/components/kanban/ExportStageDialog";
import { AddMeetingModal } from "@/modules/pipelines/components/legacy/confirmacao/AddMeetingModal";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import * as Sentry from "@sentry/react";
import { getErrorMessage } from "@/shared/errors";
import { useOrganization } from "@/modules/identity";
import { track, trackModuleVisit } from "@/lib/analytics";
import { useLeadsWithScheduledMessages } from "@/modules/communication/hooks/useScheduledMessages";
import { useBatchedLeadMetrics } from "@/modules/leads";
import { useTags } from "@/modules/leads/hooks/useTags";
import { useBulkSelection } from "@/shared/hooks/useBulkSelection";
import { BulkActionBar } from "@/modules/leads/components/bulk-actions/BulkActionBar";
import { PipeTableView } from "@/modules/pipelines/components/kanban/PipeTableView";
import { PipelineListView } from "@/modules/pipelines/components/kanban/PipelineListView";
import { useViewport } from "@/shared/hooks/use-viewport";
import { SavedViewsDropdown } from "@/modules/platform/components/saved-views/SavedViewsDropdown";
import { useSearchParams } from "react-router-dom";


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
  viewMode: "kanban" | "list" | "analytics";
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
    (v: "kanban" | "list" | "analytics") => setFilterState((f) => ({ ...f, viewMode: v })),
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
  const [isDisparoOpen, setIsDisparoOpen] = useState(false);
  // Disparo source on open: "estagio" for the header button, "manual" when
  // launched from the bulk-bar with a kanban selection seeded.
  const [disparoSource, setDisparoSource] = useState<DisparoSource>("estagio");
  const [disparoManualIds, setDisparoManualIds] = useState<string[]>([]);
  const { openLead } = useLeadSheet();
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pipeId: string; leadId: string } | null>(null);
  const [stageToDelete, setStageToDelete] = useState<{ id: string; title: string } | null>(null);
  const [stageToExport, setStageToExport] = useState<{ id: string; title: string; count: number } | null>(null);
  const [meetingModal, setMeetingModal] = useState<{
    open: boolean;
    pipeId: string;
    newStatus: string;
    fromStatus: string;
    leadId: string;
    sdrId: string | null;
    closerId: string | null;
  } | null>(null);
  const [periodState, setPeriodState] = useState<MetricsPeriodState>(createInitialPeriodState);

  const { organizationId } = useOrganization();
  useEffect(() => { trackModuleVisit("pipe_whatsapp", organizationId); }, []);

  const { data: pipelineStages = [], isLoading: loadingStages } = usePipelineStages("whatsapp");
  const { stageData, allItems: pipeData, isLoading, organizationId: paginatedOrgId } = usePaginatedPipeline(
    "whatsapp",
    pipelineStages,
    {
      search: searchTerm,
      responsibleId: filterResponsible,
      tagIds: filterTags,
    }
  );
  const isError = false;
  const queryClient = useQueryClient();
  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["pipeline-page", "whatsapp"] });
    queryClient.invalidateQueries({ queryKey: ["pipeline-stage-counts", "whatsapp"] });
  }, [queryClient]);
  const { data: workflowCounts = {} } = useStageWorkflowCounts("whatsapp");
  const metricsRange = useMemo(() => getDateRange(periodState), [periodState]);
  // Janela da coorte do Funil de Saúde (aba Analytics): segue o período
  // selecionado; "Geral" (sem range) = janela ampla = todos os leads.
  const healthRange = useMemo(() => {
    if (metricsRange) {
      return { start: new Date(metricsRange.startStr), end: new Date(metricsRange.endStr) };
    }
    return { start: new Date("2015-01-01T00:00:00Z"), end: new Date() };
  }, [metricsRange]);

  const { data: userRole } = useUserRole();
  const createPipeWhatsapp = useCreatePipeWhatsapp();
  const updatePipeWhatsapp = useUpdatePipeWhatsapp();
  const { allowed: canMovePipe } = useCanDo("move_pipe_record");
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

  // Board filter handed to the Disparo "Filtro ativo" source. Mirrors EXACTLY
  // the dimensions usePaginatedPipeline resolves server-side (search,
  // responsible, tags) — origin/scheduled/period are page-only and deliberately
  // excluded (the wizard surfaces this honestly). Chips carry human labels so
  // the operator sees what's honored; the page owns the member/tag dictionaries.
  const disparoBoardFilter: DisparoBoardFilter = useMemo(() => {
    const chips: string[] = [];
    const term = searchTerm.trim();
    if (term) chips.push(`Busca: "${term}"`);
    if (filterResponsible && filterResponsible !== "all") {
      const member = responsibleMembers.find((m: any) => m.id === filterResponsible);
      chips.push(`Responsável: ${member?.name ?? "selecionado"}`);
    }
    if (filterTags.length > 0) {
      const names = filterTags
        .map((id) => orgTags.find((t: any) => t.id === id)?.name)
        .filter(Boolean) as string[];
      if (names.length > 0) chips.push(`Tags: ${names.join(", ")}`);
    }
    return {
      search: searchTerm,
      responsibleId: filterResponsible,
      tagIds: filterTags,
      chips,
    };
  }, [searchTerm, filterResponsible, filterTags, responsibleMembers, orgTags]);

  // Bulk-bar → Disparo (Manual). Seed the kanban selection and open the wizard
  // in "manual" mode. Defined HERE (pipelines page may import both modules), so
  // BulkActionBar never imports pipelines — the forbidden direction stays clean.
  const handleDispararManual = useCallback((leadIds: string[]) => {
    setDisparoManualIds(leadIds);
    setDisparoSource("manual");
    setIsDisparoOpen(true);
  }, []);

  // Header "Disparo" button always opens the stage source.
  const handleOpenDisparoStage = useCallback(() => {
    setDisparoManualIds([]);
    setDisparoSource("estagio");
    setIsDisparoOpen(true);
  }, []);

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
      // ── Confirmação de reunião (funil mergeado — ADR-0004) ──
      stageKey: item.status ?? item.stage_key ?? null,
      meetingDate: item.meeting_date ?? item.metadata?.meeting_date ?? null,
      confirmationStatus:
        item.metadata?.confirmation_status ?? (item.is_confirmed ? "confirmado" : "pendente"),
    };
  };

  // Client-side filters that can't be server-side (origin, scheduled, date range)
  const filterItemsLocal = (item: any) => {
    const lead = item.lead;
    if (!lead) return false;

    if (metricsRange) {
      if (!item.created_at) return false;
      if (item.created_at < metricsRange.startStr || item.created_at > metricsRange.endStr) return false;
    }

    const matchesOrigin = filterOrigin === "all" || lead?.origin === filterOrigin;
    const matchesScheduled = !filterScheduled || (leadsWithSchedule?.has(item.lead_id) ?? false);
    return matchesOrigin && matchesScheduled;
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

  // Stage final_negative da org — destino do "Marcar perdido" (funil mergeado).
  const lostStageKey = useMemo(
    () => pipelineStages.find((s) => s.is_final_negative)?.stage_key ?? null,
    [pipelineStages],
  );

  // Build columns from server-paginated stageData
  const columns = useMemo((): KanbanColumn<LeadCardData>[] => {
    return statusColumns.map(col => {
      const sd = stageData[col.id];
      const items = sd
        ? sd.items.filter(filterItemsLocal).map(transformToCard)
        : [];
      return {
        ...col,
        items,
        totalCount: sd?.totalCount ?? items.length,
        hasMore: sd?.hasMore ?? false,
        isFetchingMore: sd?.isFetchingMore ?? false,
        onLoadMore: sd?.fetchMore,
      };
    });
  }, [stageData, statusColumns, filterOrigin, filterScheduled, leadsWithSchedule, metricsRange, metricsMap]);

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
      .filter(filterItemsLocal)
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
  }, [pipeData, filterOrigin, filterScheduled, leadsWithSchedule, metricsRange]);

  const handleMobileLeadClick = useCallback((leadId: string) => {
    const item = pipeData?.find((p) => p.lead_id === leadId);
    if (item) openLead(item.lead_id, item.id);
  }, [pipeData, openLead]);

  // Count "ghost leads" — rows do pipe que o usuário enxerga mas cujo join
  // com `leads` retornou null. Indica divergência entre RLS do pipe e de
  // `leads` (ex.: responsible_id do pipe aponta para o usuário, mas sdr_id
  // do lead aponta para outro — ou drift entre as duas tabelas).
  const ghostLeadsCount = useMemo(() => {
    if (!pipeData) return 0;
    return pipeData.filter(item => item.lead == null).length;
  }, [pipeData]);

  // Itens para o Analytics — respeita o período selecionado (subset carregado)
  const analyticsItems = useMemo(() => {
    if (!pipeData) return [];
    if (!metricsRange) return pipeData;
    return pipeData.filter(
      (it) => it.created_at && it.created_at >= metricsRange.startStr && it.created_at <= metricsRange.endStr
    );
  }, [pipeData, metricsRange]);

  // Handle status change from drag-and-drop
  const handleStatusChange = async (itemId: string, newStatus: string) => {
    const item = pipeData?.find(p => p.id === itemId);
    if (!item) return;

    const movedStage = pipelineStages.find(s => s.stage_key === newStatus);
    // Destino pode ser um funil customizado (target_pipeline_id/target_stage_id)
    // OU um pipe padrão (target_pipe_type/target_stage_key) — mutuamente exclusivos.
    const hasCustomTarget = !!(movedStage?.target_pipeline_id && movedStage?.target_stage_id);
    // `confirmacao` is the fallback target when a success stage has no
    // target_pipe_type configured — matches the legacy default below. Não aplica
    // quando o destino é um funil customizado.
    const resolvedTargetPipe = movedStage?.target_pipe_type || "confirmacao";

    // Intercept BEFORE committing the stage change: moves into a success stage
    // that targets `confirmacao` require a meeting to be scheduled. Open the
    // modal first and defer the pipe_whatsapp status update to its onSuccess.
    // If the user cancels the modal, the card stays where it was.
    if (movedStage?.is_final_positive && !hasCustomTarget && resolvedTargetPipe === "confirmacao") {
      setMeetingModal({
        open: true,
        pipeId: itemId,
        newStatus,
        fromStatus: item.status,
        leadId: item.lead_id,
        sdrId: item.sdr_id ?? null,
        closerId: item.lead?.closer?.id ?? null,
      });
      return;
    }

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
      if (movedStage?.is_final_positive && hasCustomTarget) {
        // Destino = funil customizado da org.
        if (organizationId) {
          await upsertLeadIntoCustomPipe({
            leadId: item.lead_id,
            organizationId,
            targetPipelineId: movedStage.target_pipeline_id!,
            targetStageId: movedStage.target_stage_id!,
          });
          queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
        }
        toast.success("Lead movido para o funil de destino automaticamente!");
      } else if (movedStage?.is_final_positive) {
        const targetStage = movedStage.target_stage_key || "reuniao_marcada"; // fallback
        const targetPipeName = getPipelineTypeName(resolvedTargetPipe as any);

        if (resolvedTargetPipe === "propostas") {
          // Idempotência: não duplicar entry em Orçamentos se o lead já estiver lá
          // (ex: mover o card de volta pra Compareceu uma segunda vez).
          const { data: existing } = await supabase
            .from("pipe_propostas")
            .select("id")
            .eq("lead_id", item.lead_id)
            .limit(1);
          if (!existing || existing.length === 0) {
            await createPipeProposta.mutateAsync({
              lead_id: item.lead_id,
              closer_id: item.lead?.closer?.id || null,
              status: targetStage,
            });
          }
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

  const handleMobileMove = useCallback(
    async (leadId: string, newStageKey: string) => {
      const item = pipeData?.find((p) => p.lead_id === leadId);
      if (item) await handleStatusChange(item.id, newStageKey);
    },
    [pipeData, handleStatusChange]
  );

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
          <PipeViewToggle
            value={viewMode}
            onChange={setViewMode}
            layoutId="pipe-whatsapp-view-indicator"
            options={[
              { value: "kanban", icon: LayoutGrid, label: "Kanban" },
              { value: "list", icon: List, label: "Lista" },
              { value: "analytics", icon: BarChart3, label: "Analytics" },
            ]}
          />
          <Button size="sm" variant="outline" onClick={() => setIsSettingsOpen(true)}>
            <Settings2 className="w-4 h-4 mr-2" />
            Configurações
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-primary/30 text-foreground hover:border-primary/60 hover:bg-primary/5"
            onClick={handleOpenDisparoStage}
          >
            <Send className="w-4 h-4 mr-2 text-primary" />
            Disparo
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

      {/* Período (segue para a coorte do Funil de Saúde no Analytics) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <MetricsPeriodSelector state={periodState} onChange={setPeriodState} />
      </div>

      {/* Filters — ocultos no modo Analytics (são específicos do board) */}
      {viewMode !== "analytics" && (
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
      )}

      {/* Period filter indicator — aparece quando um período está selecionado */}
      {viewMode !== "analytics" && metricsRange && (
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

      {/* Analytics / Kanban Board / List View / Mobile List View */}
      {viewMode === "analytics" ? (
        <PipeWhatsappAnalytics
          items={analyticsItems}
          range={healthRange}
          responsibleMembers={responsibleMembers}
        />
      ) : isMobile ? (
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
              extraActions={
                <MergedFunnelCardActions
                  entryId={card.id}
                  stageKey={card.stageKey}
                  meetingDate={card.meetingDate}
                  confirmationStatus={card.confirmationStatus}
                  lostStageKey={lostStageKey}
                  onMoveStage={(toStage) => handleStatusChange(card.id, toStage)}
                  leadId={card.leadId}
                  leadName={card.name}
                  leadCompany={card.company}
                  leadPhone={card.phone}
                />
              }
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

      {/* Disparo Wizard (Mass Send — stage / active filter / manual sources).
          Mounted only while open so its audience-resolution queries (stage /
          filtered lead ids) never run in the background on the funnel page. */}
      {isDisparoOpen && (
        <DisparoWizard
          open={isDisparoOpen}
          onOpenChange={setIsDisparoOpen}
          boardFilter={disparoBoardFilter}
          initialSource={disparoSource}
          initialManualLeadIds={disparoManualIds}
        />
      )}

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

      {/* AddMeetingModal — opened when a lead is dragged to an "agendado" stage.
          The pipe_whatsapp stage change is deferred until the meeting is saved;
          closing the modal cancels the move. */}
      {meetingModal && (
        <AddMeetingModal
          open={meetingModal.open}
          onOpenChange={(isOpen) => {
            if (!isOpen) setMeetingModal(null);
          }}
          prefilledLeadId={meetingModal.leadId}
          prefilledResponsibleId={meetingModal.sdrId ?? undefined}
          onSuccess={async () => {
            const pending = meetingModal;
            setMeetingModal(null);
            const stageLabel = statusColumns.find(c => c.id === pending.newStatus)?.title || pending.newStatus;
            try {
              await updatePipeWhatsapp.mutateAsync({
                id: pending.pipeId,
                status: pending.newStatus as PipeWhatsappStatus,
                leadId: pending.leadId,
                sdrId: pending.sdrId ?? undefined,
              });
              logAction({ leadId: pending.leadId, action: "stage_changed", description: `Etapa alterada para "${stageLabel}" no Funil WhatsApp` });
              if (organizationId) track({ event: "card_moved", organizationId, entityType: "pipe_whatsapp", entityId: pending.pipeId, metadata: { from_stage: pending.fromStatus, to_stage: pending.newStatus } });
              toast.success("Reunião agendada e lead movido para Confirmação!");
            } catch (err) {
              console.error("[PipeWhatsapp] Falha ao mover card após agendar reunião:", err);
              Sentry.captureException(err, {
                tags: { feature: "pipelines", kind: "post-meeting-move-failed" },
                extra: { pipeId: pending.pipeId, leadId: pending.leadId, toStage: pending.newStatus },
              });
              toast.error("Reunião agendada, mas não foi possível mover o card no funil", {
                description: getErrorMessage(err),
              });
            } finally {
              refetch();
            }
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
