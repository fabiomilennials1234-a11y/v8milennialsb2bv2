import { useState } from "react";
import { motion } from "framer-motion";
import { useUpsellCampanhas, useUpdateUpsellCampanha } from "@/hooks/useUpsellCampanhas";
import { UpsellCampanhaCard } from "./UpsellCampanhaCard";
import { QuickSaleModal } from "./QuickSaleModal";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type CampanhaStatus = Database["public"]["Enums"]["upsell_campanha_status"];

interface UpsellCampanhasKanbanProps {
  searchQuery: string;
  filterStatus: string;
  filterCloser: string;
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

export function UpsellCampanhasKanban({ searchQuery, filterStatus, filterCloser }: UpsellCampanhasKanbanProps) {
  const { data: campanhas = [] } = useUpsellCampanhas();
  const updateCampanha = useUpdateUpsellCampanha();

  const [quickSaleOpen, setQuickSaleOpen] = useState(false);
  const [quickSaleCampanha, setQuickSaleCampanha] = useState<{
    id: string;
    clientId: string;
    clientName: string;
  } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const filteredCampanhas = campanhas.filter((c) => {
    const client = c.client as any;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!(client?.name || "").toLowerCase().includes(q) &&
          !(client?.company || "").toLowerCase().includes(q)) return false;
    }
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (filterCloser !== "all" && c.closer_id !== filterCloser) return false;
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
      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: "60vh" }}>
        {CAMPANHA_COLUMNS.map((col, colIndex) => {
          const colCampanhas = filteredCampanhas.filter((c) => c.status === col.id);
          const isDragOver = dragOverCol === col.id;

          return (
            <motion.div
              key={col.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: colIndex * 0.03, duration: 0.3 }}
              className={`flex-shrink-0 w-64 bg-muted/30 rounded-lg transition-all duration-200 ${
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

              <div className="p-2 space-y-2 min-h-[200px]">
                {colCampanhas.map((campanha, i) => (
                  <motion.div
                    key={campanha.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    draggable
                    onDragStart={(e) => handleDragStart(e as any, campanha.id)}
                  >
                    <UpsellCampanhaCard campanha={campanha} />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>

      {quickSaleCampanha && (
        <QuickSaleModal
          open={quickSaleOpen}
          onOpenChange={(open) => {
            setQuickSaleOpen(open);
            if (!open) setQuickSaleCampanha(null);
          }}
          clientId={quickSaleCampanha.clientId}
          clientName={quickSaleCampanha.clientName}
          campanhaId={quickSaleCampanha.id}
          onSaleComplete={handleQuickSaleComplete}
        />
      )}
    </>
  );
}
