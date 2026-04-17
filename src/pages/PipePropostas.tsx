import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Filter, Plus, Calendar as CalendarIcon, User, Building2, Star,
  DollarSign, Clock, Tag, Loader2, TrendingUp, Package,
  ArrowUpRight, Percent, BarChart3, Target, Flame, MessageCircle, Settings2,
  MoreVertical, Trash2
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { DraggableKanbanBoard, KanbanColumn } from "@/components/kanban/DraggableKanbanBoard";
import { TorqueLoader } from "@/components/branding/TorqueLoader";
import { useCanPerformAction } from "@/lib/permissions";
import { StageWorkflowsBadgeWrapper } from "@/components/kanban/StageWorkflowsBadgeWrapper";
import { useStageWorkflowCounts } from "@/hooks/useStageWorkflows";
import { usePipePropostas, useUpdatePipeProposta, useDeletePipeProposta, PipePropostasStatus } from "@/hooks/usePipePropostas";
import { usePipePropostasMetrics } from "@/hooks/usePipeMetrics";
import { type MetricsPeriodState, getDateRange, createInitialPeriodState } from "@/lib/metrics-period";
import { MetricsPeriodSelector } from "@/components/pipelines/MetricsPeriodSelector";
import { useDeleteAllLeadsInPipe, useUpdateLead } from "@/hooks/useLeads";
import { usePipelineStages, stagesToColumns } from "@/hooks/usePipelineStages";
import { PipeSettingsDialog } from "@/components/pipelines/PipeSettingsDialog";
import { useTeamMembers, useResponsibleMembers } from "@/hooks/useTeamMembers";
import { CreateProposalModal } from "@/components/proposals/CreateProposalModal";
import { LeadCard, type LeadCardData } from "@/components/leads/LeadCard";
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer";
import { PropostasContext } from "@/components/leads/funnel-contexts";
import { FunnelChart } from "@/components/dashboard/FunnelChart";
import { CalorSlider, CalorBadge } from "@/components/proposals/CalorSlider";
import { QuickAddDailyAction } from "@/components/proposals/QuickAddDailyAction";
import { CommitmentDateModal } from "@/components/proposals/CommitmentDateModal";
import { TinyErpConfirmOrderDialog } from "@/components/proposals/TinyErpConfirmOrderDialog";
import { DaysUntilMeeting } from "@/components/proposals/DaysUntilMeeting";
import { useTinyErpStatus } from "@/hooks/useTinyErp";
import { useCadastroExternoEnabled } from "@/hooks/useCadastroExterno";
import { CadastroExternoConfirmDialog } from "@/components/proposals/CadastroExternoConfirmDialog";
import { useCreateAcaoDoDia } from "@/hooks/useAcoesDoDia";
import { useLeadsWithScheduledMessages } from "@/hooks/useScheduledMessages";
import { supabase } from "@/integrations/supabase/client";
import { CalorAnalyticsChart } from "@/components/proposals/CalorAnalyticsChart";
import { ProductAnalyticsChart } from "@/components/proposals/ProductAnalyticsChart";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/hooks/useOrganization";
import { track, trackModuleVisit } from "@/lib/analytics";
import { useFeaturePermission, useIsAdmin } from "@/hooks/useUserRole";
import { useMasterAuth } from "@/hooks/useMasterAuth";

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
  item: { status: string; metrics_period_at?: string | null; closed_at?: string | null; created_at?: string | null },
  startStr: string,
  endStr: string,
): boolean {
  if (CLOSED_STATUSES_PROPOSTAS.includes(item.status)) {
    const ref = item.metrics_period_at ?? item.closed_at;
    if (!ref) return false;
    return ref >= startStr && ref <= endStr;
  }
  const ref = item.created_at;
  if (!ref) return false;
  return ref >= startStr && ref <= endStr;
}

// ---------------------------------------------------------------------------
// Loss reasons for "perdido" status
// ---------------------------------------------------------------------------
const LOSS_REASONS = [
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
  viewMode: "kanban",
  membroDefaultApplied: false,
};

export default function PipePropostas() {
  const [filterState, setFilterState] = usePersistedState(
    "propostas",
    DEFAULT_PROPOSTAS_FILTERS
  );

  const { searchTerm, filterResponsible, filterProductType, filterPriority, filterCalor, viewMode } = filterState;

  const setSearchTerm = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, searchTerm: v })),
    [setFilterState]
  );
  const setFilterResponsible = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, filterResponsible: v })),
    [setFilterState]
  );
  const setFilterProductType = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, filterProductType: v })),
    [setFilterState]
  );
  const setFilterPriority = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, filterPriority: v })),
    [setFilterState]
  );
  const setFilterCalor = useCallback(
    (v: string) => setFilterState((f) => ({ ...f, filterCalor: v })),
    [setFilterState]
  );
  const setViewMode = useCallback(
    (v: "kanban" | "analytics") => setFilterState((f) => ({ ...f, viewMode: v })),
    [setFilterState]
  );
  const { data: leadsWithSchedule } = useLeadsWithScheduledMessages();
  const [filterScheduled, setFilterScheduled] = useState(false);

  // ─── Filtro defensivo: para role "member" (ex-membro), pré-seleciona o próprio
  // teamMemberId na primeira visita. Cria camada extra de proteção client-side
  // além da RLS. Membros ainda podem trocar manualmente; a flag membroDefaultApplied
  // garante que o default só aplica uma vez por usuário.
  const { teamMemberId } = useOrganization();
  const { isAdmin } = useIsAdmin();
  const { isMaster } = useMasterAuth();
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
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedProposta, setSelectedProposta] = useState<any>(null);
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
  } | null>(null);

  // State for loss reason dialog (drag-to-perdido)
  const [lossReasonDialogOpen, setLossReasonDialogOpen] = useState(false);
  const [selectedLossReason, setSelectedLossReason] = useState<string>("");
  const [pendingPerdido, setPendingPerdido] = useState<{
    itemId: string;
    leadId: string;
    closerId: string | null;
  } | null>(null);

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pipeId: string; leadId: string } | null>(null);
  const [deleteAllLeadsDialogOpen, setDeleteAllLeadsDialogOpen] = useState(false);
  const [periodState, setPeriodState] = useState<MetricsPeriodState>(createInitialPeriodState);
  const [stageToDelete, setStageToDelete] = useState<{ id: string; title: string } | null>(null);

  const { organizationId } = useOrganization();
  useEffect(() => { trackModuleVisit("pipe_propostas", organizationId); }, []);

  const { data: pipeData, isLoading, refetch } = usePipePropostas();
  const { data: pipelineStages = [] } = usePipelineStages("propostas");
  const { data: workflowCounts = {} } = useStageWorkflowCounts("propostas");
  const { data: teamMembers } = useTeamMembers();
  const updatePipeProposta = useUpdatePipeProposta();
  const { allowed: canMovePipe } = useCanPerformAction("move_pipe_record");
  const { data: tinyStatus } = useTinyErpStatus();
  const cadastroExternoEnabled = useCadastroExternoEnabled();
  const deletePipeProposta = useDeletePipeProposta();
  const deleteAllLeadsInPipe = useDeleteAllLeadsInPipe("propostas");
  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();
  const createAcaoDoDia = useCreateAcaoDoDia();
  const { allowed: canDeleteCards } = useFeaturePermission("pipeline.delete_cards");
  const periodRange = useMemo(() => getDateRange(periodState), [periodState]);
  const { data: metricsByPeriod } = usePipePropostasMetrics(periodRange);

  const responsibleMembers = useResponsibleMembers();

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

  // Organize data by status columns (recent first; compromisso_marcado by commitment date)
  const columns = useMemo((): KanbanColumn<LeadCardData>[] => {
    if (!pipeData) return statusColumns.map(col => ({ ...col, items: [] }));

    return statusColumns.map(col => {
      const columnItems = pipeData
        .filter(item => item.status === col.id)
        // 1. Filtro temporal — aplicado antes dos demais filtros
        .filter(item => {
          if (periodRange) {
            return isPropostaInPeriod(item, periodRange.startStr, periodRange.endStr);
          }
          return true;
        })
        // 2. Filtros funcionais (busca, responsável, tipo, prioridade, calor)
        .filter(item => {
          const lead = item.lead;

          // Hide ghost leads (RLS blocked the lead data for this user)
          if (!lead) return false;

          // Search filter
          const matchesSearch = searchTerm === "" ||
            lead?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            lead?.company?.toLowerCase().includes(searchTerm.toLowerCase());

          // Responsible filter
          const matchesResponsible = filterResponsible === "all" || item.responsible_id === filterResponsible;

          // Product type filter
          const matchesType = filterProductType === "all" || item.product_type === filterProductType;

          // Priority filter based on lead rating
          const rating = lead?.rating || 0;
          let matchesPriority = true;
          if (filterPriority === "high") {
            matchesPriority = rating >= 8;
          } else if (filterPriority === "medium") {
            matchesPriority = rating >= 5 && rating < 8;
          } else if (filterPriority === "low") {
            matchesPriority = rating < 5;
          }

          // Calor filter
          const calor = item.calor ?? 5;
          let matchesCalor = true;
          if (filterCalor === "hot") {
            matchesCalor = calor >= 7;
          } else if (filterCalor === "warm") {
            matchesCalor = calor >= 4 && calor < 7;
          } else if (filterCalor === "cold") {
            matchesCalor = calor < 4;
          }

          const matchesScheduled = !filterScheduled || (leadsWithSchedule?.has(item.lead_id) ?? false);

          return matchesSearch && matchesResponsible && matchesType && matchesPriority && matchesCalor && matchesScheduled;
        })
        .map(transformToCard)
        .toSorted((a, b) => {
          const timeA = new Date(a.createdAt || 0).getTime();
          const timeB = new Date(b.createdAt || 0).getTime();
          return timeB - timeA;
        });
      return {
        ...col,
        items: columnItems,
      };
    });
  }, [pipeData, statusColumns, searchTerm, filterResponsible, filterProductType, filterPriority, filterCalor, filterScheduled, leadsWithSchedule, periodRange]);

  // Calculate stats (Vendas Total / Rec. Vendida / Projetos Vendidos por item quando houver items)
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
      // contract_duration nulo/inválido → fallback de 1 mês
      const duration = Math.max(1, Number(item.contract_duration) || 1);
      const items = item.items?.filter((i: any) => i != null) ?? [];
      if (items.length > 0) {
        for (const it of items) {
          const val = Number(it.sale_value) || 0;
          const t = it.product?.type;
          if (t === "mrr") {
            mrr += val;             // Rec. Vendida = valor mensal recorrente
            sold += val * duration; // Venda Total = mensal × duração do contrato
          } else if (t === "projeto") {
            projeto += val;
            sold += val;            // Projeto: valor pontual
          } else {
            sold += val;            // Unitário: valor pontual
          }
        }
      } else {
        const val = Number(item.sale_value) || 0;
        if (item.product_type === "mrr") {
          mrr += val;
          sold += val * duration;
        } else if (item.product_type === "projeto") {
          projeto += val;
          sold += val;
        } else {
          sold += val;
        }
      }
    }

    const total = pipeData.reduce((sum, item) => sum + (item.sale_value || 0), 0);
    const inProgress = inProgressData.reduce((sum, item) => sum + (item.sale_value || 0), 0);

    const totalNoPipe = pipeData.length;
    const conversionRate = totalNoPipe > 0 ? (soldData.length / totalNoPipe) * 100 : 0;

    return { 
      total, 
      sold, 
      soldCount: soldData.length,
      mrr, 
      projeto, 
      inProgress,
      inProgressCount: inProgressData.length,
      conversionRate 
    };
  }, [pipeData]);

  // Exibir métricas: "Geral" = stats do pipe; outros modos = hook (vendidos no período); pipeline ativo sempre do pipe atual
  const displayStats = useMemo(() => {
    if (!periodRange || !metricsByPeriod) {
      return stats;
    }
    return {
      ...metricsByPeriod,
      inProgress: stats.inProgress,
      inProgressCount: stats.inProgressCount,
    };
  }, [periodRange, metricsByPeriod, stats]);

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

  // Handle status change from drag-and-drop
  const handleStatusChange = async (itemId: string, newStatus: string) => {
    console.log("[PipePropostas] handleStatusChange called:", { itemId, newStatus, tinyConnected: tinyStatus?.connected });
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

    await executeStatusChange(itemId, newStatus, item.lead_id, item.closer_id);
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
    lossReason?: string | null
  ) => {
    try {
      const updates: any = {
        id: itemId,
        status: newStatus as PipePropostasStatus,
        leadId,
        closerId,
        skip_auto_push: skipAutoPush,
      };

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
        true // skip auto-push — modal already sent the order (or user chose to skip)
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            Gestão de Propostas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {pipeData?.length || 0} propostas • Arraste para alterar status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
            <TabsList>
              <TabsTrigger value="kanban" className="gap-1.5">
                <BarChart3 className="w-4 h-4" />
                Kanban
              </TabsTrigger>
              <TabsTrigger value="analytics" className="gap-1.5">
                <TrendingUp className="w-4 h-4" />
                Analytics
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" className="gap-2" onClick={() => setIsSettingsOpen(true)}>
            <Settings2 className="w-4 h-4" />
            Configurações
          </Button>
          <Button className="gap-2" onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4" />
            Nova Proposta
          </Button>
        </div>
      </div>

      <PipeSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        pipeType="propostas"
        stages={pipelineStages}
      />

      {/* Período das métricas */}
      <MetricsPeriodSelector state={periodState} onChange={setPeriodState} />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="stat-card"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Pipeline Ativo</p>
            <Target className="w-4 h-4 text-primary" />
          </div>
          <p className="text-xl font-bold">{formatCurrency(displayStats.inProgress)}</p>
          <p className="text-xs text-muted-foreground">{displayStats.inProgressCount} propostas</p>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="stat-card"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Vendas Total</p>
            <TrendingUp className="w-4 h-4 text-success" />
          </div>
          <p className="text-xl font-bold text-success">{formatCurrency(displayStats.sold)}</p>
          <p className="text-xs text-muted-foreground">{displayStats.soldCount} vendas</p>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="stat-card"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Rec. Vendida</p>
            <ArrowUpRight className="w-4 h-4 text-chart-5" />
          </div>
          <p className="text-xl font-bold text-chart-5">{formatCurrency(displayStats.mrr)}</p>
          <p className="text-xs text-muted-foreground">valor vendido /mês</p>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="stat-card"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Projetos Vendidos</p>
            <Package className="w-4 h-4 text-primary" />
          </div>
          <p className="text-xl font-bold text-primary">{formatCurrency(displayStats.projeto)}</p>
          <p className="text-xs text-muted-foreground">valor vendido</p>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="stat-card"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Taxa de Conversão</p>
            <Percent className="w-4 h-4 text-chart-3" />
          </div>
          <p className="text-xl font-bold">{displayStats.conversionRate.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">vendas / total no pipe</p>
        </motion.div>
      </div>

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
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-sm text-primary mb-4">
                <CalendarIcon className="w-4 h-4 shrink-0" />
                <span>
                  Filtrando por período — {periodFilteredCount} proposta{periodFilteredCount !== 1 ? "s" : ""}
                </span>
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-6">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar proposta..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={filterResponsible} onValueChange={setFilterResponsible}>
                <SelectTrigger className="w-[160px]">
                  <User className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Responsável" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os responsáveis</SelectItem>
                  {responsibleMembers.map(member => (
                    <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterProductType} onValueChange={setFilterProductType}>
                <SelectTrigger className="w-[140px]">
                  <Tag className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Tipos</SelectItem>
                  <SelectItem value="mrr">Recorrência</SelectItem>
                  <SelectItem value="projeto">Projeto</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterCalor} onValueChange={setFilterCalor}>
                <SelectTrigger className="w-[140px]">
                  <Flame className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Calor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="hot">
                    <div className="flex items-center gap-2">
                      <Flame className="w-3 h-3 text-destructive" />
                      Quente (7-10)
                    </div>
                  </SelectItem>
                  <SelectItem value="warm">
                    <div className="flex items-center gap-2">
                      <Flame className="w-3 h-3 text-chart-5" />
                      Morno (4-6)
                    </div>
                  </SelectItem>
                  <SelectItem value="cold">
                    <div className="flex items-center gap-2">
                      <Flame className="w-3 h-3 text-muted-foreground" />
                      Frio (0-3)
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="w-[160px]">
                  <Star className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Prioridade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Prioridades</SelectItem>
                  <SelectItem value="high">
                    <div className="flex items-center gap-2">
                      <span className="text-chart-5">★★★</span>
                      Alta (8-10)
                    </div>
                  </SelectItem>
                  <SelectItem value="medium">
                    <div className="flex items-center gap-2">
                      <span className="text-chart-5">★★</span>
                      Média (5-7)
                    </div>
                  </SelectItem>
                  <SelectItem value="low">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">★</span>
                      Baixa (0-4)
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button variant={filterScheduled ? "default" : "outline"} size="sm" onClick={() => setFilterScheduled(!filterScheduled)} className="gap-1.5">
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
                const merged = { total: stageCounts.total + allCounts.total, active: stageCounts.active + allCounts.active };
                return (
                  <StageWorkflowsBadgeWrapper pipeType="propostas" stageKey={col.id} stageName={col.title} counts={merged} />
                );
              }}
              renderCard={(card) => (
                <LeadCard
                  lead={card}
                  variant="propostas"
                  onClick={() => {
                    const item = pipeData?.find(p => p.id === card.id);
                    if (item) {
                      setSelectedProposta(item);
                      setIsDetailModalOpen(true);
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
              renderColumnFooter={renderColumnFooter}
            />
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
                  <div className="glass-card p-6">
                    <h3 className="font-semibold mb-6 flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-primary" />
                      Funil de Vendas
                    </h3>
                    <FunnelChart 
                      title="Pipeline"
                      steps={funnelData.map(stage => ({
                        label: stage.name,
                        value: stage.count,
                        color: `bg-[${stage.color}]`,
                      }))}
                    />
                  </div>

                  {/* Calor Analysis */}
                  <div className="glass-card p-6">
                    <h3 className="font-semibold mb-6 flex items-center gap-2">
                      <Flame className="w-5 h-5 text-destructive" />
                      Propostas por Calor
                    </h3>
                    <CalorAnalyticsChart data={calorData} />
                  </div>

                  {/* By Responsible */}
                  <div className="glass-card p-6">
                    <h3 className="font-semibold mb-6 flex items-center gap-2">
                      <User className="w-5 h-5 text-primary" />
                      Performance por Responsável
                    </h3>
                    <div className="space-y-4">
                      {responsibleMembers.map(member => {
                        const memberProposals = pipeData?.filter(p => p.responsible_id === member.id) || [];
                        const memberValue = memberProposals.reduce((sum, p) => sum + (p.sale_value || 0), 0);
                        const memberSold = memberProposals.filter(p => p.status === "vendido");
                        const memberSoldValue = memberSold.reduce((sum, p) => sum + (p.sale_value || 0), 0);

                        return (
                          <div key={member.id} className="flex items-center justify-between p-3 rounded-lg border">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <User className="w-5 h-5 text-primary" />
                              </div>
                              <div>
                                <p className="font-medium">{member.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {memberProposals.length} propostas
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-success">{formatCurrency(memberSoldValue)}</p>
                              <p className="text-xs text-muted-foreground">
                                {memberSold.length} vendas
                              </p>
                            </div>
                          </div>
                        );
                      })}

                      {responsibleMembers.length === 0 && (
                        <p className="text-center text-muted-foreground py-4">
                          Nenhum responsável cadastrado
                        </p>
                      )}
                    </div>
                  </div>

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

      {/* Proposal Detail Drawer */}
      <LeadDetailDrawer
        open={isDetailModalOpen}
        onOpenChange={setIsDetailModalOpen}
        leadId={selectedProposta?.lead_id || selectedProposta?.lead?.id || null}
        variant="propostas"
        pipeData={selectedProposta}
        onSuccess={refetch}
        renderFunnelContext={({ lead, pipeData: pData, onSuccess: onCtxSuccess }) => (
          <PropostasContext lead={lead} pipeData={pData} onSuccess={onCtxSuccess} />
        )}
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
                {LOSS_REASONS.map((r) => (
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
            <AlertDialogTitle>Excluir leads da etapa "{stageToDelete?.title}"</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação irá excluir todos os leads que estão na etapa "{stageToDelete?.title}" do funil de Propostas e na base de dados (histórico, tags, etc.). Leads em outras etapas não serão afetados. Não é possível desfazer.
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
    </div>
  );
}
