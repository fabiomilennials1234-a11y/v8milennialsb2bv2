import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { Search, Plus, Zap, Globe, Calendar, Settings2, AlertCircle, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { DraggableKanbanBoard, KanbanColumn } from "@/components/kanban/DraggableKanbanBoard";
import { TorqueLoader } from "@/components/branding/TorqueLoader";
import { useCanPerformAction } from "@/lib/permissions";
import { StageWorkflowsBadgeWrapper } from "@/components/kanban/StageWorkflowsBadgeWrapper";
import { useStageWorkflowCounts } from "@/hooks/useStageWorkflows";
import { usePipeWhatsapp, useCreatePipeWhatsapp, useUpdatePipeWhatsapp, useDeletePipeWhatsapp, type PipeWhatsappStatus } from "@/hooks/usePipeWhatsapp";
import { usePipeWhatsappMetrics, type MetricsPeriod } from "@/hooks/usePipeMetrics";
import { usePipelineStages, stagesToColumns, getPipelineTypeName } from "@/hooks/usePipelineStages";
import { PipeSettingsDialog } from "@/components/pipelines/PipeSettingsDialog";
import { useCreatePipeProposta } from "@/hooks/usePipePropostas";
import { useResponsibleMembers } from "@/hooks/useTeamMembers";
import { useDeleteAllLeadsInPipe, useUpdateLead } from "@/hooks/useLeads";
import { useUserRole, useFeaturePermission } from "@/hooks/useUserRole";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useOrganization } from "@/hooks/useOrganization";
import { track, trackModuleVisit } from "@/lib/analytics";
import { useLeadsWithScheduledMessages } from "@/hooks/useScheduledMessages";

// Origin labels and colors mapping (origens do enum lead_origin)
const originLabels: Record<string, { label: string; color: string }> = {
  whatsapp: { label: "WhatsApp", color: "bg-green-500" },
  meta_ads: { label: "Meta Ads", color: "bg-purple-500" },
  instagram: { label: "Instagram", color: "bg-pink-500" },
  tiktok: { label: "Tiktok", color: "bg-gray-900" },
  google_ads: { label: "Google Ads", color: "bg-red-500" },
  site: { label: "Site", color: "bg-teal-500" },
  landing_page: { label: "Landing Page", color: "bg-sky-500" },
  remarketing: { label: "Remarketing", color: "bg-orange-500" },
  indicacao: { label: "Indicação", color: "bg-emerald-500" },
  evento: { label: "Evento", color: "bg-violet-500" },
  prospeccao_ativa: { label: "Prospecção Ativa", color: "bg-orange-600" },
  cal: { label: "Cal.com", color: "bg-blue-600" },
  outro: { label: "Outros", color: "bg-gray-500" },
};

// Origens para filtro (enum lead_origin), em ordem de exibição
const ALL_ORIGIN_OPTIONS = [
  "whatsapp", "meta_ads", "instagram", "tiktok", "google_ads", "site", "landing_page",
  "remarketing", "indicacao", "evento", "prospeccao_ativa", "cal", "outro",
];


// ---------------------------------------------------------------------------
// Persisted filter state — scoped per org + user, TTL 24 h
// ---------------------------------------------------------------------------
type WhatsappFilterState = {
  searchTerm: string;
  filterResponsible: string;
  filterOrigin: string;
};

const DEFAULT_WHATSAPP_FILTERS: WhatsappFilterState = {
  searchTerm: "",
  filterResponsible: "all",
  filterOrigin: "all",
};

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
  const [metricsPeriod, setMetricsPeriod] = useState<MetricsPeriod>("all");
  const now = new Date();
  const [selectedMetricsMonth, setSelectedMetricsMonth] = useState(now.getMonth() + 1);
  const [selectedMetricsYear, setSelectedMetricsYear] = useState(now.getFullYear());

  const { organizationId } = useOrganization();
  useEffect(() => { trackModuleVisit("pipe_whatsapp", organizationId); }, []);

  const { data: pipeData, isLoading, isError, refetch } = usePipeWhatsapp();
  const { data: pipelineStages = [], isLoading: loadingStages } = usePipelineStages("whatsapp");
  const { data: workflowCounts = {} } = useStageWorkflowCounts("whatsapp");
  const { data: metricsByPeriod } = usePipeWhatsappMetrics(
    metricsPeriod,
    metricsPeriod === "month" ? selectedMetricsMonth : undefined,
    metricsPeriod === "month" ? selectedMetricsYear : undefined
  );

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

  // Transform pipe data to LeadCardData format
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

  // Filter function for items
  // Filters out "ghost leads" where RLS blocks the lead data (lead relation is null)
  const filterItems = (item: any) => {
    const lead = item.lead;

    // Hide ghost leads (RLS blocked the lead data for this user)
    if (!lead) return false;

    // Search filter
    const matchesSearch = searchTerm === "" ||
      lead?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead?.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead?.phone?.includes(searchTerm);

    // Responsible filter
    const matchesResponsible = filterResponsible === "all" || item.responsible_id === filterResponsible || item.lead?.responsible_id === filterResponsible;

    // Origin filter
    const matchesOrigin = filterOrigin === "all" || lead?.origin === filterOrigin;

    const matchesScheduled = !filterScheduled || (leadsWithSchedule?.has(item.lead_id) ?? false);
    return matchesSearch && matchesResponsible && matchesOrigin && matchesScheduled;
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

  // Organize data by status columns
  const columns = useMemo((): KanbanColumn<LeadCardData>[] => {
    if (!pipeData) return statusColumns.map(col => ({ ...col, items: [] }));

    return statusColumns.map(col => {
      const columnItems = pipeData
        .filter(item => item.status === col.id)
        .filter(filterItems)
        .map(transformToCard);

      return {
        ...col,
        items: columnItems,
      };
    });
  }, [pipeData, pipelineStages, statusColumns, searchTerm, filterResponsible, filterOrigin]);

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
  }, [pipeData, searchTerm, filterResponsible, filterOrigin]);

  const displayStats = useMemo(() => {
    if (metricsPeriod === "all" || !metricsByPeriod) return stats;
    return metricsByPeriod;
  }, [metricsPeriod, metricsByPeriod, stats]);

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

      {/* Stats Bar - Updated based on filters and period */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
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

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar lead, empresa, telefone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        
        {/* Origin Filter */}
        <Select value={filterOrigin} onValueChange={setFilterOrigin}>
          <SelectTrigger className="w-[180px]">
            <Globe className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas Origens</SelectItem>
            {ALL_ORIGIN_OPTIONS.map(origin => (
              <SelectItem key={origin} value={origin}>
                {originLabels[origin]?.label || origin}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterResponsible} onValueChange={setFilterResponsible}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os responsáveis</SelectItem>
            {responsibleMembers.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant={filterScheduled ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterScheduled(!filterScheduled)}
          className="gap-1.5"
        >
          <Clock className="w-4 h-4" />
          Agendados
        </Button>
      </div>

      {/* Kanban Board with Drag-and-Drop */}
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

      {/* Lead Detail Drawer */}
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
            <AlertDialogTitle>Excluir leads da etapa "{stageToDelete?.title}"</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação irá excluir todos os leads que estão na etapa "{stageToDelete?.title}" do funil de Qualificação (WhatsApp) e na base de dados (histórico, tags, etc.). Leads em outras etapas não serão afetados. Não é possível desfazer.
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
                  toast.success(result?.deleted ? `${result.deleted} leads excluídos da etapa "${stageToDelete.title}".` : "Leads da etapa excluídos.");
                } catch (e) {
                  toast.error("Erro ao excluir leads.");
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteAllLeadsInPipe.isPending ? "Excluindo..." : "Excluir leads desta etapa"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
