import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Calendar as CalendarIcon,
  DollarSign, Loader2, TrendingUp, Package,
  BarChart3, MessageCircle, Settings2,
  MoreVertical, MoreHorizontal, Trash2, LayoutGrid, Send
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { PipelineListView } from "@/modules/pipelines/components/kanban/PipelineListView";
import { useViewport } from "@/shared/hooks/use-viewport";
import { KanbanFilterPanel, FilterChips, type FilterSectionConfig } from "@/modules/pipelines/components/kanban/KanbanFilterPanel";
import { TorqueLoader } from "@/components/ui/branding/TorqueLoader";
import { useCanDo } from "@/modules/identity";
import { StageWorkflowsBadgeWrapper } from "@/modules/pipelines/components/kanban/StageWorkflowsBadgeWrapper";
import { useStageWorkflowCounts } from "@/modules/workflows/hooks/useStageWorkflows";
import { useUpdatePipeProposta, useDeletePipeProposta, PipePropostasStatus } from "@/modules/pipelines/hooks/legacy/usePipePropostas";
import { usePaginatedPipeline } from "@/modules/pipelines/hooks/model/usePaginatedPipeline";
import { usePipePropostasMetrics } from "@/modules/pipelines/hooks/config/usePipeMetrics";
import { type MetricsPeriodState, getDateRange, createInitialPeriodState } from "@/lib/metrics-period";
import {
  getStalledBucket,
  STALLED_ALL,
  STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES,
} from "@/modules/pipelines/lib/stalled-buckets";
import { FunnelControlBar } from "@/modules/pipelines/components/shared/FunnelControlBar";
import { FunnelViewsMenu } from "@/modules/pipelines/components/shared/FunnelViewsMenu";
import { GhostLeadsBanner } from "@/modules/pipelines/components/shared/GhostLeadsBanner";
import { AutoCreateLeadToggle } from "@/modules/pipelines/components/shared/AutoCreateLeadToggle";
import { useDeleteAllLeadsInPipe, useUpdateLead } from "@/modules/leads";
import { usePipelineStages, stagesToColumns } from "@/modules/pipelines/hooks/model/usePipelineStages";
import { upsertLeadIntoCustomPipe } from "@/modules/pipelines/lib/stageTransition";
import { useSaleValueGuard } from "@/modules/pipelines/hooks/useSaleValueGuard";
import { SaleValueRequiredModal } from "@/modules/pipelines/components/shared/SaleValueRequiredModal";
import { parseSaleValue } from "@/modules/pipelines/lib/sale-value-guard";
import { useQueryClient } from "@tanstack/react-query";
import { PipeSettingsDialog } from "@/modules/pipelines/components/shared/PipeSettingsDialog";
import { useTeamMembers, useResponsibleMembers } from "@/modules/identity";
import { CreateProposalModal } from "@/modules/carteira/components/proposal/CreateProposalModal";
import { ExportStageDialog } from "@/modules/pipelines/components/kanban/ExportStageDialog";
import { LeadCard, type LeadCardData } from "@/modules/leads";
import { DealPanelProvider, useDealSheet, DealDetailDialog } from "@/modules/leads";
import { LeadPanelLayout } from "@/modules/platform/components/layout/LeadPanelLayout";
import {
  AnalyticsPanel,
  AnalyticsStatCard,
  ContinuousFunnel,
  CalorBars,
  MemberLeaderboard,
} from "@/modules/pipelines/components/shared/analytics-ui";
import { CalorSlider, CalorBadge } from "@/modules/carteira/components/proposal/CalorSlider";
import { QuickAddDailyAction } from "@/modules/carteira/components/proposal/QuickAddDailyAction";
import { CommitmentDateModal } from "@/modules/carteira/components/proposal/CommitmentDateModal";
import { TinyErpConfirmOrderDialog } from "@/modules/carteira/components/proposal/TinyErpConfirmOrderDialog";
import { DaysUntilMeeting } from "@/modules/carteira/components/proposal/DaysUntilMeeting";
import { useTinyErpStatus } from "@/modules/carteira/hooks/useTinyErp";
import { useCadastroExternoEnabled } from "@/modules/marketing/hooks/useCadastroExterno";
import { CadastroExternoConfirmDialog } from "@/modules/carteira/components/proposal/CadastroExternoConfirmDialog";
import { useCreateAcaoDoDia } from "@/modules/engagement/hooks/useAcoesDoDia";
import { priorityBandToRating, calorBandToBounds, PROPOSTAS_CLOSED_STATUS_KEYS } from "@/modules/pipelines/lib/kanbanFilterParams";
import { supabase } from "@/integrations/supabase/client";
import { ProductAnalyticsChart } from "@/modules/carteira/components/proposal/ProductAnalyticsChart";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/modules/identity";
import { track, trackModuleVisit } from "@/lib/analytics";
import { useFeaturePermission } from "@/modules/identity";
import { useIdentity } from "@/modules/identity";
import { useTags } from "@/modules/leads/hooks/useTags";
import { useBulkSelection } from "@/shared/hooks/useBulkSelection";
import { BulkActionBar } from "@/modules/leads/components/bulk-actions/BulkActionBar";
import { DisparoWizard, type DisparoBoardFilter, type DisparoSource } from "@/modules/pipelines/components/disparo";
import { useLossReasons } from "@/modules/pipelines/hooks/config/useLossReasons";
import { useSearchParams } from "react-router-dom";
import { useMetricDrilldown, type MetricType } from "@/modules/carteira/hooks/useMetricDrilldown";
import { MetricDrilldownSheet } from "@/modules/carteira/components/proposal/MetricDrilldownSheet";

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function formatPeriodLabel(range: { startStr: string; endStr: string }): string {
  const [sy, sm, sd] = range.startStr.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = range.endStr.slice(0, 10).split("-").map(Number);
  if (sy === ey && sm === em) return `${sd}–${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  if (sy === ey) return `${sd} ${MONTHS_PT[sm - 1]} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
  return `${sd} ${MONTHS_PT[sm - 1]} ${sy} – ${ed} ${MONTHS_PT[em - 1]} ${ey}`;
}

// ─── Helper: temporal filter para o kanban no modo "Este mês" ────────────────
const CLOSED_STATUSES_PROPOSTAS = ["vendido", "perdido"];

/**
 * Retorna true se a proposta pertence ao intervalo [startStr, endStr].
 *
 * Regra:
 *  - Status fechados (vendido/perdido): usa metrics_period_at (primário) ou closed_at (fallback).
 *    Alinhado com a lógica de usePipePropostasMetrics().
 *  - Status abertos/ativos: usa created_at como referência temporal.
 *    Justificativa: created_at é o momento em que a proposta "entrou" no pipe,
 *    representando fielmente a "foto do mês" para cards em andamento.
 */
function isPropostaInPeriod(
  item: { status: string; metrics_period_at?: string | null; closed_at?: string | null; created_at?: string | null; updated_at?: string | null },
  startStr: string,
  endStr: string,
): boolean {
  if (CLOSED_STATUSES_PROPOSTAS.includes(item.status)) {
    const ref = item.metrics_period_at ?? item.closed_at ?? item.updated_at;
    if (!ref) return false;
    return ref >= startStr && ref <= endStr;
  }
  const ref = item.created_at;
  if (!ref) return false;
  return ref >= startStr && ref <= endStr;
}

// ---------------------------------------------------------------------------
// Loss reasons: loaded from DB per org (useLossReasons)
// Hardcoded fallback only used while DB data is loading.
// ---------------------------------------------------------------------------
const LOSS_REASONS_FALLBACK = [
  { value: "sem_budget", label: "Sem budget" },
  { value: "concorrencia", label: "Concorrência" },
  { value: "timing", label: "Timing errado" },
  { value: "follow_up_fraco", label: "Follow-up fraco" },
  { value: "produto_nao_adequado", label: "Produto não adequado" },
  { value: "outro", label: "Outro" },
];

// ---------------------------------------------------------------------------
// Persisted filter state — scoped per org + user, TTL 24 h
// ---------------------------------------------------------------------------
type PropostasFilterState = {
  searchTerm: string;
  filterResponsible: string;
  filterProductType: string;
  filterPriority: string;
  filterCalor: string;
  filterOrigin: string[];
  filterTags: string[];
  filterQualificationTier: string[];
  filterPreQualificationTier: string[];
  filterScheduled: boolean;
  /** Data de criação. Saiu do cabeçalho pro painel de Filtros (protótipo). */
  periodState: MetricsPeriodState;
  /** Dias na etapa atual — id de `STALLED_BUCKETS`, ou "all". */
  filterStalled: string;
  viewMode: "kanban" | "analytics";
  // Marca se já aplicamos o default "me" para membros (one-shot por usuário).
  // Depois de true, respeitamos a escolha manual do usuário.
  membroDefaultApplied?: boolean;
};

const DEFAULT_PROPOSTAS_FILTERS: PropostasFilterState = {
  searchTerm: "",
  filterResponsible: "all",
  filterProductType: "all",
  filterPriority: "all",
  filterCalor: "all",
  filterOrigin: [],
  filterTags: [],
  filterQualificationTier: [],
  filterPreQualificationTier: [],
  filterScheduled: false,
  periodState: createInitialPeriodState(),
  filterStalled: STALLED_ALL,
  viewMode: "kanban",
  membroDefaultApplied: false,
};

function PipePropostasInner() {
  const [filterState, setFilterState] = usePersistedState(
    "propostas",
    DEFAULT_PROPOSTAS_FILTERS
  );

  const { searchTerm, filterResponsible, filterProductType, filterPriority, filterCalor, filterOrigin, filterTags, filterQualificationTier, filterPreQualificationTier, filterScheduled, periodState, filterStalled, viewMode } = filterState;

  const setPeriodState = useCallback(
    (v: MetricsPeriodState) => setFilterState((f) => ({ ...f, periodState: v })),
    [setFilterState]
  );
  const setFilterStalled = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, filterStalled: v })),
    [setFilterState]
  );

  const setSearchTerm = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, searchTerm: v })),
    [setFilterState]
  );
  const setViewMode = useCallback(
    (v: "kanban" | "analytics") => setFilterState((f) => ({ ...f, viewMode: v })),
    [setFilterState]
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeViewId, setActiveViewId] = useState<string | null>(searchParams.get("view"));
  const handleActiveViewChange = useCallback((viewId: string | null) => {
    setActiveViewId(viewId);
    setSearchParams(viewId ? { view: viewId } : {}, { replace: true });
  }, [setSearchParams]);

  const handleClearAllFilters = useCallback(() => {
    setFilterState((f) => ({
      ...f,
      filterResponsible: "all",
      filterProductType: "all",
      filterPriority: "all",
      filterCalor: "all",
      filterOrigin: [],
      filterTags: [],
      filterQualificationTier: [],
      filterPreQualificationTier: [],
      filterScheduled: false,
      periodState: createInitialPeriodState(),
      filterStalled: STALLED_ALL,
    }));
  }, [setFilterState]);

  // ─── Filtro defensivo: para role "member" (ex-membro), pré-seleciona o próprio
  // teamMemberId na primeira visita. Cria camada extra de proteção client-side
  // além da RLS. Membros ainda podem trocar manualmente; a flag membroDefaultApplied
  // garante que o default só aplica uma vez por usuário.
  const { teamMemberId } = useOrganization();
  const { isAdmin, isMaster } = useIdentity();
  useEffect(() => {
    if (filterState.membroDefaultApplied) return;
    if (!teamMemberId || isAdmin || isMaster) return;
    // Usuário sem privilégio (membro): aplicar teamMemberId como default
    setFilterState((f) => ({
      ...f,
      filterResponsible: f.filterResponsible === "all" ? teamMemberId : f.filterResponsible,
      membroDefaultApplied: true,
    }));
  }, [teamMemberId, isAdmin, isMaster, filterState.membroDefaultApplied, setFilterState]);
  const { openDeal } = useDealSheet();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDisparoOpen, setIsDisparoOpen] = useState(false);
  const [disparoSource, setDisparoSource] = useState<DisparoSource>("estagio");
  const [disparoManualIds, setDisparoManualIds] = useState<string[]>([]);
  const [analyticsTab, setAnalyticsTab] = useState<"propostas" | "produtos">("propostas");

  // State for commitment date modal
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    itemId: string;
    leadId: string;
    closerId: string | null;
    leadName: string;
  } | null>(null);
  // State for TinyERP confirmation modal on drag-to-vendido
  const [tinyConfirmOpen, setTinyConfirmOpen] = useState(false);
  const [pendingVendido, setPendingVendido] = useState<{
    itemId: string;
    leadId: string;
    closerId: string | null;
    lead: any;
    items: Array<{ product_name: string; sale_value: number }>;
    totalValue: number;
    saleValue?: number;
  } | null>(null);

  // State for Cadastro Externo confirmation modal on drag-to-vendido
  const [cadastroExternoOpen, setCadastroExternoOpen] = useState(false);
  const [pendingCadastroExterno, setPendingCadastroExterno] = useState<{
    itemId: string;
    leadId: string;
    closerId: string | null;
    lead: any;
    items: Array<{ product_name: string; sale_value: number }>;
    totalValue: number;
    contractDuration: number | null;
    proposalNotes: string | null;
    saleValue?: number;
  } | null>(null);

  // State for loss reason dialog (drag-to-perdido)
  const [lossReasonDialogOpen, setLossReasonDialogOpen] = useState(false);
  const [selectedLossReason, setSelectedLossReason] = useState<string>("");
  const [pendingPerdido, setPendingPerdido] = useState<{
    itemId: string;
    leadId: string;
    closerId: string | null;
  } | null>(null);

  // Lead name shown in the required-sale-value modal (D1 / SQL-I3).
  const [wonValueLeadName, setWonValueLeadName] = useState<string | undefined>(undefined);

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pipeId: string; leadId: string } | null>(null);
  const [deleteAllLeadsDialogOpen, setDeleteAllLeadsDialogOpen] = useState(false);
  const [drilldownMetric, setDrilldownMetric] = useState<MetricType | null>(null);
  const [stageToDelete, setStageToDelete] = useState<{ id: string; title: string } | null>(null);
  const [stageToExport, setStageToExport] = useState<{ id: string; title: string; count: number } | null>(null);

  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  useEffect(() => { trackModuleVisit("pipe_propostas", organizationId); }, []);

  const { data: pipelineStages = [] } = usePipelineStages("propostas");
  // D1 / SQL-I3: gate won-transitions behind a required sale_value.
  const saleGuard = useSaleValueGuard(pipelineStages);
  const periodRange = useMemo(() => getDateRange(periodState), [periodState]);
  const stalledBucket = useMemo(
    () => (STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES ? getStalledBucket(filterStalled) : null),
    [filterStalled],
  );
  const { stageData, allItems: pipeData, isLoading } = usePaginatedPipeline(
    "propostas",
    pipelineStages,
    {
      search: searchTerm,
      responsibleId: filterResponsible,
      tagIds: filterTags,
      // Client-only dimensions, now resolved server-side so the column count
      // matches the filtered cards (origin / product / priority / calor /
      // scheduled / period / tier). Period uses the status-dependent ref date
      // via closedStatusKeys (mirrors isPropostaInPeriod).
      origins: filterOrigin.length ? filterOrigin : undefined,
      productType: filterProductType !== "all" ? filterProductType : undefined,
      qualificationTier: filterQualificationTier,
      preQualificationTier: filterPreQualificationTier,
      ...priorityBandToRating(filterPriority),
      ...calorBandToBounds(filterCalor),
      scheduled: filterScheduled || undefined,
      periodAfter: periodRange?.startStr ?? undefined,
      periodBefore: periodRange?.endStr ?? undefined,
      closedStatusKeys: periodRange ? [...PROPOSTAS_CLOSED_STATUS_KEYS] : undefined,
      stalledMinDays: stalledBucket?.minDays ?? null,
      stalledMaxDays: stalledBucket?.maxDays ?? null,
    }
  );
  const refetch = useCallback(() => {}, []);
  const { data: workflowCounts = {} } = useStageWorkflowCounts("propostas");
  const { data: teamMembers } = useTeamMembers();
  const updatePipeProposta = useUpdatePipeProposta();
  const { allowed: canMovePipe } = useCanDo("move_pipe_record");
  const { data: tinyStatus } = useTinyErpStatus();
  const cadastroExternoEnabled = useCadastroExternoEnabled();
  const deletePipeProposta = useDeletePipeProposta();
  const deleteAllLeadsInPipe = useDeleteAllLeadsInPipe("propostas");
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const createAcaoDoDia = useCreateAcaoDoDia();
  const { allowed: canDeleteCards } = useFeaturePermission("pipeline.delete_cards");
  const { data: metricsByPeriod } = usePipePropostasMetrics(periodRange);

  const responsibleMembers = useResponsibleMembers();
  const { data: orgTags = [] } = useTags();
  const { data: dbLossReasons } = useLossReasons();
  const lossReasons = useMemo(() => {
    if (dbLossReasons && dbLossReasons.length > 0) {
      return dbLossReasons.map((r) => ({ value: r.id, label: r.name }));
    }
    return LOSS_REASONS_FALLBACK;
  }, [dbLossReasons]);
  const bulk = useBulkSelection();
  const allLeadIds = useMemo(() => {
    if (!pipeData) return [];
    return pipeData.filter(item => item.lead).map(item => item.lead_id);
  }, [pipeData]);

  // Build declarative sections for KanbanFilterPanel
  const filterSections: FilterSectionConfig[] = useMemo(() => [
    // Os dois filtros de tempo do redesenho: "criado" é entrada, "parado" é a
    // etapa atual. Independentes de propósito, combináveis.
    { type: "created-period", value: periodState, onChange: setPeriodState },
    // "Parado há" só entra com a migration 20270729000010 aplicada — ver
    // STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES.
    ...(STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES
      ? [{ type: "stalled-days", value: filterStalled, onChange: setFilterStalled } as const]
      : []),
    { type: "responsible", value: filterResponsible, onChange: (v: string) => setFilterState((f) => ({ ...f, filterResponsible: v })), members: responsibleMembers },
    { type: "origin-multi", value: filterOrigin, onChange: (v: string[]) => setFilterState((f) => ({ ...f, filterOrigin: v })) },
    { type: "tags", value: filterTags, onChange: (v: string[]) => setFilterState((f) => ({ ...f, filterTags: v })), tags: orgTags },
    { type: "qualification-tier", value: filterQualificationTier, onChange: (v: string[]) => setFilterState((f) => ({ ...f, filterQualificationTier: v })) },
    { type: "pre-qualification-tier", value: filterPreQualificationTier, onChange: (v: string[]) => setFilterState((f) => ({ ...f, filterPreQualificationTier: v })) },
    { type: "product-type", value: filterProductType, onChange: (v: string) => setFilterState((f) => ({ ...f, filterProductType: v })) },
    { type: "calor", value: filterCalor, onChange: (v: string) => setFilterState((f) => ({ ...f, filterCalor: v })) },
    { type: "priority", value: filterPriority, onChange: (v: string) => setFilterState((f) => ({ ...f, filterPriority: v })) },
    { type: "scheduled", value: filterScheduled, onChange: (v: boolean) => setFilterState((f) => ({ ...f, filterScheduled: v })) },
  ], [periodState, filterStalled, filterResponsible, filterOrigin, filterTags, filterQualificationTier, filterPreQualificationTier, filterProductType, filterCalor, filterPriority, filterScheduled, responsibleMembers, orgTags, setFilterState, setPeriodState, setFilterStalled]);

  // Board filter handed to the Disparo "Filtro ativo" source. Mirrors EXACTLY
  // the dimensions usePaginatedPipeline resolves server-side (search,
  // responsible, tags) — origin/product/priority/calor/scheduled are page-only
  // and deliberately excluded. Chips carry human labels (page owns dictionaries).
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
    return { search: searchTerm, responsibleId: filterResponsible, tagIds: filterTags, chips };
  }, [searchTerm, filterResponsible, filterTags, responsibleMembers, orgTags]);

  const handleOpenDisparoStage = useCallback(() => {
    setDisparoManualIds([]);
    setDisparoSource("estagio");
    setIsDisparoOpen(true);
  }, []);

  const handleDispararManual = useCallback((leadIds: string[]) => {
    setDisparoManualIds(leadIds);
    setDisparoSource("manual");
    setIsDisparoOpen(true);
  }, []);

  // Transform pipe data to LeadCardData format
  const transformToCard = (item: any): LeadCardData => {
    const lead = item.lead;
    const items = item.items || [];
    const hasItemsFromDb = items.length > 0;
    const hasMainProduct = !hasItemsFromDb && item.product_id && item.product;

    const productsForCard = hasItemsFromDb
      ? items.map((i: any) => ({
          name: i.product?.name || "Produto",
          type: i.product?.type,
          value: i.sale_value || 0,
        }))
      : hasMainProduct
        ? [{ name: item.product?.name || "Produto", type: item.product?.type, value: item.sale_value || 0 }]
        : [];

    const totalValue = productsForCard.length > 0
      ? productsForCard.reduce((sum: number, p: any) => sum + p.value, 0)
      : (item.sale_value || 0);

    return {
      id: item.id,
      name: lead?.name || "Sem nome",
      company: lead?.company || "",
      email: lead?.email,
      phone: lead?.phone,
      rating: lead?.rating || 0,
      calor: item.calor ?? 5,
      responsible: item.responsible?.name || item.closer?.name || lead?.responsible?.name || lead?.closer?.name,
      assignees: [...new Set([item.responsible?.name, item.closer?.name, item.pre_sale_responsible?.name, item.sale_responsible?.name, lead?.responsible?.name, lead?.closer?.name, lead?.pre_sale_responsible?.name, lead?.sale_responsible?.name].filter(Boolean))] as string[],
      value: totalValue,
      valueLabel: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(totalValue),
      contractDuration: item.contract_duration || 0,
      tags: lead?.lead_tags?.map((lt: any) => ({ name: lt.tag?.name, color: lt.tag?.color || "#888" })).filter((t: any) => t.name) || [],
      date: item.commitment_date ? new Date(item.commitment_date) : null,
      dateLabel: item.commitment_date ? format(new Date(item.commitment_date), "dd MMM, HH:mm", { locale: ptBR }) : undefined,
      origin: lead?.origin,
      urgency: lead?.urgency,
      leadId: lead?.id,
      products: productsForCard,
      createdAt: item.created_at,
      stageEnteredAt: item.stage_entered_at || item.updated_at,
      preQualTier: lead?.pre_qualification_tier ?? null,
      qualTier:    lead?.qualification_tier    ?? null,
      avatarUrl:   lead?.avatar_url ?? null,
      preSaleResponsible: (item.pre_sale_responsible ?? lead?.pre_sale_responsible)
        ? { name: (item.pre_sale_responsible ?? lead?.pre_sale_responsible)?.name, avatar_url: (item.pre_sale_responsible ?? lead?.pre_sale_responsible)?.avatar_url }
        : null,
      saleResponsible: (item.sale_responsible ?? lead?.sale_responsible)
        ? { name: (item.sale_responsible ?? lead?.sale_responsible)?.name, avatar_url: (item.sale_responsible ?? lead?.sale_responsible)?.avatar_url }
        : null,
    };
  };

  // Converte etapas do banco para o formato do Kanban (com fallback)
  const statusColumns = useMemo(() => {
    if (pipelineStages.length === 0) {
      // Fallback para etapas padrão enquanto carrega
      return [
        { id: "marcar_compromisso", title: "Marcar Compromisso", color: "#F5C518" },
        { id: "reativar", title: "Reativar", color: "#F97316" },
        { id: "compromisso_marcado", title: "Compromisso Marcado", color: "#3B82F6" },
        { id: "proposta_enviada", title: "Proposta Enviada", color: "#0EA5E9" },
        { id: "esfriou", title: "Esfriou", color: "#64748B" },
        { id: "futuro", title: "Futuro", color: "#8B5CF6" },
        { id: "vendido", title: "Vendido ✓", color: "#22C55E" },
        { id: "perdido", title: "Perdido", color: "#EF4444" },
      ];
    }
    return stagesToColumns(pipelineStages);
  }, [pipelineStages]);

  // Build columns from server-paginated stageData. All board filters
  // (origin / product / priority / calor / scheduled / period) are now applied
  // server-side by usePaginatedPipeline, so items and totalCount come from the
  // same filtered query and the column badge matches the cards.
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

  // ── Mobile: lista por stage (PipelineListView) em vez do kanban drag-drop ──
  // Deriva stages/leads do `columns` já montado. id = entry id (move direto via
  // handleStatusChange); click mapeia entry → lead pra abrir o sheet.
  const { isMobile } = useViewport();
  const mobileStages = useMemo(
    () => columns.map((c) => ({ id: c.id, name: c.title, stage_key: c.id, color: c.color })),
    [columns],
  );
  const mobileLeads = useMemo(
    () =>
      columns.flatMap((c) =>
        c.items.map((card) => ({
          id: card.id,
          name: card.name,
          company: card.company || undefined,
          phone: card.phone || undefined,
          rating: card.rating || 0,
          stage_key: c.id,
          created_at: card.createdAt,
          updated_at: card.stageEnteredAt,
        })),
      ),
    [columns],
  );
  const handleMobileLeadClick = useCallback(
    (entryId: string) => {
      const item = pipeData?.find((p) => p.id === entryId);
      if (item) openDeal(item.id, item.lead_id || item.lead?.id);
    },
    [pipeData, openDeal],
  );
  const handleMobileMove = (entryId: string, stageKey: string) => {
    handleStatusChange(entryId, stageKey);
  };

  // Calculate stats — use server-side counts for totals, loaded items for value aggregation
  const stats = useMemo(() => {
    if (!pipeData) return {
      total: 0,
      sold: 0,
      soldCount: 0,
      mrr: 0,
      projeto: 0,
      inProgress: 0,
      inProgressCount: 0,
      conversionRate: 0
    };

    const activeStatuses: PipePropostasStatus[] = ["marcar_compromisso", "compromisso_marcado", "proposta_enviada", "esfriou", "futuro"];
    const inProgressData = pipeData.filter(item => activeStatuses.includes(item.status));
    const soldData = pipeData.filter(item => item.status === "vendido");

    let sold = 0;
    let mrr = 0;
    let projeto = 0;
    for (const item of soldData) {
      const items = item.items?.filter((i: any) => i != null) ?? [];
      if (items.length > 0) {
        for (const it of items) {
          const val = Number(it.sale_value) || 0;
          const t = it.product?.type;
          sold += val;
          if (t === "mrr") {
            mrr += val;
          } else if (t === "projeto") {
            projeto += val;
          }
        }
      } else {
        const val = Number(item.sale_value) || 0;
        sold += val;
        if (item.product_type === "mrr") {
          mrr += val;
        } else if (item.product_type === "projeto") {
          projeto += val;
        }
      }
    }

    const total = pipeData.reduce((sum, item) => sum + (item.sale_value || 0), 0);
    const inProgress = inProgressData.reduce((sum, item) => sum + (item.sale_value || 0), 0);

    // Use server-side counts for accurate totals (not limited by loaded pages)
    const totalNoPipe = Object.values(stageData).reduce((sum, s) => sum + (s?.totalCount ?? 0), 0);
    const soldCount = stageData["vendido"]?.totalCount ?? soldData.length;
    const inProgressCount = activeStatuses.reduce((sum, key) => sum + (stageData[key]?.totalCount ?? 0), 0);
    const conversionRate = totalNoPipe > 0 ? (soldCount / totalNoPipe) * 100 : 0;

    return {
      total,
      sold,
      soldCount,
      mrr,
      projeto,
      inProgress,
      inProgressCount,
      conversionRate
    };
  }, [pipeData, stageData]);

  const displayStats = useMemo(() => {
    if (!metricsByPeriod) {
      return stats;
    }
    return {
      ...metricsByPeriod,
      inProgress: stats.inProgress,
      inProgressCount: stats.inProgressCount,
    };
  }, [metricsByPeriod, stats]);

  const { data: drilldownData = [], isLoading: drilldownLoading } = useMetricDrilldown(
    drilldownMetric ?? "vendas_total",
    periodRange
  );

  const drilldownPeriodLabel = useMemo(() => {
    if (!periodRange) return "Geral";
    return formatPeriodLabel(periodRange);
  }, [periodRange]);

  const drilldownDisplayValue = useMemo(() => {
    if (!drilldownMetric) return "";
    const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
    switch (drilldownMetric) {
      case "pipeline_ativo": return fmt(displayStats.inProgress);
      case "vendas_total": return fmt(displayStats.sold);
      case "rec_vendida": return fmt(displayStats.mrr);
      case "projetos_vendidos": return fmt(displayStats.projeto);
      case "taxa_conversao": return `${displayStats.conversionRate.toFixed(1)}%`;
    }
  }, [drilldownMetric, displayStats]);

  const drilldownDisplayCount = useMemo(() => {
    if (!drilldownMetric) return 0;
    switch (drilldownMetric) {
      case "pipeline_ativo": return displayStats.inProgressCount;
      case "vendas_total": return displayStats.soldCount;
      case "taxa_conversao": return displayStats.soldCount + displayStats.inProgressCount;
      default: return drilldownData.length;
    }
  }, [drilldownMetric, displayStats, drilldownData]);

  // Total de propostas que passam pelo filtro temporal (para exibir no banner)
  const periodFilteredCount = useMemo(() => {
    if (!periodRange || !pipeData) return 0;
    return pipeData.filter(item =>
      isPropostaInPeriod(item, periodRange.startStr, periodRange.endStr)
    ).length;
  }, [pipeData, periodRange]);

  // Funnel data
  const funnelData = useMemo(() => {
    if (!pipeData || statusColumns.length === 0) return [];

    return statusColumns.slice(0, 4).map(col => {
      const items = pipeData.filter(item => item.status === col.id);
      return {
        id: col.id,
        name: col.title,
        count: items.length,
        value: items.reduce((sum, item) => sum + (item.sale_value || 0), 0),
        color: col.color,
      };
    });
  }, [pipeData, statusColumns]);

  // Calor data for analytics
  const calorData = useMemo(() => {
    if (!pipeData) return [];

    const activeStatuses: PipePropostasStatus[] = ["marcar_compromisso", "compromisso_marcado", "proposta_enviada", "esfriou", "futuro"];
    const activeProposals = pipeData.filter(item => activeStatuses.includes(item.status));

    // Group by calor level
    const grouped: { [key: number]: { calor: number; value: number; count: number } } = {};

    activeProposals.forEach(item => {
      const calor = item.calor ?? 5;
      if (!grouped[calor]) {
        grouped[calor] = { calor, value: 0, count: 0 };
      }
      grouped[calor].value += item.sale_value || 0;
      grouped[calor].count += 1;
    });

    return Object.values(grouped);
  }, [pipeData]);

  // Product data for analytics
  const productData = useMemo(() => {
    if (!pipeData) return [];

    const productMap = new Map<string, {
      productId: string;
      productName: string;
      productType: "mrr" | "projeto" | "unitario";
      proposalCount: number;
      proposalValue: number;
      soldCount: number;
      soldValue: number;
    }>();

    pipeData.forEach((proposta) => {
      const items = proposta.items || [];
      const isSold = proposta.status === "vendido";

      items.forEach((item: any) => {
        if (!item.product) return;

        const productId = item.product.id;
        const existing = productMap.get(productId);

        if (existing) {
          existing.proposalCount += 1;
          existing.proposalValue += item.sale_value || 0;
          if (isSold) {
            existing.soldCount += 1;
            existing.soldValue += item.sale_value || 0;
          }
        } else {
          productMap.set(productId, {
            productId,
            productName: item.product.name,
            productType: item.product.type as "mrr" | "projeto" | "unitario",
            proposalCount: 1,
            proposalValue: item.sale_value || 0,
            soldCount: isSold ? 1 : 0,
            soldValue: isSold ? (item.sale_value || 0) : 0,
          });
        }
      });
    });

    return Array.from(productMap.values());
  }, [pipeData]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
    }).format(value);
  };

  const handleOpenDeleteDialog = (pipeId: string, leadId: string) => {
    setDeleteDialog({ open: true, pipeId, leadId });
  };

  const handleDeleteFromPipe = async () => {
    if (!deleteDialog) return;
    try {
      await deletePipeProposta.mutateAsync(deleteDialog.pipeId);
      toast.success("Proposta removida do funil!");
      setDeleteDialog(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro ao excluir proposta";
      toast.error(msg);
    }
  };

  // Handle status change from drag-and-drop.
  // D1 / SQL-I3: gate won-transitions behind a required sale_value so the value
  // lands in the SAME mutation as the won stage_key (fn_capture_sale_event
  // snapshots metadata->>'sale_value' at the transition instant). Won stage is
  // resolved by stage_role (governed), not a hardcoded 'vendido' (R2).
  const handleStatusChange = (itemId: string, newStatus: string) => {
    const item = pipeData?.find(p => p.id === itemId);
    if (!item) {
      console.warn("[PipePropostas] Item not found in pipeData:", itemId);
      return;
    }

    // Effective value = entry metadata sale_value, else the items sum (which we
    // also persist into metadata so the ledger captures it).
    const metadataValue = parseSaleValue(item.sale_value);
    const itemsSum = (item.items || []).reduce(
      (sum: number, it: any) => sum + (Number(it?.sale_value) || 0),
      0,
    );
    const effectiveValue = metadataValue ?? (itemsSum > 0 ? itemsSum : null);

    setWonValueLeadName(item.lead?.name || undefined);
    saleGuard.guardWonTransition({
      targetStageKey: newStatus,
      currentValue: effectiveValue,
      proceed: (enteredValue) => {
        // Write a value into metadata when it wasn't there: the user-entered
        // value, or the items sum. Undefined = value already in metadata.
        const saleValueOverride =
          enteredValue ?? (metadataValue == null ? effectiveValue ?? undefined : undefined);
        void continueStatusChange(itemId, newStatus, saleValueOverride ?? undefined);
      },
    });
  };

  // Continue a status change once the sale_value gate (if any) has passed.
  const continueStatusChange = async (itemId: string, newStatus: string, saleValueOverride?: number) => {
    console.log("[PipePropostas] continueStatusChange called:", { itemId, newStatus, saleValueOverride, tinyConnected: tinyStatus?.connected });
    const item = pipeData?.find(p => p.id === itemId);
    if (!item) {
      console.warn("[PipePropostas] Item not found in pipeData:", itemId);
      return;
    }

    // If moving to "compromisso_marcado", require date selection
    if (newStatus === "compromisso_marcado") {
      setPendingStatusChange({
        itemId,
        leadId: item.lead_id,
        closerId: item.closer_id,
        leadName: item.lead?.name || "Lead",
      });
      setIsDateModalOpen(true);
      return;
    }

    // If moving to "vendido" and TinyERP is connected, show confirmation modal
    if (newStatus === "vendido") {
      // Check TinyERP connection — use cached status or fetch inline
      let isTinyConnected = tinyStatus?.connected ?? false;
      if (!tinyStatus) {
        try {
          const { data: tinyConn } = await supabase
            .from("tinyerp_connections")
            .select("status")
            .eq("organization_id", item.organization_id)
            .eq("status", "connected")
            .maybeSingle();
          isTinyConnected = !!tinyConn;
        } catch {
          // Ignore — proceed without TinyERP modal
        }
      }

      console.log("[PipePropostas] Vendido intercept:", { isTinyConnected, tinyStatusCached: tinyStatus?.connected });

      if (isTinyConnected) {
        const itemsList = (item.items || []).map((it: any) => ({
          product_name: it.product?.name || "Produto",
          sale_value: Number(it.sale_value) || 0,
        }));
        const total = itemsList.reduce((sum: number, it: any) => sum + it.sale_value, 0);

        setPendingVendido({
          itemId,
          leadId: item.lead_id,
          closerId: item.closer_id,
          lead: item.lead,
          items: itemsList,
          totalValue: total || Number(item.sale_value) || 0,
          saleValue: saleValueOverride,
        });
        setTinyConfirmOpen(true);
        return;
      }

      if (cadastroExternoEnabled) {
        const itemsList = (item.items || []).map((it: any) => ({
          product_name: it.product?.name || "Produto",
          sale_value: Number(it.sale_value) || 0,
        }));
        const total = itemsList.reduce((sum: number, it: any) => sum + it.sale_value, 0);

        setPendingCadastroExterno({
          itemId,
          leadId: item.lead_id,
          closerId: item.closer_id,
          lead: item.lead,
          items: itemsList,
          totalValue: total || Number(item.sale_value) || 0,
          contractDuration: item.contract_duration || null,
          proposalNotes: item.notes || null,
          saleValue: saleValueOverride,
        });
        setCadastroExternoOpen(true);
        return;
      }
    }

    // If moving to "perdido", show loss reason dialog
    if (newStatus === "perdido") {
      setPendingPerdido({
        itemId,
        leadId: item.lead_id,
        closerId: item.closer_id,
      });
      setSelectedLossReason("");
      setLossReasonDialogOpen(true);
      return;
    }

    await executeStatusChange(itemId, newStatus, item.lead_id, item.closer_id, undefined, undefined, undefined, saleValueOverride);
  };

  // Handle loss reason dialog confirmation
  const handleLossReasonConfirm = async () => {
    if (!pendingPerdido) return;
    await executeStatusChange(
      pendingPerdido.itemId,
      "perdido",
      pendingPerdido.leadId,
      pendingPerdido.closerId,
      undefined,
      false,
      selectedLossReason || null
    );
    setLossReasonDialogOpen(false);
    setPendingPerdido(null);
    setSelectedLossReason("");
  };

  const handleLossReasonCancel = () => {
    setLossReasonDialogOpen(false);
    setPendingPerdido(null);
    setSelectedLossReason("");
    toast("Operação cancelada");
  };

  // Execute status change (called directly or after date/TinyERP modal)
  const executeStatusChange = async (
    itemId: string,
    newStatus: string,
    leadId: string,
    closerId: string | null,
    commitmentDate?: Date,
    skipAutoPush?: boolean,
    lossReason?: string | null,
    saleValue?: number
  ) => {
    try {
      const updates: any = {
        id: itemId,
        status: newStatus as PipePropostasStatus,
        leadId,
        closerId,
        skip_auto_push: skipAutoPush,
      };

      // D1 / SQL-I3: sale_value rides in the SAME mutation as the won stage_key,
      // so fn_capture_sale_event snapshots metadata->>'sale_value' at capture.
      if (saleValue !== undefined) updates.sale_value = saleValue;

      // If commitment date is provided, set it
      if (commitmentDate) {
        updates.commitment_date = commitmentDate.toISOString();
      }

      // If moved to "vendido" or "perdido", set closed_at date
      if (newStatus === "vendido" || newStatus === "perdido") {
        updates.closed_at = new Date().toISOString();
      }

      // If loss reason provided (for perdido), save it
      if (newStatus === "perdido" && lossReason) {
        updates.loss_reason = lossReason;
      }

      await updatePipeProposta.mutateAsync(updates);

      const stageLabel = statusColumns.find(c => c.id === newStatus)?.title || newStatus;
      logAction({ leadId, action: "proposal_status_changed", description: `Etapa alterada para "${stageLabel}" no Pipe Propostas` });
      if (organizationId) track({ event: "card_moved", organizationId, entityType: "pipe_propostas", entityId: itemId, metadata: { to_stage: newStatus } });

      if (newStatus === "vendido") {
        toast.success("🎉 Venda fechada com sucesso!");
      } else if (newStatus === "perdido") {
        toast("Proposta marcada como perdida");
      } else if (newStatus === "compromisso_marcado") {
        toast.success("📅 Compromisso agendado!");
      } else {
        toast.success("Status atualizado!");
      }

      // Transição automática: etapa de sucesso com destino = funil customizado.
      const movedStage = pipelineStages.find((s) => s.stage_key === newStatus);
      if (
        movedStage?.is_final_positive &&
        movedStage.target_pipeline_id &&
        movedStage.target_stage_id &&
        organizationId
      ) {
        await upsertLeadIntoCustomPipe({
          leadId,
          organizationId,
          targetPipelineId: movedStage.target_pipeline_id,
          targetStageId: movedStage.target_stage_id,
        });
        queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
        toast.success("Lead movido para o funil de destino automaticamente!");
      }
    } catch (error) {
      toast.error("Erro ao atualizar status");
      console.error(error);
    }
  };

  // Handle commitment date confirmation
  const handleCommitmentDateConfirm = async (date: Date) => {
    if (!pendingStatusChange) return;

    await executeStatusChange(
      pendingStatusChange.itemId,
      "compromisso_marcado",
      pendingStatusChange.leadId,
      pendingStatusChange.closerId,
      date
    );

    setIsDateModalOpen(false);
    setPendingStatusChange(null);
  };

  // Guard ref to prevent double execution of vendido completion
  const vendidoCompletingRef = useRef(false);

  // Handle TinyERP vendido confirmation (after modal confirms or skips)
  const handleTinyVendidoComplete = async () => {
    if (!pendingVendido || vendidoCompletingRef.current) return;
    vendidoCompletingRef.current = true;
    const pv = pendingVendido;
    setPendingVendido(null);

    try {
      // Execute the status change with skip_auto_push since modal already handled TinyERP
      await executeStatusChange(
        pv.itemId,
        "vendido",
        pv.leadId,
        pv.closerId,
        undefined,
        true, // skip auto-push — modal already sent the order (or user chose to skip)
        undefined,
        pv.saleValue
      );
    } finally {
      vendidoCompletingRef.current = false;
    }
  };

  // Guard ref to prevent double execution of cadastro externo completion
  const cadastroCompletingRef = useRef(false);

  const handleCadastroExternoComplete = async () => {
    if (!pendingCadastroExterno || cadastroCompletingRef.current) return;
    cadastroCompletingRef.current = true;
    const pv = pendingCadastroExterno;
    setPendingCadastroExterno(null);

    try {
      await executeStatusChange(
        pv.itemId,
        "vendido",
        pv.leadId,
        pv.closerId,
        undefined,
        undefined,
        undefined,
        pv.saleValue
      );
    } finally {
      cadastroCompletingRef.current = false;
    }
  };

  // Handle commitment date cancel
  const handleCommitmentDateCancel = () => {
    setIsDateModalOpen(false);
    setPendingStatusChange(null);
    toast("Operação cancelada");
  };

  // Handle calor change
  const handleCalorChange = async (itemId: string, calor: number) => {
    const item = pipeData?.find(p => p.id === itemId);
    if (!item) return;

    try {
      await updatePipeProposta.mutateAsync({
        id: itemId,
        calor,
        leadId: item.lead_id,
        closerId: item.closer_id,
      });
      toast.success("Calor atualizado!");
    } catch (error) {
      toast.error("Erro ao atualizar calor");
      console.error(error);
    }
  };

  // Render column footer with total value
  const renderColumnFooter = (column: KanbanColumn<LeadCardData>) => (
    <div className="mb-3 p-2 rounded-lg bg-background/50">
      <p className="text-xs text-muted-foreground">
        Total:{" "}
        <span className="font-semibold text-foreground">
          {formatCurrency(column.items.reduce((sum, p) => sum + p.value, 0))}
        </span>
      </p>
    </div>
  );

  if (isLoading) {
    return <TorqueLoader variant="inline" />;
  }

  return (
    <div className="space-y-6">
      {/* Faixa única de controles — Modelo 1 do protótipo
          `.specs/mockups/funis-redesign/`, o mesmo componente dos outros funis. */}
      <FunnelControlBar
        funnelKey="sys:propostas"
        funnelLabel="Propostas"
        funnelColor="#f59e0b"
        search={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Buscar proposta, empresa, telefone…"
        views={
          <FunnelViewsMenu
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            viewOptions={[
              { value: "kanban", icon: LayoutGrid, label: "Kanban" },
              { value: "analytics", icon: BarChart3, label: "Analytics" },
            ]}
            entityType="pipe_propostas"
            currentFilters={filterState}
            defaultFilters={DEFAULT_PROPOSTAS_FILTERS}
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
          <Button size="sm" className="h-9 gradient-gold" onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nova Proposta
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
        pipeType="propostas"
        stages={pipelineStages}
      />

      {/* Ghost leads (RLS divergente entre pipe e leads) */}
      <GhostLeadsBanner pipeType="propostas" ghostCount={ghostLeadsCount} />

      {/* Summary Cards — só no modo Analytics */}
      {viewMode === "analytics" && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <AnalyticsStatCard
            label="Pipeline Ativo"
            value={formatCurrency(displayStats.inProgress)}
            sub={`${displayStats.inProgressCount} propostas`}
            accent="gold"
            onClick={() => setDrilldownMetric("pipeline_ativo")}
          />
          <AnalyticsStatCard
            label="Vendas Total"
            value={formatCurrency(displayStats.sold)}
            sub={`${displayStats.soldCount} vendas`}
            accent="success"
            tintValue
            delay={0.05}
            onClick={() => setDrilldownMetric("vendas_total")}
          />
          <AnalyticsStatCard
            label="Rec. Vendida"
            value={formatCurrency(displayStats.mrr)}
            sub="valor vendido /mês"
            accent="blue"
            delay={0.1}
            onClick={() => setDrilldownMetric("rec_vendida")}
          />
          <AnalyticsStatCard
            label="Projetos Vendidos"
            value={formatCurrency(displayStats.projeto)}
            sub="valor vendido"
            accent="neutral"
            delay={0.15}
            onClick={() => setDrilldownMetric("projetos_vendidos")}
          />
          <AnalyticsStatCard
            label="Taxa de Conversão"
            value={`${displayStats.conversionRate.toFixed(1)}%`}
            sub="vendas / total no pipe"
            accent="gold"
            tintValue
            delay={0.2}
            onClick={() => setDrilldownMetric("taxa_conversao")}
          />
        </div>
      )}

      <AnimatePresence mode="wait">
        {viewMode === "kanban" ? (
          <motion.div
            key="kanban"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            {/* Banner: kanban filtrado por período */}
            {periodRange && (
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground mb-4">
                <CalendarIcon className="w-4 h-4 shrink-0" />
                <span className="flex-1">
                  Exibindo cards criados em{" "}
                  <span className="text-foreground font-medium">{formatPeriodLabel(periodRange)}</span>
                  {" "}• {periodFilteredCount} proposta{periodFilteredCount !== 1 ? "s" : ""}
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

            {/* Kanban Board with Drag-and-Drop (desktop) / List View (mobile) */}
            {isMobile ? (
              <PipelineListView
                stages={mobileStages}
                leads={mobileLeads}
                onLeadClick={handleMobileLeadClick}
                onMoveLeadToStage={handleMobileMove}
                isLoading={isLoading}
              />
            ) : (
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
                  <StageWorkflowsBadgeWrapper pipeType="propostas" stageKey={col.id} stageName={col.title} counts={merged} />
                );
              }}
              renderCard={(card) => (
                <LeadCard
                  lead={card}
                  variant="propostas"
                  density="compact"
                  selected={bulk.isSelected(card.leadId || "")}
                  onSelect={(e) => {
                    const lid = card.leadId || "";
                    if (e.shiftKey) bulk.toggleRange(lid, allLeadIds);
                    else bulk.toggle(lid);
                  }}
                  onClick={() => {
                    const item = pipeData?.find(p => p.id === card.id);
                    if (item) {
                      openDeal(item.id, item.lead_id || item.lead?.id);
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
              renderColumnFooter={renderColumnFooter}
            />
            )}
          </motion.div>
        ) : (
          <motion.div
            key="analytics"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Analytics Tabs */}
            <Tabs value={analyticsTab} onValueChange={(v) => setAnalyticsTab(v as any)}>
              <TabsList className="bg-muted/50">
                <TabsTrigger value="propostas" className="gap-1.5">
                  <TrendingUp className="w-4 h-4" />
                  Propostas
                </TabsTrigger>
                <TabsTrigger value="produtos" className="gap-1.5">
                  <Package className="w-4 h-4" />
                  Produtos
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <AnimatePresence mode="wait">
              {analyticsTab === "propostas" ? (
                <motion.div
                  key="propostas-analytics"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="grid md:grid-cols-2 gap-6"
                >
                  {/* Funnel */}
                  <AnalyticsPanel title="Funil de Vendas" subtitle="Volume e valor por etapa">
                    <ContinuousFunnel
                      unit="propostas"
                      stages={funnelData.map(stage => ({
                        key: stage.id,
                        label: stage.name,
                        count: stage.count,
                        valueLabel: formatCurrency(stage.value),
                        tone: stage.id === "vendido" ? ("success" as const) : undefined,
                      }))}
                    />
                  </AnalyticsPanel>

                  {/* Calor Analysis */}
                  <AnalyticsPanel
                    title="Propostas por Calor"
                    subtitle="Valor em aberto por temperatura"
                    dot="destructive"
                  >
                    <CalorBars data={calorData} />
                  </AnalyticsPanel>

                  {/* By Responsible */}
                  <AnalyticsPanel
                    title="Performance por Responsável"
                    subtitle="Propostas trabalhadas e valor fechado"
                  >
                    <MemberLeaderboard
                      rows={responsibleMembers
                        .map(member => {
                          const memberProposals = pipeData?.filter(p => p.responsible_id === member.id) || [];
                          const memberSold = memberProposals.filter(p => p.status === "vendido");
                          const memberSoldValue = memberSold.reduce((sum, p) => sum + (p.sale_value || 0), 0);
                          const rate = memberProposals.length > 0
                            ? (memberSold.length / memberProposals.length) * 100
                            : 0;
                          return {
                            id: member.id,
                            name: member.name,
                            ratePct: rate,
                            headline: formatCurrency(memberSoldValue),
                            subline: `${rate.toFixed(0)}% de fechamento`,
                            context: `${memberProposals.length} propostas · ${memberSold.length} venda${memberSold.length !== 1 ? "s" : ""}`,
                            currency: true,
                            total: memberProposals.length,
                          };
                        })
                        .sort((a, b) => b.total - a.total)}
                    />
                  </AnalyticsPanel>

                  {/* Recent Sales */}
                  <div className="glass-card p-6">
                    <h3 className="font-semibold mb-6 flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-success" />
                      Vendas Recentes
                    </h3>
                    <div className="space-y-3">
                      {pipeData?.filter(p => p.status === "vendido")
                        .sort((a, b) => new Date(b.closed_at || 0).getTime() - new Date(a.closed_at || 0).getTime())
                        .slice(0, 5)
                        .map(sale => (
                          <motion.div
                            key={sale.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center justify-between p-4 rounded-lg border bg-success/5 border-success/20"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
                                <TrendingUp className="w-5 h-5 text-success" />
                              </div>
                              <div>
                                <p className="font-medium">{sale.lead?.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {sale.lead?.company}{sale.closer?.name ? ` • ${sale.closer.name}` : ""}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-success">{formatCurrency(sale.sale_value || 0)}</p>
                              <p className="text-xs text-muted-foreground">
                                {sale.closed_at && format(new Date(sale.closed_at), "dd/MM/yyyy", { locale: ptBR })}
                              </p>
                            </div>
                          </motion.div>
                        ))}

                      {!pipeData?.some(p => p.status === "vendido") && (
                        <p className="text-center text-muted-foreground py-8">
                          Nenhuma venda fechada ainda
                        </p>
                      )}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="produtos-analytics"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <ProductAnalyticsChart data={productData} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Proposal Modal */}
      <CreateProposalModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSuccess={refetch}
      />

      {/* TinyERP Confirm Order Modal (on drag-to-vendido) */}
      {pendingVendido && (
        <TinyErpConfirmOrderDialog
          open={tinyConfirmOpen}
          onOpenChange={(open) => {
            setTinyConfirmOpen(open);
            if (!open && pendingVendido) {
              // Dialog closed (overlay/escape) without explicit action — still complete vendido
              handleTinyVendidoComplete();
            }
          }}
          pipePropostaId={pendingVendido.itemId}
          lead={pendingVendido.lead}
          items={pendingVendido.items}
          totalValue={pendingVendido.totalValue}
          onSuccess={handleTinyVendidoComplete}
        />
      )}

      {/* Cadastro Externo Confirm Dialog (on drag-to-vendido) */}
      {pendingCadastroExterno && (
        <CadastroExternoConfirmDialog
          open={cadastroExternoOpen}
          onOpenChange={(open) => {
            setCadastroExternoOpen(open);
            if (!open && pendingCadastroExterno) {
              handleCadastroExternoComplete();
            }
          }}
          pipePropostaId={pendingCadastroExterno.itemId}
          lead={pendingCadastroExterno.lead}
          items={pendingCadastroExterno.items}
          totalValue={pendingCadastroExterno.totalValue}
          contractDuration={pendingCadastroExterno.contractDuration}
          proposalNotes={pendingCadastroExterno.proposalNotes}
          onSuccess={handleCadastroExternoComplete}
        />
      )}

      {/* Required sale-value gate before a won-transition (D1 / SQL-I3) */}
      <SaleValueRequiredModal
        open={saleGuard.saleValueModalOpen}
        onConfirm={saleGuard.confirmSaleValue}
        onCancel={saleGuard.cancelSaleValue}
        leadName={wonValueLeadName}
      />

      {/* Commitment Date Modal */}
      <CommitmentDateModal
        open={isDateModalOpen}
        onOpenChange={setIsDateModalOpen}
        onConfirm={handleCommitmentDateConfirm}
        onCancel={handleCommitmentDateCancel}
        leadName={pendingStatusChange?.leadName || "Lead"}
      />

      {/* Loss Reason Dialog (drag-to-perdido) */}
      <AlertDialog open={lossReasonDialogOpen} onOpenChange={(open) => { if (!open) { setLossReasonDialogOpen(false); setPendingPerdido(null); setSelectedLossReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Motivo da perda</AlertDialogTitle>
            <AlertDialogDescription>
              Selecione o motivo pelo qual esta proposta foi perdida. Isso ajuda a melhorar o processo comercial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2">
            <Select value={selectedLossReason} onValueChange={setSelectedLossReason}>
              <SelectTrigger>
                <SelectValue placeholder="Selecionar motivo (opcional)" />
              </SelectTrigger>
              <SelectContent>
                {lossReasons.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleLossReasonCancel}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLossReasonConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirmar Perda
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
        pipe="propostas"
        leadCount={stageToExport?.count ?? 0}
      />

      {/* Metric Drilldown Sheet (click stat-card no modo Analytics) */}
      <MetricDrilldownSheet
        open={!!drilldownMetric}
        onOpenChange={(open) => { if (!open) setDrilldownMetric(null); }}
        metric={drilldownMetric}
        periodLabel={drilldownPeriodLabel}
        displayValue={drilldownDisplayValue}
        displayCount={drilldownDisplayCount}
        data={drilldownData}
        isLoading={drilldownLoading}
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

      {/* Disparo Wizard (system funnel: propostas). Mounted only while open so
          its audience-resolution queries never run in the background. */}
      {isDisparoOpen && (
        <DisparoWizard
          open={isDisparoOpen}
          onOpenChange={setIsDisparoOpen}
          context={{ kind: "system", pipelineType: "propostas" }}
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
              Você irá remover esta proposta do funil. O lead será mantido no sistema.
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

      {/* Delete leads from a specific stage (Propostas) confirmation */}
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

export default function PipePropostas() {
  return (
    <DealPanelProvider>
      <LeadPanelLayout panel={<DealDetailDialog />}>
        <PipePropostasInner />
      </LeadPanelLayout>
    </DealPanelProvider>
  );
}
