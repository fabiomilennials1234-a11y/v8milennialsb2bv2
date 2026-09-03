import { useState, useMemo, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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
  Kanban,
  LayoutGrid,
  List,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { usePipelines } from "@/modules/pipelines/hooks/model/usePipelines";
import { resolveFunil } from "@/modules/pipelines/lib/resolve-funil";
import { funilIcon } from "@/modules/pipelines/lib/funil-icons";
import {
  useFunilStages,
  usePaginatedFunil,
  useMoverCardNoFunil,
} from "@/modules/pipelines/hooks/model/usePaginatedFunil";
import type { PaginatedFilters } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";
import {
  useCustomPipeline,
  useRemoveLeadFromCustomPipe,
} from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import { FunilKanban, type FunilEntry } from "@/modules/pipelines/components/funis/FunilKanban";
import { KanbanFilterPanel, FilterChips, type FilterSectionConfig } from "@/modules/pipelines/components/kanban/KanbanFilterPanel";
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
import { FunnelViewsMenu } from "@/modules/pipelines/components/shared/FunnelViewsMenu";
import {
  type MetricsPeriodState,
  getDateRange,
  createInitialPeriodState,
  revivePeriodState,
} from "@/lib/metrics-period";
import { getStalledBucket, STALLED_ALL } from "@/modules/pipelines/lib/stalled-buckets";
import { useFeaturePermission, useResponsibleMembers } from "@/modules/identity";

/**
 * Estado serializável do board — o objeto INTEIRO é o payload da saved view
 * (SCRUM-634: `FunnelViewsMenu` com `pipelineId` grava em `pipeline:{uuid}`).
 * Type alias (não interface) de propósito: satisfaz `Record<string, unknown>`
 * do menu sem index signature manual. `periodState` carrega `Date` em range
 * custom — ao aplicar uma view salva, passa por `revivePeriodState`.
 */
type FunilFilterState = {
  searchQuery: string;
  filterResponsible: string;
  qualificationTier: string[];
  preQualificationTier: string[];
  periodState: MetricsPeriodState;
  filterStalled: string;
  viewMode: "kanban" | "list";
};

const DEFAULT_FUNIL_FILTERS: FunilFilterState = {
  searchQuery: "",
  filterResponsible: "all",
  qualificationTier: [],
  preQualificationTier: [],
  periodState: createInitialPeriodState(),
  filterStalled: STALLED_ALL,
  viewMode: "kanban",
};

/**
 * `/funil/:slug` — a página ÚNICA de funil (SCRUM-632, F4 · expand-contract).
 *
 * Unificação ESTRUTURAL, não redesign: mesma identidade visual do kanban atual
 * (FunnelControlBar + DraggableKanbanBoard + LeadCard, dark-first, tokens
 * existentes). O que muda é a espinha de dados: qualquer funil — de sistema ou
 * custom — resolve por `pipelines` e renderiza pela via canônica da SCRUM-626
 * (`get_pipeline_page` + `get_pipeline_stage_counts_by_id`, por pipeline_id),
 * com paginação real por coluna (fim do truncamento de 1.000 do board custom).
 *
 * Paridade DESTA fatia = o que a página custom tem hoje: board dnd, settings
 * do funil, adicionar lead, export por etapa, disparo, lista mobile — MAIS
 * filtros server-side (responsável/tier/período/parado-há, que no board custom
 * eram client-side e agora casam com o badge por construção).
 *
 * Slots para 633/634 (paridade dos funis de sistema — NÃO implementados aqui):
 *   · filtros ricos por família (origem/calor/status/vencidos) → entram como
 *     novas `FilterSectionConfig` mapeadas em `PaginatedFilters` (o hook já
 *     aceita a superfície completa);
 *   · saved views / bulk avançado / métricas de funil → penduram na
 *     FunnelControlBar e no FunilKanban sem tocar na composição das colunas;
 *   · fluxos de move de sistema (LossReasonDialog, modais de reunião, guarda
 *     de valor) → interceptam em `handleMove` antes de `useMoverCardNoFunil`.
 *
 * Até lá, as rotas `/pipe-*` seguem nas páginas antigas (expand); `/funil/whatsapp`
 * funciona para teste A/B manual. As 4 páginas velhas morrem na SCRUM-637.
 */
function FunilPageInner() {
  const { slug: param } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const { openDeal } = useDealSheet();
  const [searchParams, setSearchParams] = useSearchParams();

  // Estado único e serializável — é ele que a saved view grava/aplica.
  const [filterState, setFilterState] = useState<FunilFilterState>(DEFAULT_FUNIL_FILTERS);
  const { searchQuery, filterResponsible, qualificationTier, preQualificationTier, periodState, filterStalled, viewMode } = filterState;
  const patchFilters = useCallback(
    (patch: Partial<FunilFilterState>) => setFilterState((s) => ({ ...s, ...patch })),
    [],
  );

  // Deep-link de view salva (?view=...) — mesmo contrato das páginas de sistema.
  const [activeViewId, setActiveViewId] = useState<string | null>(searchParams.get("view"));
  const handleActiveViewChange = useCallback(
    (viewId: string | null) => {
      setActiveViewId(viewId);
      setSearchParams(viewId ? { view: viewId } : {}, { replace: true });
    },
    [setSearchParams],
  );
  const [showAddLead, setShowAddLead] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [removeEntryId, setRemoveEntryId] = useState<string | null>(null);
  const [isDisparoOpen, setIsDisparoOpen] = useState(false);

  const { data: pipelines = [], isLoading: loadingPipelines } = usePipelines();
  const pipeline = resolveFunil(pipelines, param);
  const ehCustom = pipeline?.type === "custom";

  // Linha RICA do funil custom (lifecycle, metas, config) — os diálogos
  // reaproveitados (settings/delete/import) falam este shape. Funil de sistema
  // não tem essa linha; os diálogos ficam fora do render nesse caso.
  const { data: customRow } = useCustomPipeline(ehCustom ? pipeline?.slug : undefined);

  const { data: stages = [], isLoading: loadingStages } = useFunilStages(pipeline?.id);

  // ── Filtros server-side (626): badge e cards saem do MESMO recorte ───────
  const periodRange = useMemo(() => getDateRange(periodState), [periodState]);
  const stalledBucket = useMemo(() => getStalledBucket(filterStalled), [filterStalled]);

  const filters = useMemo<PaginatedFilters>(
    () => ({
      search: searchQuery,
      responsibleId: filterResponsible,
      qualificationTier,
      preQualificationTier,
      periodAfter: periodRange?.startStr ?? null,
      periodBefore: periodRange?.endStr ?? null,
      stalledMinDays: stalledBucket?.minDays ?? null,
      stalledMaxDays: stalledBucket?.maxDays ?? null,
    }),
    [searchQuery, filterResponsible, qualificationTier, preQualificationTier, periodRange, stalledBucket],
  );

  const { stageData, isLoading: loadingBoard } = usePaginatedFunil(pipeline?.id, stages, filters);

  const mover = useMoverCardNoFunil(pipeline ? { id: pipeline.id, type: pipeline.type } : null);
  const removeLead = useRemoveLeadFromCustomPipe();

  const { allowed: canDeleteCards } = useFeaturePermission("pipeline.delete_cards");
  const responsibleMembers = useResponsibleMembers();

  const isLoading = loadingPipelines || loadingStages;

  const filterSections: FilterSectionConfig[] = useMemo(
    () => [
      { type: "created-period", value: periodState, onChange: (v: MetricsPeriodState) => patchFilters({ periodState: v }) },
      { type: "stalled-days", value: filterStalled, onChange: (v: string) => patchFilters({ filterStalled: v }) },
      { type: "responsible", value: filterResponsible, onChange: (v: string) => patchFilters({ filterResponsible: v }), members: responsibleMembers },
      { type: "qualification-tier", value: qualificationTier, onChange: (v: string[]) => patchFilters({ qualificationTier: v }) },
      { type: "pre-qualification-tier", value: preQualificationTier, onChange: (v: string[]) => patchFilters({ preQualificationTier: v }) },
    ],
    [periodState, filterStalled, filterResponsible, responsibleMembers, qualificationTier, preQualificationTier, patchFilters],
  );

  const handleClearFilters = useCallback(() => {
    // Busca e visão sobrevivem ao "limpar filtros" — mesmo recorte do board custom.
    patchFilters({
      filterResponsible: "all",
      qualificationTier: [],
      preQualificationTier: [],
      periodState: createInitialPeriodState(),
      filterStalled: STALLED_ALL,
    });
  }, [patchFilters]);

  const handleMove = useCallback(
    (entryId: string, stage: { id: string; stage_key: string }) => {
      mover
        .mutateAsync({ entryId, stageId: stage.id, stageKey: stage.stage_key })
        .catch((e) => {
          const msg = e instanceof Error ? e.message : "";
          toast.error(msg.includes("permissão") || msg.includes("Permissões") ? msg : "Erro ao mover lead");
        });
    },
    [mover],
  );

  // ── Mobile: lista por stage (mesmo componente do board custom) ───────────
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
      for (const s of stages) {
        const entry = ((stageData[s.stage_key]?.items ?? []) as FunilEntry[]).find((e) => e.id === entryId);
        if (entry) {
          openDeal(entry.id, entry.lead_id);
          return;
        }
      }
    },
    [stages, stageData, openDeal],
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
      await removeLead.mutateAsync({ entry_id: removeEntryId, pipeline_id: pipeline.id });
      toast.success("Lead removido do funil");
      setRemoveEntryId(null);
    } catch {
      toast.error("Erro ao remover lead");
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
        <Button variant="outline" onClick={() => navigate("/funis")}>
          Ver todos os funis
        </Button>
      </div>
    );
  }

  const PipeIcon = funilIcon(pipeline.icon);

  return (
    <div className="space-y-4">
      <FunnelControlBar
        funnelKey={ehCustom ? `custom:${pipeline.id}` : `sys:${pipeline.slug}`}
        funnelLabel={pipeline.name}
        funnelColor={pipeline.color}
        search={searchQuery}
        onSearchChange={(v) => patchFilters({ searchQuery: v })}
        views={
          /* Alternador de visão + views salvas num gatilho só (SCRUM-634):
             `pipelineId` faz o menu gravar em `pipeline:{uuid}` — o MESMO
             contrato pra qualquer funil, sistema ou custom. */
          <FunnelViewsMenu
            viewMode={viewMode}
            onViewModeChange={(v) => patchFilters({ viewMode: v })}
            viewOptions={[
              { value: "kanban", icon: LayoutGrid, label: "Kanban" },
              { value: "list", icon: List, label: "Lista" },
            ]}
            pipelineId={pipeline.id}
            currentFilters={filterState}
            defaultFilters={DEFAULT_FUNIL_FILTERS}
            onApplyFilters={(f) =>
              // Datas de range custom voltam do JSON como string — revive.
              setFilterState({ ...f, periodState: revivePeriodState(f.periodState) })
            }
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
            {stages.length > 0 && (
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
          ehCustom ? (
            <Button size="sm" className="h-9 gradient-gold" onClick={() => setShowAddLead(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Lead
            </Button>
          ) : undefined
        }
        chips={<FilterChips sections={filterSections} onClearAll={handleClearFilters} />}
      />

      {pipeline.description && (
        <p className="-mt-2 truncate text-sm text-muted-foreground">{pipeline.description}</p>
      )}

      {/* Sem GhostLeadsBanner de propósito: `get_pipeline_page` usa INNER JOIN
          com `leads` sob RLS — entry cujo lead o usuário não enxerga nem chega
          na tela, e a contagem da coluna sai do MESMO recorte. */}

      {stages.length > 0 ? (
        isMobile || viewMode === "list" ? (
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
            onRemoveEntry={ehCustom && canDeleteCards ? (id) => setRemoveEntryId(id) : undefined}
            onClickEntry={(entry) => openDeal(entry.id, entry.lead_id)}
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

      {/* Modals — reaproveitados do board custom, gated por família até a 637 */}
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

      {isDisparoOpen && pipeline && (
        <DisparoWizard
          open={isDisparoOpen}
          onOpenChange={setIsDisparoOpen}
          context={
            ehCustom
              ? {
                  kind: "custom",
                  pipelineId: pipeline.id,
                  stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color })),
                }
              : { kind: "system", pipelineType: pipeline.slug as "whatsapp" | "confirmacao" | "propostas" }
          }
        />
      )}

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

export default function FunilPage() {
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
