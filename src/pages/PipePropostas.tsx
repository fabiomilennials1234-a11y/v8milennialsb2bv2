import { useState, useMemo, useRef, memo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Filter, Plus, Calendar, User, Building2, Star,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DraggableKanbanBoard, DraggableItem, KanbanColumn } from "@/components/kanban/DraggableKanbanBoard";
import { useCanPerformAction } from "@/lib/permissions";
import { StageWorkflowsBadgeWrapper } from "@/components/kanban/StageWorkflowsBadgeWrapper";
import { useStageWorkflowCounts } from "@/hooks/useStageWorkflows";
import { usePipePropostas, useUpdatePipeProposta, useDeletePipeProposta, PipePropostasStatus } from "@/hooks/usePipePropostas";
import { usePipePropostasMetrics, type MetricsPeriod } from "@/hooks/usePipeMetrics";
import { useDeleteAllLeadsInPipe } from "@/hooks/useLeads";
import { usePipelineStages, stagesToColumns } from "@/hooks/usePipelineStages";
import { PipeSettingsDialog } from "@/components/pipelines/PipeSettingsDialog";
import { useTeamMembers, useResponsibleMembers } from "@/hooks/useTeamMembers";
import { CreateProposalModal } from "@/components/proposals/CreateProposalModal";
import { ProposalDetailModal } from "@/components/proposals/ProposalDetailModal";
import { FunnelChart } from "@/components/dashboard/FunnelChart";
import { CalorSlider, CalorBadge } from "@/components/proposals/CalorSlider";
import { QuickAddDailyAction } from "@/components/proposals/QuickAddDailyAction";
import { CommitmentDateModal } from "@/components/proposals/CommitmentDateModal";
import { TinyErpConfirmOrderDialog } from "@/components/proposals/TinyErpConfirmOrderDialog";
import { DaysUntilMeeting } from "@/components/proposals/DaysUntilMeeting";
import { useTinyErpStatus } from "@/hooks/useTinyErp";
import { supabase } from "@/integrations/supabase/client";
import { CalorAnalyticsChart } from "@/components/proposals/CalorAnalyticsChart";
import { ProductAnalyticsChart } from "@/components/proposals/ProductAnalyticsChart";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOrganization } from "@/hooks/useOrganization";
import { track, trackModuleVisit } from "@/lib/analytics";
import { useFeaturePermission } from "@/hooks/useUserRole";

interface ProposalItem {
  id: string;
  product_id: string | null;
  sale_value: number | null;
  product?: {
    id: string;
    name: string;
    type: "mrr" | "projeto" | "unitario";
  };
}

interface ProposalCard extends DraggableItem {
  name: string;
  company: string;
  email?: string;
  phone?: string;
  rating: number;
  calor: number;
  closer?: string;
  closerId?: string;
  productType: "mrr" | "projeto" | null;
  value: number;
  contractDuration: number;
  tags: { name: string; color: string }[];
  lastContact?: string;
  segment?: string;
  commitmentDate?: Date;
  leadId?: string;
  items: ProposalItem[];
  createdAt?: string;
  updatedAt?: string;
}

import { openWhatsApp, formatPhoneForWhatsApp } from "@/lib/whatsapp";

const ProposalCardComponent = memo(function ProposalCardComponent({
  proposal,
  onCalorChange,
  onDelete,
}: {
  proposal: ProposalCard;
  onCalorChange: (calor: number) => void;
  onDelete?: (pipeId: string, leadId: string) => void;
}) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formattedPhone = formatPhoneForWhatsApp(proposal.phone);
  const hasMultipleProducts = proposal.items.length > 1;
  const hasMixedTypes = proposal.items.some(i => i.product?.type === "mrr") && 
                        proposal.items.some(i => i.product?.type === "projeto");

  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      className="kanban-card group cursor-pointer w-full flex flex-col max-h-[340px] overflow-hidden"
    >
      <div className="overflow-y-auto overflow-x-hidden min-h-0 flex-1 pr-1 -mr-1 [scrollbar-gutter:stable]">
      {/* Quick Actions Row */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <CalorSlider 
          value={proposal.calor} 
          onChange={onCalorChange}
        />
        <QuickAddDailyAction
          propostaId={proposal.id}
          leadName={proposal.name}
        />
        {onDelete && proposal.leadId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(proposal.id, proposal.leadId!);
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remover do Funil
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm break-words line-clamp-2 group-hover:text-primary transition-colors" title={proposal.name}>
            {proposal.name}
          </h4>
          <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
            <Building2 className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="text-xs break-words line-clamp-2" title={proposal.company || "Sem empresa"}>{proposal.company || "Sem empresa"}</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {[...Array(5)].map((_, i) => (
            <Star
              key={i}
              className={cn(
                "w-3 h-3",
                i < Math.ceil(proposal.rating / 2)
                  ? "text-chart-5 fill-chart-5"
                  : "text-muted-foreground/30"
              )}
            />
          ))}
        </div>
      </div>

      {/* Product Items - Show each product with type badge and value (até 5 no card, resto em "+N") */}
      {proposal.items.length > 0 ? (
        <div className="space-y-1.5 mb-2">
          {proposal.items.slice(0, 5).map((item) => (
            <div 
              key={item.id} 
              className="flex items-center justify-between gap-2 p-1.5 rounded bg-muted/50 min-w-0"
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {item.product?.type && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] px-1.5 py-0 h-4 shrink-0",
                      item.product.type === "mrr"
                        ? "bg-chart-5/10 text-chart-5 border-chart-5/20"
                        : item.product.type === "unitario"
                        ? "bg-warning/10 text-warning border-warning/20"
                        : "bg-primary/10 text-primary border-primary/20"
                    )}
                  >
                    {item.product.type === "mrr" ? "MRR" : item.product.type === "unitario" ? "Unit" : "Proj"}
                  </Badge>
                )}
                <span className="text-xs break-words line-clamp-2 min-w-0" title={item.product?.name || "Produto"}>{item.product?.name || "Produto"}</span>
              </div>
              <span className="text-xs font-medium text-success shrink-0">
                {formatCurrency(item.sale_value || 0)}
              </span>
            </div>
          ))}
          {proposal.items.length > 5 && (
            <p className="text-[10px] text-muted-foreground text-center">
              +{proposal.items.length - 5} produto(s)
            </p>
          )}
        </div>
      ) : (
        /* Fallback for old proposals without items */
        <div className="flex items-center gap-2 mb-3">
          {proposal.productType && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                proposal.productType === "mrr"
                  ? "bg-chart-5/10 text-chart-5 border-chart-5/20"
                  : "bg-primary/10 text-primary border-primary/20"
              )}
            >
              {proposal.productType === "mrr" ? "MRR" : "Projeto"}
            </Badge>
          )}
          <div className="flex items-center gap-1 text-success font-semibold text-sm">
            <DollarSign className="w-3.5 h-3.5" />
            {formatCurrency(proposal.value)}
            {proposal.productType === "mrr" && (
              <span className="text-xs font-normal text-muted-foreground">/mês</span>
            )}
          </div>
        </div>
      )}

      {/* Total Value - Show when multiple products */}
      {proposal.items.length > 0 && (
        <div className="flex items-center justify-between mb-2 pt-2 border-t border-border/50">
          <span className="text-xs text-muted-foreground">Total:</span>
          <div className="flex items-center gap-1 text-success font-semibold text-sm shrink-0">
            <DollarSign className="w-3.5 h-3.5" />
            {formatCurrency(proposal.value)}
          </div>
        </div>
      )}

      {/* Contract Duration */}
      {proposal.contractDuration > 0 && (
        <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span className="text-xs">Contrato: {proposal.contractDuration} meses</span>
        </div>
      )}

      {/* Tags coloridas estilo Trello */}
      {proposal.tags.length > 0 && (
        <div className="flex gap-1 mb-2 flex-wrap">
          {proposal.tags.slice(0, 4).map((tag) => (
            <div
              key={tag.name}
              className="h-2 rounded-full min-w-[40px] flex-1 max-w-[60px]"
              style={{ backgroundColor: tag.color }}
              title={tag.name}
            />
          ))}
        </div>
      )}

      {/* Entry Timer */}
      {proposal.createdAt && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-2">
          <Clock className="w-3 h-3 shrink-0" />
          <span>{formatDistanceToNow(new Date(proposal.createdAt), { addSuffix: true, locale: ptBR })}</span>
        </div>
      )}

      {/* Meeting Date & Days Until */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {proposal.commitmentDate ? (
            <DaysUntilMeeting commitmentDate={proposal.commitmentDate} compact />
          ) : proposal.lastContact ? (
            <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
              <Calendar className="w-3 h-3 shrink-0" />
              <span className="text-xs truncate">{proposal.lastContact}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {formattedPhone && (
            <button
              onClick={(e) => openWhatsApp(proposal.phone, e)}
              className="p-1.5 rounded-md bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#25D366] transition-colors"
              title="Abrir WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5" />
            </button>
          )}
          {proposal.closer && (
            <div className="flex items-center gap-1.5 min-w-0">
              <User className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate max-w-[100px]" title={proposal.closer}>{proposal.closer}</span>
            </div>
          )}
        </div>
      </div>
      </div>
    </motion.div>
  );
});

export default function PipePropostas() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterResponsible, setFilterResponsible] = useState("all");
  const [filterProductType, setFilterProductType] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterCalor, setFilterCalor] = useState("all");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedProposta, setSelectedProposta] = useState<any>(null);
  const [viewMode, setViewMode] = useState<"kanban" | "analytics">("kanban");
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

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; pipeId: string; leadId: string } | null>(null);
  const [deleteAllLeadsDialogOpen, setDeleteAllLeadsDialogOpen] = useState(false);
  const [metricsPeriod, setMetricsPeriod] = useState<MetricsPeriod>("all");
  const now = new Date();
  const [selectedMetricsMonth, setSelectedMetricsMonth] = useState(now.getMonth() + 1);
  const [selectedMetricsYear, setSelectedMetricsYear] = useState(now.getFullYear());

  const { organizationId } = useOrganization();
  useEffect(() => { trackModuleVisit("pipe_propostas", organizationId); }, []);

  const { data: pipeData, isLoading, refetch } = usePipePropostas();
  const { data: pipelineStages = [] } = usePipelineStages("propostas");
  const { data: workflowCounts = {} } = useStageWorkflowCounts("propostas");
  const { data: teamMembers } = useTeamMembers();
  const updatePipeProposta = useUpdatePipeProposta();
  const { allowed: canMovePipe } = useCanPerformAction("move_pipe_record");
  const { data: tinyStatus } = useTinyErpStatus();
  const deletePipeProposta = useDeletePipeProposta();
  const deleteAllLeadsInPipe = useDeleteAllLeadsInPipe("propostas");
  const logAction = useLogLeadAction();
  const { allowed: canDeleteCards } = useFeaturePermission("pipeline.delete_cards");
  const { data: metricsByPeriod } = usePipePropostasMetrics(
    metricsPeriod,
    metricsPeriod === "month" ? selectedMetricsMonth : undefined,
    metricsPeriod === "month" ? selectedMetricsYear : undefined
  );

  const responsibleMembers = useResponsibleMembers();

  // Transform pipe data to ProposalCard format
  const transformToCard = (item: any): ProposalCard => {
    const lead = item.lead;
    const items = item.items || [];
    const hasItemsFromDb = items.length > 0;
    const hasMainProduct = !hasItemsFromDb && item.product_id && item.product;

    const itemsForCard = hasItemsFromDb
      ? items.map((i: any) => ({
          id: i.id,
          product_id: i.product_id,
          sale_value: i.sale_value,
          product: i.product ? {
            id: i.product.id,
            name: i.product.name,
            type: i.product.type,
          } : undefined,
        }))
      : hasMainProduct
        ? [{
            id: `main-${item.id}`,
            product_id: item.product_id,
            sale_value: item.sale_value,
            product: item.product ? {
              id: item.product.id,
              name: item.product.name,
              type: item.product.type,
            } : undefined,
          }]
        : [];

    const totalValue = itemsForCard.length > 0
      ? itemsForCard.reduce((sum: number, i: any) => sum + (i.sale_value || 0), 0)
      : (item.sale_value || 0);

    const productTypes = itemsForCard.length > 0
      ? [...new Set(itemsForCard.map((i: any) => i.product?.type).filter(Boolean))]
      : item.product_type ? [item.product_type] : [];

    return {
      id: item.id,
      name: lead?.name || "Sem nome",
      company: lead?.company || "",
      email: lead?.email,
      phone: lead?.phone,
      rating: lead?.rating || 0,
      calor: item.calor ?? 5,
      closer: item.closer?.name || lead?.closer?.name,  // displayed as "Resp" in card
      closerId: item.closer_id,
      productType: productTypes.length === 1 ? productTypes[0] : (productTypes.length > 0 ? null : item.product_type),
      value: totalValue,
      contractDuration: item.contract_duration || 0,
      tags: lead?.lead_tags?.map((lt: any) => ({ name: lt.tag?.name, color: lt.tag?.color || "#888" })).filter((t: any) => t.name) || [],
      lastContact: item.commitment_date 
        ? format(new Date(item.commitment_date), "dd/MM HH:mm", { locale: ptBR })
        : undefined,
      segment: lead?.segment,
      commitmentDate: item.commitment_date ? new Date(item.commitment_date) : undefined,
      leadId: lead?.id,
      items: itemsForCard,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
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
        { id: "esfriou", title: "Esfriou", color: "#64748B" },
        { id: "futuro", title: "Futuro", color: "#8B5CF6" },
        { id: "vendido", title: "Vendido ✓", color: "#22C55E" },
        { id: "perdido", title: "Perdido", color: "#EF4444" },
      ];
    }
    return stagesToColumns(pipelineStages);
  }, [pipelineStages]);

  // Organize data by status columns (recent first; compromisso_marcado by commitment date)
  const columns = useMemo((): KanbanColumn<ProposalCard>[] => {
    if (!pipeData) return statusColumns.map(col => ({ ...col, items: [] }));

    return statusColumns.map(col => {
      const columnItems = pipeData
        .filter(item => item.status === col.id)
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
          
          return matchesSearch && matchesResponsible && matchesType && matchesPriority && matchesCalor;
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
  }, [pipeData, searchTerm, filterResponsible, filterProductType, filterPriority, filterCalor]);

  // Calculate stats (Vendas Total / MRR Vendido / Projetos Vendidos por item quando houver items)
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

    const activeStatuses: PipePropostasStatus[] = ["marcar_compromisso", "compromisso_marcado", "esfriou", "futuro"];
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
          sold += val;
          const t = it.product?.type;
          if (t === "mrr") mrr += val;
          else if (t === "projeto") projeto += val;
        }
      } else {
        const val = Number(item.sale_value) || 0;
        sold += val;
        if (item.product_type === "mrr") mrr += val;
        else if (item.product_type === "projeto") projeto += val;
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

  // Exibir métricas: "Geral" = stats do pipe; "Este mês" = hook (vendidos no mês); pipeline ativo sempre do pipe atual
  const displayStats = useMemo(() => {
    if (metricsPeriod === "all" || !metricsByPeriod) {
      return stats;
    }
    return {
      ...metricsByPeriod,
      inProgress: stats.inProgress,
      inProgressCount: stats.inProgressCount,
    };
  }, [metricsPeriod, metricsByPeriod, stats]);

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
  }, [pipeData]);

  // Calor data for analytics
  const calorData = useMemo(() => {
    if (!pipeData) return [];

    const activeStatuses: PipePropostasStatus[] = ["marcar_compromisso", "compromisso_marcado", "esfriou", "futuro"];
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
      toast.error("Erro ao excluir");
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
    }

    await executeStatusChange(itemId, newStatus, item.lead_id, item.closer_id);
  };

  // Execute status change (called directly or after date/TinyERP modal)
  const executeStatusChange = async (
    itemId: string,
    newStatus: string,
    leadId: string,
    closerId: string | null,
    commitmentDate?: Date,
    skipAutoPush?: boolean
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
  const renderColumnFooter = (column: KanbanColumn<ProposalCard>) => (
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
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-7 h-7 text-primary" />
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-4"
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
          className="glass-card p-4"
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
          className="glass-card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">MRR Vendido</p>
            <ArrowUpRight className="w-4 h-4 text-chart-5" />
          </div>
          <p className="text-xl font-bold text-chart-5">{formatCurrency(displayStats.mrr)}</p>
          <p className="text-xs text-muted-foreground">valor vendido /mês</p>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card p-4"
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
          className="glass-card p-4"
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
                  <SelectItem value="mrr">MRR</SelectItem>
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
            </div>

            {/* Kanban Board with Drag-and-Drop */}
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
                  <StageWorkflowsBadgeWrapper pipeType="propostas" stageKey={col.id} stageName={col.title} counts={merged} />
                );
              }}
              renderCard={(card) => (
                <div onClick={() => {
                  const item = pipeData?.find(p => p.id === card.id);
                  if (item) {
                    setSelectedProposta(item);
                    setIsDetailModalOpen(true);
                  }
                }}>
                  <ProposalCardComponent
                    proposal={card}
                    onCalorChange={(calor) => handleCalorChange(card.id, calor)}
                    onDelete={canDeleteCards ? handleOpenDeleteDialog : undefined}
                  />
                </div>
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

      {/* Proposal Detail Modal */}
      {selectedProposta && (
        <ProposalDetailModal
          open={isDetailModalOpen}
          onOpenChange={setIsDetailModalOpen}
          proposta={selectedProposta}
          onSuccess={() => {
            refetch();
            setSelectedProposta(null);
          }}
        />
      )}

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

      {/* Commitment Date Modal */}
      <CommitmentDateModal
        open={isDateModalOpen}
        onOpenChange={setIsDateModalOpen}
        onConfirm={handleCommitmentDateConfirm}
        onCancel={handleCommitmentDateCancel}
        leadName={pendingStatusChange?.leadName || "Lead"}
      />

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

      {/* Delete ALL leads from THIS stage (Propostas) confirmation */}
      <AlertDialog open={deleteAllLeadsDialogOpen} onOpenChange={setDeleteAllLeadsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir todos os leads desta etapa</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação irá excluir todos os leads que estão no funil de Propostas e na base de dados (histórico, tags, etc.). Não afeta outros funis nem outras organizações. Não é possível desfazer.
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
