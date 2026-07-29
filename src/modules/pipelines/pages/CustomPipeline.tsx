import { useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Search,
  Loader2,
  AlertTriangle,
  Trash2,
  Kanban,
  Target,
  Users,
  ShoppingBag,
  Heart,
  Briefcase,
  Star,
  Zap,
  Gift,
  Send,
} from "lucide-react";
import {
  useCustomPipeline,
  useCustomPipelineStages,
  useCustomPipeEntries,
  useRemoveLeadFromCustomPipe,
  useDeleteCustomPipeline,
  useMoveLeadInCustomPipe,
} from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import { CustomPipelineKanban } from "@/modules/pipelines/components/custom/CustomPipelineKanban";
import { KanbanFilterPanel, FilterChips, type FilterSectionConfig } from "@/modules/pipelines/components/kanban/KanbanFilterPanel";
import { matchesQualificationFilters } from "@/modules/pipelines/lib/kanbanFilterParams";
import { PipelineListView } from "@/modules/pipelines/components/kanban/PipelineListView";
import { useViewport } from "@/shared/hooks/use-viewport";
import { DealPanelProvider, useDealSheet, DealDetailDialog } from "@/modules/leads";
import { LeadPanelLayout } from "@/modules/platform/components/layout/LeadPanelLayout";
import { AddLeadToPipeModal } from "@/modules/pipelines/components/custom/AddLeadToPipeModal";
import { CustomPipeSettingsDialog } from "@/modules/pipelines/components/custom/CustomPipeSettingsDialog";
import { DisparoWizard } from "../components/disparo";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { useFeaturePermission } from "@/modules/identity";
const ICON_MAP: Record<string, LucideIcon> = {
  kanban: Kanban,
  target: Target,
  users: Users,
  "shopping-bag": ShoppingBag,
  heart: Heart,
  briefcase: Briefcase,
  star: Star,
  zap: Zap,
  gift: Gift,
};

function CustomPipelinePageInner() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const { openDeal } = useDealSheet();
  const [searchQuery, setSearchQuery] = useState("");
  const [qualificationTier, setQualificationTier] = useState<string[]>([]);
  const [preQualificationTier, setPreQualificationTier] = useState<string[]>([]);
  const [showAddLead, setShowAddLead] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [removeEntryId, setRemoveEntryId] = useState<string | null>(null);
  const [showDeletePipeline, setShowDeletePipeline] = useState(false);
  const [isDisparoOpen, setIsDisparoOpen] = useState(false);

  const { data: pipeline, isLoading: loadingPipeline } = useCustomPipeline(slug);
  const { data: stages = [], isLoading: loadingStages } = useCustomPipelineStages(pipeline?.id);
  const { data: entries = [], isLoading: loadingEntries } = useCustomPipeEntries(pipeline?.id);

  const removeLead = useRemoveLeadFromCustomPipe();
  const deletePipeline = useDeleteCustomPipeline();
  const moveLead = useMoveLeadInCustomPipe();
  const { allowed: canDeletePipeline } = useFeaturePermission("pipeline.delete");
  const { allowed: canDeleteCards } = useFeaturePermission("pipeline.delete_cards");

  const isLoading = loadingPipeline || loadingStages || loadingEntries;

  // Qualification-tier filter (client-side — este board não é paginado no
  // servidor). Aplicado às entries carregadas ANTES de alimentar o kanban e a
  // lista mobile, e propagado como `tierFilterActive` pro kanban derivar o
  // badge da contagem client-side (o RPC de count não conhece tier).
  const tierFilterActive = qualificationTier.length > 0 || preQualificationTier.length > 0;
  const tieredEntries = useMemo(
    () =>
      tierFilterActive
        ? entries.filter((e) =>
            matchesQualificationFilters(e.lead, qualificationTier, preQualificationTier),
          )
        : entries,
    [entries, tierFilterActive, qualificationTier, preQualificationTier],
  );

  const filterSections: FilterSectionConfig[] = useMemo(
    () => [
      { type: "qualification-tier", value: qualificationTier, onChange: setQualificationTier },
      { type: "pre-qualification-tier", value: preQualificationTier, onChange: setPreQualificationTier },
    ],
    [qualificationTier, preQualificationTier],
  );

  const handleClearFilters = useCallback(() => {
    setQualificationTier([]);
    setPreQualificationTier([]);
  }, []);

  // ── Mobile: lista por stage (PipelineListView) em vez do kanban drag-drop ──
  // Custom pipes usam stage_id (uuid) como chave. id = entry id.
  const { isMobile } = useViewport();
  const mobileStages = useMemo(
    () => stages.map((s) => ({ id: s.id, name: s.name, stage_key: s.id, color: s.color })),
    [stages],
  );
  const mobileLeads = useMemo(
    () =>
      tieredEntries.map((e) => ({
        id: e.id,
        name: e.lead?.name || "Sem nome",
        company: e.lead?.company || undefined,
        phone: e.lead?.phone || undefined,
        rating: e.lead?.rating || 0,
        stage_key: e.stage_id,
        created_at: e.created_at,
      })),
    [tieredEntries],
  );
  const handleMobileLeadClick = useCallback(
    (entryId: string) => {
      const entry = entries.find((e) => e.id === entryId);
      if (entry) openDeal(entry.id, entry.lead_id);
    },
    [entries, openDeal],
  );
  const handleMobileMove = useCallback(
    (entryId: string, stageId: string) => {
      if (!pipeline) return;
      moveLead.mutateAsync({ entry_id: entryId, pipeline_id: pipeline.id, stage_id: stageId }).catch(() => {
        toast.error("Erro ao mover lead");
      });
    },
    [pipeline, moveLead],
  );

  const handleRemoveEntry = async () => {
    if (!removeEntryId || !pipeline) return;
    try {
      await removeLead.mutateAsync({ entry_id: removeEntryId, pipeline_id: pipeline.id });
      toast.success("Lead removido do funil");
      setRemoveEntryId(null);
    } catch {
      toast.error("Erro ao remover lead");
    }
  };

  const handleDeletePipeline = async () => {
    if (!pipeline) return;
    try {
      await deletePipeline.mutateAsync(pipeline.id);
      toast.success(`Funil "${pipeline.name}" excluído`);
      navigate("/");
    } catch {
      toast.error("Erro ao excluir funil");
    }
  };

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
        <Button variant="outline" onClick={() => navigate("/")}>
          Voltar ao Dashboard
        </Button>
      </div>
    );
  }

  const PipeIcon = ICON_MAP[pipeline.icon] || Kanban;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${pipeline.color}20` }}
          >
            <PipeIcon className="w-5 h-5" style={{ color: pipeline.color }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{pipeline.name}</h1>
            {pipeline.description && (
              <p className="text-sm text-muted-foreground truncate">{pipeline.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 [&>*]:shrink-0">
          {stages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="border-primary/30 text-foreground hover:border-primary/60 hover:bg-primary/5"
              onClick={() => setIsDisparoOpen(true)}
            >
              <Send className="w-4 h-4 mr-2 text-primary" />
              Disparo
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(true)}
          >
            <Settings2 className="w-4 h-4 mr-2" />
            Configurações
          </Button>
          <Button size="sm" onClick={() => setShowAddLead(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Lead
          </Button>
        </div>
      </div>

      {/* Stats + Search + Filtros */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar lead, empresa, telefone..."
              className="pl-9"
            />
          </div>
          {stages.length > 0 && (
            <KanbanFilterPanel sections={filterSections} onClearAll={handleClearFilters} />
          )}
          <div className="text-sm text-muted-foreground ml-auto shrink-0">
            {tieredEntries.length} {tieredEntries.length === 1 ? "lead" : "leads"} no funil
          </div>
        </div>
        <FilterChips sections={filterSections} onClearAll={handleClearFilters} />
      </div>

      {/* Kanban */}
      {stages.length > 0 ? (
        isMobile ? (
          <PipelineListView
            stages={mobileStages}
            leads={mobileLeads}
            onLeadClick={handleMobileLeadClick}
            onMoveLeadToStage={handleMobileMove}
            isLoading={isLoading}
          />
        ) : (
          <CustomPipelineKanban
            pipeline={pipeline}
            stages={stages}
            entries={tieredEntries}
            searchQuery={searchQuery}
            tierFilterActive={tierFilterActive}
            onRemoveEntry={canDeleteCards ? (id) => setRemoveEntryId(id) : undefined}
            onClickEntry={(entry) => {
              openDeal(entry.id, entry.lead_id);
            }}
          />
        )
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Kanban className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">Nenhuma etapa configurada</p>
          <p className="text-sm mt-1">Abra as configurações para criar etapas.</p>
          <Button variant="outline" className="mt-4" onClick={() => setShowSettings(true)}>
            <Settings2 className="w-4 h-4 mr-2" />
            Configurar Etapas
          </Button>
        </div>
      )}

      {/* Modals */}
      {pipeline && stages.length > 0 && (
        <AddLeadToPipeModal
          open={showAddLead}
          onOpenChange={setShowAddLead}
          pipelineId={pipeline.id}
          pipelineName={pipeline.name}
          stages={stages}
        />
      )}

      {pipeline && (
        <CustomPipeSettingsDialog
          open={showSettings}
          onOpenChange={setShowSettings}
          pipeline={pipeline}
          stages={stages}
          onRequestDelete={() => {
            setShowSettings(false);
            setShowDeletePipeline(true);
          }}
        />
      )}

      {/* Disparo Wizard (Mass Send — custom funnel context). Mounted only while
          open so the stage/conditions lead-id resolution never runs in the
          background on the funnel page. Custom stages carry uuid `id`s. */}
      {isDisparoOpen && pipeline && (
        <DisparoWizard
          open={isDisparoOpen}
          onOpenChange={setIsDisparoOpen}
          context={{
            kind: "custom",
            pipelineId: pipeline.id,
            stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color })),
          }}
        />
      )}

      {/* Confirmar exclusão do funil */}
      <AlertDialog open={showDeletePipeline} onOpenChange={setShowDeletePipeline}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Excluir Funil "{pipeline?.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O funil será desativado e deixará de aparecer na sidebar e em todas as listagens.
              <br /><br />
              <strong>Os leads e registros do sistema não serão apagados.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePipeline}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletePipeline.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Excluir Funil
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
              {removeLead.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function CustomPipelinePage() {
  return (
    <DealPanelProvider>
      <LeadPanelLayout panel={<DealDetailDialog />}>
        <CustomPipelinePageInner />
      </LeadPanelLayout>
    </DealPanelProvider>
  );
}
