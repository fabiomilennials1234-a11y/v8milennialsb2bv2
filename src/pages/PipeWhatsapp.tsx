import { useState, useMemo, useEffect } from "react";
import { AlertCircle, Clock, Globe, User, Users, Target } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DraggableKanbanBoard, KanbanColumn } from "@/components/kanban/DraggableKanbanBoard";
import { TorqueLoader } from "@/components/branding/TorqueLoader";
import { useCanPerformAction } from "@/lib/permissions";
import { StageWorkflowsBadgeWrapper } from "@/components/kanban/StageWorkflowsBadgeWrapper";
import { useStageWorkflowCounts } from "@/hooks/useStageWorkflows";
import { usePipeWhatsapp, useCreatePipeWhatsapp, useUpdatePipeWhatsapp, useDeletePipeWhatsapp, type PipeWhatsappStatus } from "@/hooks/usePipeWhatsapp";
import { usePipeWhatsappMetrics } from "@/hooks/usePipeMetrics";
import { type MetricsPeriodState, getDateRange, createInitialPeriodState } from "@/lib/metrics-period";
import { PipeHeader } from "@/components/pipelines/PipeHeader";
import { PipeStatsRow, type PipeStat } from "@/components/pipelines/PipeStatsRow";
import { PipeFilterBar, type FilterChip } from "@/components/pipelines/PipeFilterBar";
import { PipePeriodChip } from "@/components/pipelines/PipePeriodChip";
import { DeletePipeCardDialog, DeleteStageLeadsDialog } from "@/components/pipelines/DeletePipeCardDialog";
import { usePipelineStages, stagesToColumns, getPipelineTypeName } from "@/hooks/usePipelineStages";
import { PipeSettingsDialog } from "@/components/pipelines/PipeSettingsDialog";
import { useCreatePipeProposta } from "@/hooks/usePipePropostas";
import { useResponsibleMembers } from "@/hooks/useTeamMembers";
import { useDeleteAllLeadsInPipe, useUpdateLead } from "@/hooks/useLeads";
import { useFeaturePermission } from "@/hooks/useUserRole";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useCreateAcaoDoDia } from "@/hooks/useAcoesDoDia";
import { LeadCard, type LeadCardData } from "@/components/leads/LeadCard";
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer";
import { WhatsAppContext } from "@/components/leads/funnel-contexts";
import { LeadModal } from "@/components/leads/LeadModal";
import { CreateOpportunityModal } from "@/components/kanban/CreateOpportunityModal";
import { AddMeetingModal } from "@/components/confirmacao/AddMeetingModal";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { useOrganization } from "@/hooks/useOrganization";
import { track, trackModuleVisit } from "@/lib/analytics";
import { useLeadsWithScheduledMessages } from "@/hooks/useScheduledMessages";

const originLabels: Record<string, { label: string }> = {
  whatsapp: { label: "WhatsApp" },
  meta_ads: { label: "Meta Ads" },
  instagram: { label: "Instagram" },
  tiktok: { label: "Tiktok" },
  google_ads: { label: "Google Ads" },
  site: { label: "Site" },
  landing_page: { label: "Landing Page" },
  remarketing: { label: "Remarketing" },
  indicacao: { label: "Indicação" },
  evento: { label: "Evento" },
  prospeccao_ativa: { label: "Prospecção Ativa" },
  cal: { label: "Cal.com" },
  outro: { label: "Outros" },
};

const ALL_ORIGIN_OPTIONS = [
  "whatsapp", "meta_ads", "instagram", "tiktok", "google_ads", "site", "landing_page",
  "remarketing", "indicacao", "evento", "prospeccao_ativa", "cal", "outro",
];

export default function PipeWhatsapp() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterResponsible, setFilterResponsible] = useState("all");
  const [filterOrigin, setFilterOrigin] = useState("all");
  const { data: leadsWithSchedule } = useLeadsWithScheduledMessages();
  const [filterScheduled, setFilterScheduled] = useState(false);
  const [isCreateLeadModalOpen, setIsCreateLeadModalOpen] = useState(false);
  const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pipeId: string; leadId: string } | null>(null);
  const [stageToDelete, setStageToDelete] = useState<{ id: string; title: string } | null>(null);
  const [meetingModal, setMeetingModal] = useState<{
    open: boolean;
    leadId: string;
    sdrId: string | null;
    closerId: string | null;
  } | null>(null);
  const [periodState, setPeriodState] = useState<MetricsPeriodState>(createInitialPeriodState);

  const { organizationId } = useOrganization();
  useEffect(() => { trackModuleVisit("pipe_whatsapp", organizationId); }, []);

  const { data: pipeData, isLoading, isError, refetch } = usePipeWhatsapp();
  const { data: pipelineStages = [] } = usePipelineStages("whatsapp");
  const { data: workflowCounts = {} } = useStageWorkflowCounts("whatsapp");
  const metricsRange = useMemo(() => getDateRange(periodState), [periodState]);
  const { data: metricsByPeriod } = usePipeWhatsappMetrics(metricsRange);

  useCreatePipeWhatsapp();
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

  // ─── Filters state for filter bar chips ────────────────────────
  const activeFiltersCount =
    (filterOrigin !== "all" ? 1 : 0) +
    (filterResponsible !== "all" ? 1 : 0) +
    (filterScheduled ? 1 : 0);

  const clearAllFilters = () => {
    setFilterOrigin("all");
    setFilterResponsible("all");
    setFilterScheduled(false);
  };

  const primaryFilters: FilterChip[] = [
    {
      id: "origin",
      icon: Globe,
      label: "Origem",
      activeLabel: filterOrigin !== "all" ? originLabels[filterOrigin]?.label || filterOrigin : null,
      onClear: () => setFilterOrigin("all"),
      renderControl: () => (
        <Select value={filterOrigin} onValueChange={setFilterOrigin}>
          <SelectTrigger className="border-0 bg-transparent h-7 px-1 text-xs focus:ring-0 focus:ring-offset-0 shadow-none gap-1">
            <Globe className="w-3 h-3 mr-1 opacity-70" />
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas origens</SelectItem>
            {ALL_ORIGIN_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>{originLabels[o]?.label || o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      id: "responsible",
      icon: User,
      label: "Responsável",
      activeLabel: filterResponsible !== "all" ? responsibleMembers.find((m) => m.id === filterResponsible)?.name : null,
      onClear: () => setFilterResponsible("all"),
      renderControl: () => (
        <Select value={filterResponsible} onValueChange={setFilterResponsible}>
          <SelectTrigger className="border-0 bg-transparent h-7 px-1 text-xs focus:ring-0 focus:ring-offset-0 shadow-none gap-1">
            <User className="w-3 h-3 mr-1 opacity-70" />
            <SelectValue placeholder="Responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os responsáveis</SelectItem>
            {responsibleMembers.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
  ];

  const extraActions = (
    <Button
      variant={filterScheduled ? "default" : "outline"}
      size="sm"
      onClick={() => setFilterScheduled(!filterScheduled)}
      className="h-9 gap-1.5"
    >
      <Clock className="w-3.5 h-3.5" />
      Agendados
    </Button>
  );

  const transformToCard = (item: any): LeadCardData => {
    const lead = item.lead;
    return {
      id: item.id,
      name: lead?.name || "Sem nome",
      company: lead?.company || "",
      phone: lead?.phone,
      email: lead?.email,
      rating: lead?.rating || 0,
      responsible: item.responsible?.name || item.sdr?.name || lead?.responsible?.name || lead?.sdr?.name,
      tags: lead?.lead_tags?.map((lt: any) => ({ name: lt.tag?.name, color: lt.tag?.color || "#888" })).filter((t: any) => t.name) || [],
      createdAt: item.created_at,
      faturamento: lead?.faturamento,
      urgency: lead?.urgency,
      date: lead?.compromisso_date ? new Date(lead.compromisso_date) : null,
      dateLabel: lead?.compromisso_date ? format(new Date(lead.compromisso_date), "dd MMM, HH:mm", { locale: ptBR }) : undefined,
      leadId: item.lead_id,
      origin: lead?.origin,
    };
  };

  const filterItems = (item: any) => {
    const lead = item.lead;
    if (!lead) return false;

    if (metricsRange) {
      if (!item.created_at) return false;
      if (item.created_at < metricsRange.startStr || item.created_at > metricsRange.endStr) return false;
    }

    const matchesSearch = searchTerm === "" ||
      lead?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead?.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead?.phone?.includes(searchTerm);

    const matchesResponsible = filterResponsible === "all" || item.responsible_id === filterResponsible || item.lead?.responsible_id === filterResponsible;
    const matchesOrigin = filterOrigin === "all" || lead?.origin === filterOrigin;
    const matchesScheduled = !filterScheduled || (leadsWithSchedule?.has(item.lead_id) ?? false);
    return matchesSearch && matchesResponsible && matchesOrigin && matchesScheduled;
  };

  const statusColumns = useMemo(() => {
    if (pipelineStages.length === 0) {
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

  const columns = useMemo((): KanbanColumn<LeadCardData>[] => {
    if (!pipeData) return statusColumns.map(col => ({ ...col, items: [] }));

    return statusColumns.map(col => {
      const columnItems = pipeData
        .filter(item => item.status === col.id)
        .filter(filterItems)
        .map(transformToCard);

      return { ...col, items: columnItems };
    });
  }, [pipeData, pipelineStages, statusColumns, searchTerm, filterResponsible, filterOrigin, filterScheduled, leadsWithSchedule, metricsRange]);

  const stats = useMemo(() => {
    if (!pipeData) return { total: 0, abordado: 0, respondeu: 0, scheduled: 0, pending: 0 };

    const filteredData = pipeData.filter(filterItems);

    const total = filteredData.length;
    const abordado = filteredData.filter(item => item.status === "abordado").length;
    const respondeu = filteredData.filter(item => item.status === "respondeu").length;
    const scheduled = filteredData.filter(item => item.status === "agendado").length;
    const pending = filteredData.filter(item => item.status === "novo").length;

    return { total, abordado, respondeu, scheduled, pending };
  }, [pipeData, searchTerm, filterResponsible, filterOrigin, filterScheduled, leadsWithSchedule, metricsRange]);

  const displayStats = useMemo(() => {
    if (!metricsRange || !metricsByPeriod) return stats;
    return metricsByPeriod;
  }, [metricsRange, metricsByPeriod, stats]);

  const statsRow: PipeStat[] = [
    {
      id: "total",
      label: "Total",
      value: displayStats.total,
      sublabel: "leads no funil",
      hero: true,
      tone: "primary",
    },
    {
      id: "abordado",
      label: "Abordados",
      value: displayStats.abordado,
      sublabel: "contato iniciado",
      tone: "success",
    },
    {
      id: "respondeu",
      label: "Respondeu",
      value: displayStats.respondeu,
      sublabel: "engajaram",
      tone: "chart-4",
    },
    {
      id: "scheduled",
      label: "Agendados",
      value: displayStats.scheduled,
      sublabel: "reunião marcada",
      tone: "chart-5",
    },
  ];

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

      const movedStage = pipelineStages.find(s => s.stage_key === newStatus);
      if (movedStage?.is_final_positive) {
        const targetPipe = movedStage.target_pipe_type || "confirmacao";
        const targetStage = movedStage.target_stage_key || "reuniao_marcada";
        const targetPipeName = getPipelineTypeName(targetPipe as any);

        if (targetPipe === "confirmacao") {
          setMeetingModal({
            open: true,
            leadId: item.lead_id,
            sdrId: item.sdr_id ?? null,
            closerId: item.lead?.closer?.id ?? null,
          });
          return;
        } else if (targetPipe === "propostas") {
          await createPipeProposta.mutateAsync({
            lead_id: item.lead_id,
            closer_id: item.lead?.closer?.id || null,
            status: targetStage,
          });
        }

        toast.success(`Lead movido para ${targetPipeName} automaticamente!`);
      } else {
        toast.success("Status atualizado!");
      }
    } catch (error) {
      toast.error("Erro ao atualizar status");
      console.error(error);
    }
  };

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
    <div className="space-y-5">
      <PipeHeader
        title="Funil de Qualificação"
        subtitle="Arraste cards para mudar de etapa"
        count={displayStats.total}
        countLabel="leads"
        onOpenSettings={() => setIsSettingsOpen(true)}
        primaryActions={[
          {
            id: "opportunity",
            label: "Nova oportunidade",
            description: "Adicionar lead existente ao funil",
            icon: Target,
            onClick: () => setIsOpportunityModalOpen(true),
          },
          {
            id: "lead",
            label: "Novo lead",
            description: "Cadastrar lead do zero",
            icon: Users,
            onClick: () => setIsCreateLeadModalOpen(true),
          },
        ]}
      />

      <PipeStatsRow stats={statsRow} showDeltaPlaceholder={false} />

      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-2 justify-between">
        <PipeFilterBar
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="Buscar lead, empresa, telefone..."
          primaryFilters={primaryFilters}
          extraActions={extraActions}
          activeFiltersCount={activeFiltersCount}
          onClearAll={clearAllFilters}
        />
        <PipePeriodChip state={periodState} onChange={setPeriodState} activeRange={metricsRange} />
      </div>

      <DraggableKanbanBoard
        columns={columns}
        onStatusChange={handleStatusChange}
        disabled={!canMovePipe}
        onDeleteAllLeads={(stageId, stageTitle) => setStageToDelete({ id: stageId, title: stageTitle })}
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
            onClick={() => {
              const item = pipeData?.find(p => p.id === card.id);
              if (item) {
                setSelectedItem(item);
                setIsDetailDrawerOpen(true);
              }
            }}
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

      <PipeSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        pipeType="whatsapp"
        stages={pipelineStages}
      />

      <CreateOpportunityModal
        open={isOpportunityModalOpen}
        onOpenChange={setIsOpportunityModalOpen}
        onSuccess={() => refetch()}
      />

      <LeadModal
        open={isCreateLeadModalOpen}
        onOpenChange={setIsCreateLeadModalOpen}
        lead={null}
        onSuccess={() => refetch()}
      />

      <LeadDetailDrawer
        open={isDetailDrawerOpen}
        onOpenChange={setIsDetailDrawerOpen}
        leadId={selectedItem?.lead_id || null}
        variant="whatsapp"
        pipeData={selectedItem}
        onSuccess={refetch}
        renderFunnelContext={({ lead, pipeData: pd, onSuccess: onCtxSuccess }) => (
          <WhatsAppContext lead={lead} pipeData={pd} onSuccess={onCtxSuccess} />
        )}
      />

      <DeletePipeCardDialog
        open={!!deleteDialog?.open}
        onOpenChange={(open) => !open && setDeleteDialog(null)}
        onConfirm={handleDelete}
      />

      <DeleteStageLeadsDialog
        stageToDelete={stageToDelete}
        onOpenChange={(open) => { if (!open) setStageToDelete(null); }}
        funnelName="Qualificação (WhatsApp)"
        isPending={deleteAllLeadsInPipe.isPending}
        onConfirm={async (stageId, stageTitle) => {
          try {
            const result = await deleteAllLeadsInPipe.mutateAsync({ stageId });
            setStageToDelete(null);
            refetch();
            toast.success(result?.deleted ? `${result.deleted} leads excluídos da etapa "${stageTitle}".` : "Leads da etapa excluídos.");
          } catch (e) {
            toast.error("Erro ao excluir leads.");
          }
        }}
      />

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
