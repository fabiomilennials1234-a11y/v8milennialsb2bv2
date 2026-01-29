import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, Filter, Plus, Calendar, User, Building2, Star, 
  DollarSign, Clock, Tag, Loader2, TrendingUp, Package,
  ArrowUpRight, Percent, BarChart3, Target, Flame, MessageCircle, Settings2
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
import { DraggableKanbanBoard, DraggableItem, KanbanColumn } from "@/components/kanban/DraggableKanbanBoard";
import { usePipePropostas, useUpdatePipeProposta, PipePropostasStatus } from "@/hooks/usePipePropostas";
import { usePipelineStages, stagesToColumns } from "@/hooks/usePipelineStages";
import { ManagePipelineStagesModal } from "@/components/pipelines/ManagePipelineStagesModal";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { CreateProposalModal } from "@/components/proposals/CreateProposalModal";
import { ProposalDetailModal } from "@/components/proposals/ProposalDetailModal";
import { FunnelChart } from "@/components/dashboard/FunnelChart";
import { CalorSlider, CalorBadge } from "@/components/proposals/CalorSlider";
import { QuickAddDailyAction } from "@/components/proposals/QuickAddDailyAction";
import { CommitmentDateModal } from "@/components/proposals/CommitmentDateModal";
import { DaysUntilMeeting } from "@/components/proposals/DaysUntilMeeting";
import { CalorAnalyticsChart } from "@/components/proposals/CalorAnalyticsChart";
import { ProductAnalyticsChart } from "@/components/proposals/ProductAnalyticsChart";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  tags: string[];
  lastContact?: string;
  segment?: string;
  commitmentDate?: Date;
  leadId?: string;
  items: ProposalItem[];
}

import { openWhatsApp, formatPhoneForWhatsApp } from "@/lib/whatsapp";

function ProposalCardComponent({ 
  proposal, 
  onCalorChange 
}: { 
  proposal: ProposalCard; 
  onCalorChange: (calor: number) => void;
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
      className="kanban-card group cursor-pointer"
    >
      {/* Quick Actions Row */}
      <div className="flex items-center justify-between mb-2">
        <CalorSlider 
          value={proposal.calor} 
          onChange={onCalorChange}
        />
        <QuickAddDailyAction 
          propostaId={proposal.id} 
          leadName={proposal.name}
        />
      </div>

      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
            {proposal.name}
          </h4>
          <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
            <Building2 className="w-3 h-3" />
            <span className="text-xs truncate">{proposal.company || "Sem empresa"}</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5 ml-2">
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

      {/* Product Items - Show each product with type badge and value */}
      {proposal.items.length > 0 ? (
        <div className="space-y-1.5 mb-3">
          {proposal.items.slice(0, 3).map((item) => (
            <div 
              key={item.id} 
              className="flex items-center justify-between gap-2 p-1.5 rounded bg-muted/50"
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
                <span className="text-xs truncate">{item.product?.name || "Produto"}</span>
              </div>
              <span className="text-xs font-medium text-success shrink-0">
                {formatCurrency(item.sale_value || 0)}
              </span>
            </div>
          ))}
          {proposal.items.length > 3 && (
            <p className="text-[10px] text-muted-foreground text-center">
              +{proposal.items.length - 3} produto(s)
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
        <div className="flex items-center justify-between mb-3 pt-2 border-t border-border/50">
          <span className="text-xs text-muted-foreground">Total:</span>
          <div className="flex items-center gap-1 text-success font-semibold text-sm">
            <DollarSign className="w-3.5 h-3.5" />
            {formatCurrency(proposal.value)}
          </div>
        </div>
      )}

      {/* Contract Duration */}
      {proposal.contractDuration > 0 && (
        <div className="flex items-center gap-1.5 text-muted-foreground mb-3">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-xs">Contrato: {proposal.contractDuration} meses</span>
        </div>
      )}

      {/* Tags */}
      {proposal.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {proposal.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
          {proposal.tags.length > 2 && (
            <Badge variant="secondary" className="text-xs">
              +{proposal.tags.length - 2}
            </Badge>
          )}
        </div>
      )}

      {/* Meeting Date & Days Until */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div className="flex items-center gap-2">
          {proposal.commitmentDate ? (
            <DaysUntilMeeting commitmentDate={proposal.commitmentDate} compact />
          ) : proposal.lastContact ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="w-3 h-3" />
              <span className="text-xs">{proposal.lastContact}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
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
            <div className="flex items-center gap-1.5">
              <User className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{proposal.closer}</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function PipePropostas() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCloser, setFilterCloser] = useState("all");
  const [filterProductType, setFilterProductType] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterCalor, setFilterCalor] = useState("all");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isStagesModalOpen, setIsStagesModalOpen] = useState(false);
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

  const { data: pipeData, isLoading, refetch } = usePipePropostas();
  const { data: pipelineStages = [] } = usePipelineStages("propostas");
  const { data: teamMembers } = useTeamMembers();
  const updatePipeProposta = useUpdatePipeProposta();

  const closers = useMemo(() => {
    return teamMembers?.filter(m => m.role === "closer" && m.is_active) || [];
  }, [teamMembers]);

  // Transform pipe data to ProposalCard format
  const transformToCard = (item: any): ProposalCard => {
    const lead = item.lead;
    const items = item.items || [];
    
    // Calculate total value from items, fallback to sale_value for backwards compatibility
    const totalValue = items.length > 0 
      ? items.reduce((sum: number, i: any) => sum + (i.sale_value || 0), 0)
      : (item.sale_value || 0);
    
    // Determine product types from items
    const hasItems = items.length > 0;
    const productTypes = hasItems 
      ? [...new Set(items.map((i: any) => i.product?.type).filter(Boolean))]
      : item.product_type ? [item.product_type] : [];
    
    return {
      id: item.id,
      name: lead?.name || "Sem nome",
      company: lead?.company || "",
      email: lead?.email,
      phone: lead?.phone,
      rating: lead?.rating || 0,
      calor: item.calor ?? 5,
      closer: item.closer?.name || lead?.closer?.name,
      closerId: item.closer_id,
      productType: productTypes.length === 1 ? productTypes[0] : (productTypes.length > 0 ? null : item.product_type),
      value: totalValue,
      contractDuration: item.contract_duration || 0,
      tags: lead?.lead_tags?.map((lt: any) => lt.tag?.name).filter(Boolean) || [],
      lastContact: item.commitment_date 
        ? format(new Date(item.commitment_date), "dd/MM HH:mm", { locale: ptBR })
        : undefined,
      segment: lead?.segment,
      commitmentDate: item.commitment_date ? new Date(item.commitment_date) : undefined,
      leadId: lead?.id,
      items: items.map((i: any) => ({
        id: i.id,
        product_id: i.product_id,
        sale_value: i.sale_value,
        product: i.product ? {
          id: i.product.id,
          name: i.product.name,
          type: i.product.type,
        } : undefined,
      })),
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

  // Organize data by status columns with calor sorting
  const columns = useMemo((): KanbanColumn<ProposalCard>[] => {
    if (!pipeData) return statusColumns.map(col => ({ ...col, items: [] }));

    return statusColumns.map(col => {
      const columnItems = pipeData
        .filter(item => item.status === col.id)
        .filter(item => {
          const lead = item.lead;
          
          // Search filter
          const matchesSearch = searchTerm === "" || 
            lead?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            lead?.company?.toLowerCase().includes(searchTerm.toLowerCase());
          
          // Closer filter
          const matchesCloser = filterCloser === "all" || item.closer_id === filterCloser;
          
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
          
          return matchesSearch && matchesCloser && matchesType && matchesPriority && matchesCalor;
        })
        .map(transformToCard)
        // Sort: compromisso_marcado by commitment date (closest first), others by calor
        .sort((a, b) => {
          if (col.id === "compromisso_marcado") {
            // Sort by commitment date - closest meetings first
            const dateA = a.commitmentDate ? a.commitmentDate.getTime() : Infinity;
            const dateB = b.commitmentDate ? b.commitmentDate.getTime() : Infinity;
            return dateA - dateB;
          }
          // Default: sort by calor (highest first)
          return b.calor - a.calor;
        });
      return {
        ...col,
        items: columnItems,
      };
    });
  }, [pipeData, searchTerm, filterCloser, filterProductType, filterPriority, filterCalor]);

  // Calculate stats
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
    const lostData = pipeData.filter(item => item.status === "perdido");

    const total = pipeData.reduce((sum, item) => sum + (item.sale_value || 0), 0);
    const sold = soldData.reduce((sum, item) => sum + (item.sale_value || 0), 0);
    const inProgress = inProgressData.reduce((sum, item) => sum + (item.sale_value || 0), 0);
    
    const mrr = pipeData
      .filter(item => item.product_type === "mrr" && activeStatuses.includes(item.status))
      .reduce((sum, item) => sum + (item.sale_value || 0), 0);
    
    const projeto = pipeData
      .filter(item => item.product_type === "projeto" && activeStatuses.includes(item.status))
      .reduce((sum, item) => sum + (item.sale_value || 0), 0);

    const closedCount = soldData.length + lostData.length;
    const conversionRate = closedCount > 0 ? (soldData.length / closedCount) * 100 : 0;

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

  // Handle status change from drag-and-drop
  const handleStatusChange = async (itemId: string, newStatus: string) => {
    const item = pipeData?.find(p => p.id === itemId);
    if (!item) return;

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

    await executeStatusChange(itemId, newStatus, item.lead_id, item.closer_id);
  };

  // Execute status change (called directly or after date modal)
  const executeStatusChange = async (
    itemId: string, 
    newStatus: string, 
    leadId: string, 
    closerId: string | null,
    commitmentDate?: Date
  ) => {
    try {
      const updates: any = { 
        id: itemId, 
        status: newStatus as PipePropostasStatus,
        leadId,
        closerId,
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
          <Button variant="outline" className="gap-2" onClick={() => setIsStagesModalOpen(true)}>
            <Settings2 className="w-4 h-4" />
            Etapas
          </Button>
          <Button className="gap-2" onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4" />
            Nova Proposta
          </Button>
        </div>
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
          <p className="text-xl font-bold">{formatCurrency(stats.inProgress)}</p>
          <p className="text-xs text-muted-foreground">{stats.inProgressCount} propostas</p>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Vendido</p>
            <TrendingUp className="w-4 h-4 text-success" />
          </div>
          <p className="text-xl font-bold text-success">{formatCurrency(stats.sold)}</p>
          <p className="text-xs text-muted-foreground">{stats.soldCount} vendas</p>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">MRR Potencial</p>
            <ArrowUpRight className="w-4 h-4 text-chart-5" />
          </div>
          <p className="text-xl font-bold text-chart-5">{formatCurrency(stats.mrr)}</p>
          <p className="text-xs text-muted-foreground">/mês</p>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground">Projetos</p>
            <Package className="w-4 h-4 text-primary" />
          </div>
          <p className="text-xl font-bold text-primary">{formatCurrency(stats.projeto)}</p>
          <p className="text-xs text-muted-foreground">valor total</p>
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
          <p className="text-xl font-bold">{stats.conversionRate.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">vendas/fechadas</p>
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
              <Select value={filterCloser} onValueChange={setFilterCloser}>
                <SelectTrigger className="w-[160px]">
                  <User className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Closer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Closers</SelectItem>
                  {closers.map(closer => (
                    <SelectItem key={closer.id} value={closer.id}>{closer.name}</SelectItem>
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

                  {/* By Closer */}
                  <div className="glass-card p-6">
                    <h3 className="font-semibold mb-6 flex items-center gap-2">
                      <User className="w-5 h-5 text-primary" />
                      Performance por Closer
                    </h3>
                    <div className="space-y-4">
                      {closers.map(closer => {
                        const closerProposals = pipeData?.filter(p => p.closer_id === closer.id) || [];
                        const closerValue = closerProposals.reduce((sum, p) => sum + (p.sale_value || 0), 0);
                        const closerSold = closerProposals.filter(p => p.status === "vendido");
                        const closerSoldValue = closerSold.reduce((sum, p) => sum + (p.sale_value || 0), 0);

                        return (
                          <div key={closer.id} className="flex items-center justify-between p-3 rounded-lg border">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <User className="w-5 h-5 text-primary" />
                              </div>
                              <div>
                                <p className="font-medium">{closer.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {closerProposals.length} propostas
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-success">{formatCurrency(closerSoldValue)}</p>
                              <p className="text-xs text-muted-foreground">
                                {closerSold.length} vendas
                              </p>
                            </div>
                          </div>
                        );
                      })}

                      {closers.length === 0 && (
                        <p className="text-center text-muted-foreground py-4">
                          Nenhum closer cadastrado
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
                                  {sale.lead?.company} • {sale.closer?.name}
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

      {/* Commitment Date Modal */}
      <CommitmentDateModal
        open={isDateModalOpen}
        onOpenChange={setIsDateModalOpen}
        onConfirm={handleCommitmentDateConfirm}
        onCancel={handleCommitmentDateCancel}
        leadName={pendingStatusChange?.leadName || "Lead"}
      />

      {/* Manage Stages Modal */}
      <ManagePipelineStagesModal
        open={isStagesModalOpen}
        onOpenChange={setIsStagesModalOpen}
        pipelineType="propostas"
        stages={pipelineStages}
      />
    </div>
  );
}
