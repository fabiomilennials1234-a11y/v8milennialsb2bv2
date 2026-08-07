import { useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  DealPanelProvider,
  useDealSheet,
  LeadPanelProvider,
  DealCardPanel,
  LeadCardPanel,
} from "@/modules/leads";
import { LeadPanelLayout } from "@/modules/platform/components/layout/LeadPanelLayout";
import { AddLeadToPipeModal } from "@/modules/pipelines/components/custom/AddLeadToPipeModal";
import { CustomPipeSettingsDialog } from "@/modules/pipelines/components/custom/CustomPipeSettingsDialog";
import { DisparoWizard } from "../components/disparo";
import { FunnelControlBar } from "@/modules/pipelines/components/shared/FunnelControlBar";
import { type MetricsPeriodState, getDateRange, createInitialPeriodState } from "@/lib/metrics-period";
import {
  getStalledBucket,
  matchesStalledBucket,
  STALLED_ALL,
} from "@/modules/pipelines/lib/stalled-buckets";
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
  const [periodState, setPeriodState] = useState<MetricsPeriodState>(createInitialPeriodState);
  const [filterStalled, setFilterStalled] = useState<string>(STALLED_ALL);
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
  const periodRange = useMemo(() => getDateRange(periodState), [periodState]);
  const stalledBucket = useMemo(() => getStalledBucket(filterStalled), [filterStalled]);

  // `tierFilterActive` continua significando "a contagem da coluna precisa ser
  // derivada no cliente" — agora vale pra qualquer um dos filtros client-side,
  // não só o de qualificação, senão o badge voltaria a contar o que a tela não
  // mostra.
  const tierFilterActive =
    qualificationTier.length > 0 ||
    preQualificationTier.length > 0 ||
    !!periodRange ||
    !!stalledBucket;

  const tieredEntries = useMemo(() => {
    if (!tierFilterActive) return entries;
    const periodStart = periodRange ? new Date(periodRange.startStr).getTime() : null;
    const periodEnd = periodRange ? new Date(periodRange.endStr).getTime() : null;
    const now = new Date();
    return entries.filter((e) => {
      if (!matchesQualificationFilters(e.lead, qualificationTier, preQualificationTier)) {
        return false;
      }
      if (periodStart !== null && periodEnd !== null) {
        // Comparação por timestamp, não por string: o Postgres devolve
        // "+00:00" e o range sai como "Z" — lexicograficamente eles não se
        // ordenam, mesmo apontando pro mesmo instante.
        const created = e.created_at ? new Date(e.created_at).getTime() : NaN;
        if (Number.isNaN(created) || created < periodStart || created > periodEnd) return false;
      }
      return matchesStalledBucket(
        (e as { stage_changed_at?: string | null }).stage_changed_at ?? e.created_at,
        stalledBucket,
        now,
      );
    });
  }, [entries, tierFilterActive, qualificationTier, preQualificationTier, periodRange, stalledBucket]);

  const filterSections: FilterSectionConfig[] = useMemo(
    () => [
      { type: "created-period", value: periodState, onChange: setPeriodState },
      { type: "stalled-days", value: filterStalled, onChange: setFilterStalled },
      { type: "qualification-tier", value: qualificationTier, onChange: setQualificationTier },
      { type: "pre-qualification-tier", value: preQualificationTier, onChange: setPreQualificationTier },
    ],
    [periodState, filterStalled, qualificationTier, preQualificationTier],
  );

  const handleClearFilters = useCallback(() => {
    setQualificationTier([]);
    setPreQualificationTier([]);
    setPeriodState(createInitialPeriodState());
    setFilterStalled(STALLED_ALL);
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
      {/* Faixa única de controles — Modelo 1 do protótipo
          `.specs/mockups/funis-redesign/`, o mesmo componente dos funis do
          sistema. Substitui o par cabeçalho + fileira de busca/filtros.
          A contagem de leads virou chip ao lado do nome: era informação, não
          controle, e ocupava um canto da fileira que deixou de existir. */}
      <FunnelControlBar
        funnelKey={`custom:${pipeline.id}`}
        funnelLabel={pipeline.name}
        funnelColor={pipeline.color}
        search={searchQuery}
        onSearchChange={setSearchQuery}
        filters={
          <>
            {/* O ícone é escolha do usuário ao criar o funil — o FunnelSwitcher
                só carrega o ponto de cor, então ele fica aqui pra identidade do
                funil não sumir com o cabeçalho antigo. */}
            <PipeIcon
              className="hidden size-4 shrink-0 sm:block"
              style={{ color: pipeline.color }}
              aria-hidden
            />
            {stages.length > 0 && (
              <>
                <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                  {tieredEntries.length} {tieredEntries.length === 1 ? "lead" : "leads"}
                </span>
                <KanbanFilterPanel sections={filterSections} onClearAll={handleClearFilters} />
              </>
            )}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => setShowSettings(true)}>
              <Settings2 className="w-4 h-4 mr-2" />
              Configurações
            </Button>

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
                  <DropdownMenuItem onClick={() => setIsDisparoOpen(true)}>
                    <Send className="w-4 h-4 mr-2 text-primary" />
                    Disparo
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
        primaryAction={
          <Button size="sm" className="h-9 gradient-gold" onClick={() => setShowAddLead(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Lead
          </Button>
        }
        chips={<FilterChips sections={filterSections} onClearAll={handleClearFilters} />}
      />

      {pipeline.description && (
        <p className="-mt-2 truncate text-sm text-muted-foreground">{pipeline.description}</p>
      )}

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

/**
 * Os dois cards do sistema (SCRUM-124). Ver a nota em `PipeWhatsapp.tsx` sobre a
 * ordem dos providers.
 *
 * O funil CUSTOM é onde as orgs modelam reativação e upsell, e é o único dos
 * quatro que não tem etapa fixa — mais uma razão para a ficha ser a do Negócio,
 * que desenha a trilha a partir das etapas do próprio funil, e não a do lead.
 */
export default function CustomPipelinePage() {
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
          <CustomPipelinePageInner />
        </LeadPanelLayout>
      </DealPanelProvider>
    </LeadPanelProvider>
  );
}
