import { useNavigate } from "react-router-dom";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useUpsellCampanhas, useUpdateUpsellCampanha } from "@/modules/carteira/hooks/useUpsellCampanhas";
import { LeadCard } from "@/modules/leads";
import { NewOrderModal } from "@/modules/carteira/components/client/NewOrderModal";
import { useCreateAcaoDoDia } from "@/modules/engagement/hooks/useAcoesDoDia";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type CampanhaStatus = Database["public"]["Enums"]["upsell_campanha_status"];

interface UpsellCampanhasKanbanProps {
  searchQuery: string;
  filterStatus: string;
  filterResponsible: string;
}

const CAMPANHA_COLUMNS: { id: CampanhaStatus; title: string; color: string }[] = [
  { id: "cliente", title: "Cliente", color: "#6366f1" },
  { id: "planejado", title: "Planejado", color: "#3B82F6" },
  { id: "abordado", title: "Abordado", color: "#F59E0B" },
  { id: "interesse", title: "Interesse", color: "#22C55E" },
  { id: "proposta", title: "Proposta", color: "#8B5CF6" },
  { id: "vendido", title: "Vendido", color: "#10B981" },
  { id: "futuro", title: "Futuro", color: "#64748B" },
  { id: "perdido", title: "Perdido", color: "#EF4444" },
];

function UpsellCampanhasKanbanInner({ searchQuery, filterStatus, filterResponsible }: UpsellCampanhasKanbanProps) {
  const { data: campanhas = [] } = useUpsellCampanhas();
  const updateCampanha = useUpdateUpsellCampanha();
  const createAcaoDoDia = useCreateAcaoDoDia();
  const navigate = useNavigate();

  const [selectedCampanha, setSelectedCampanha] = useState<any>(null);
  const [quickSaleOpen, setQuickSaleOpen] = useState(false);
  const [quickSaleCampanha, setQuickSaleCampanha] = useState<{
    id: string;
    clientId: string;
    clientName: string;
  } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const syncingScroll = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setScrollWidth(el.scrollWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [campanhas]);

  const handleTopScroll = useCallback(() => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    if (scrollRef.current && topScrollRef.current) scrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    syncingScroll.current = false;
  }, []);

  const handleMainScroll = useCallback(() => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    if (topScrollRef.current && scrollRef.current) topScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
    syncingScroll.current = false;
  }, []);

  const filteredCampanhas = campanhas.filter((c) => {
    const client = c.client as any;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!(client?.name || "").toLowerCase().includes(q) &&
          !(client?.company || "").toLowerCase().includes(q)) return false;
    }
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (filterResponsible !== "all" && (c as any).responsible_id !== filterResponsible && c.closer_id !== filterResponsible) return false;
    return true;
  });

  const handleDragStart = (e: React.DragEvent, campanhaId: string) => {
    e.dataTransfer.setData("campanhaId", campanhaId);
  };

  const handleDrop = async (e: React.DragEvent, newStatus: CampanhaStatus) => {
    e.preventDefault();
    setDragOverCol(null);
    const campanhaId = e.dataTransfer.getData("campanhaId");
    if (!campanhaId) return;

    const campanha = campanhas.find((c) => c.id === campanhaId);
    if (!campanha || campanha.status === newStatus) return;

    if (newStatus === "vendido") {
      const client = campanha.client as any;
      setQuickSaleCampanha({
        id: campanha.id,
        clientId: campanha.client_id,
        clientName: client?.name || "Cliente",
      });
      setQuickSaleOpen(true);
      return;
    }

    const updates: any = { id: campanhaId, status: newStatus };

    if (campanha.status === "planejado" && newStatus !== "planejado" && !campanha.data_abordagem) {
      updates.data_abordagem = new Date().toISOString();
    }

    try {
      await updateCampanha.mutateAsync(updates);
    } catch {
      toast.error("Erro ao mover campanha");
    }
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setDragOverCol(colId);
  };

  const handleDragLeave = () => {
    setDragOverCol(null);
  };

  const handleQuickSaleComplete = async () => {
    if (!quickSaleCampanha) return;

    try {
      const updates: any = {
        id: quickSaleCampanha.id,
        status: "vendido" as CampanhaStatus,
        data_venda: new Date().toISOString(),
      };

      const campanha = campanhas.find((c) => c.id === quickSaleCampanha.id);
      if (campanha?.status === "planejado" && !campanha.data_abordagem) {
        updates.data_abordagem = new Date().toISOString();
      }

      await updateCampanha.mutateAsync(updates);
    } catch {
      toast.error("Erro ao atualizar campanha");
    }
  };

  return (
    <>
      {/* Top scrollbar */}
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="overflow-x-auto overflow-y-hidden"
        style={{ height: 12 }}
      >
        <div style={{ width: scrollWidth, height: 1 }} />
      </div>

      <div
        ref={scrollRef}
        onScroll={handleMainScroll}
        className="flex gap-4 overflow-x-auto overflow-y-hidden pb-4 max-h-[calc(100vh-220px)] scrollbar-hide" style={{ minHeight: "40vh" }}>
        {CAMPANHA_COLUMNS.map((col, colIndex) => {
          const colCampanhas = filteredCampanhas.filter((c) => c.status === col.id);
          const isDragOver = dragOverCol === col.id;

          return (
            <motion.div
              key={col.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: colIndex * 0.03, duration: 0.3 }}
              className={`flex-shrink-0 w-64 bg-muted/30 rounded-lg flex flex-col transition-all duration-200 ${
                isDragOver ? "ring-2 ring-primary/30 bg-primary/5" : ""
              }`}
              onDrop={(e) => handleDrop(e, col.id)}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
            >
              <div className="p-3 border-b border-border" style={{ borderTopColor: col.color, borderTopWidth: 3, borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
                <div className="flex justify-between items-center">
                  <h3 className="font-medium text-sm">{col.title}</h3>
                  <span className="text-xs font-medium bg-muted rounded-full px-2 py-0.5">{colCampanhas.length}</span>
                </div>
              </div>

              <div className="p-2 space-y-2 min-h-[100px] overflow-y-auto flex-1 min-h-0">
                {colCampanhas.map((campanha, i) => (
                  <motion.div
                    key={campanha.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    draggable
                    onDragStart={(e) => handleDragStart(e as any, campanha.id)}
                  >
                    <LeadCard
                      lead={{
                        id: campanha.id,
                        name: (campanha.client as any)?.name || "Cliente",
                        company: (campanha.client as any)?.company,
                        potencial: (campanha.client as any)?.potencial,
                        responsible: (campanha.closer as any)?.name,
                        value: Number(campanha.mrr_planejado || 0) + Number(campanha.projeto_planejado || 0),
                        valueLabel: `R$ ${(Number(campanha.mrr_planejado || 0) + Number(campanha.projeto_planejado || 0)).toLocaleString("pt-BR")}`,
                        date: campanha.data_abordagem ? new Date(campanha.data_abordagem) : null,
                        dateLabel: campanha.data_abordagem ? new Date(campanha.data_abordagem).toLocaleDateString("pt-BR") : undefined,
                        createdAt: campanha.created_at,
                        leadId: (campanha.client as any)?.lead_id,
                      }}
                      variant="upsell_campanha"
                      onClick={() => {
                        setSelectedCampanha(campanha);
                        const leadId = (campanha.client as any)?.lead_id;
                        if (leadId) navigate(`/leads?lead=${leadId}`);
                      }}
                      onQuickAction={(title) => {
                        createAcaoDoDia.mutate({ title, lead_id: (campanha.client as any)?.lead_id || undefined });
                      }}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>

      {quickSaleCampanha && (
        <NewOrderModal
          open={quickSaleOpen}
          onOpenChange={(open) => {
            setQuickSaleOpen(open);
            if (!open) setQuickSaleCampanha(null);
          }}
          clientId={quickSaleCampanha.clientId}
          clientName={quickSaleCampanha.clientName}
          campanhaId={quickSaleCampanha.id}
          onComplete={handleQuickSaleComplete}
        />
      )}
    </>
  );
}

export function UpsellCampanhasKanban(props: UpsellCampanhasKanbanProps) {
  return (
        <UpsellCampanhasKanbanInner {...props} />
  );
}
