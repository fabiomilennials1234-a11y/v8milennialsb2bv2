import { useState } from "react";
import { motion } from "framer-motion";
import { Settings, Plus, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePipelineStages, stagesToColumns, type PipelineStage } from "@/hooks/usePipelineStages";
import { useUpsellClients, useUpdateUpsellClient } from "@/hooks/useUpsellClients";
import { useUpsellOrders } from "@/hooks/useUpsellOrders";
import { UpsellClientCard } from "./UpsellClientCard";
import { ClientDetailModal } from "./ClientDetailModal";
import { QuickSaleModal } from "./QuickSaleModal";
import { PipeSettingsDialog } from "@/components/pipelines/PipeSettingsDialog";
import { useIsAdmin } from "@/hooks/useUserRole";
import { toast } from "sonner";

interface UpsellGestaoKanbanProps {
  searchQuery: string;
  filterPotencial: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function UpsellGestaoKanban({ searchQuery, filterPotencial }: UpsellGestaoKanbanProps) {
  const { data: stages = [] } = usePipelineStages("upsell_gestao");
  const { data: clients = [] } = useUpsellClients();
  const { data: orders = [] } = useUpsellOrders();
  const updateClient = useUpdateUpsellClient();
  const isAdmin = useIsAdmin();

  const [detailClientId, setDetailClientId] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [quickSaleClientId, setQuickSaleClientId] = useState<string>();
  const [quickSaleClientName, setQuickSaleClientName] = useState("");
  const [quickSaleOpen, setQuickSaleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const columns = stagesToColumns(stages);

  const vendasPorCliente: Record<string, number> = {};
  for (const order of orders) {
    vendasPorCliente[order.client_id] = (vendasPorCliente[order.client_id] || 0) + Number(order.sale_value || 0);
  }

  const filteredClients = clients.filter((c) => {
    if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(c.company || "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterPotencial !== "all" && c.potencial !== filterPotencial) return false;
    return true;
  });

  const handleDragStart = (e: React.DragEvent, clientId: string) => {
    e.dataTransfer.setData("clientId", clientId);
  };

  const handleDrop = async (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const clientId = e.dataTransfer.getData("clientId");
    if (!clientId) return;

    try {
      await updateClient.mutateAsync({ id: clientId, gestao_stage: stageKey, gestao_manual_override: true });
    } catch {
      toast.error("Erro ao mover cliente");
    }
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setDragOverCol(colId);
  };

  const handleDragLeave = () => {
    setDragOverCol(null);
  };

  const openDetail = (clientId: string) => {
    setDetailClientId(clientId);
    setDetailOpen(true);
  };

  const openQuickSale = (clientId: string, clientName: string) => {
    setQuickSaleClientId(clientId);
    setQuickSaleClientName(clientName);
    setQuickSaleOpen(true);
  };

  return (
    <>
      {isAdmin && (
        <div className="flex justify-end mb-2">
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)} className="gap-1.5 text-xs text-muted-foreground">
            <Settings className="h-4 w-4" />
            Configurar Etapas
          </Button>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: "60vh" }}>
        {columns.map((col, colIndex) => {
          const colClients = filteredClients.filter((c) => c.gestao_stage === col.id);
          const colVendas = colClients
            .filter((c) => c.is_active)
            .reduce((sum, c) => sum + (vendasPorCliente[c.id] || 0), 0);
          const isDragOver = dragOverCol === col.id;

          return (
            <motion.div
              key={col.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: colIndex * 0.03, duration: 0.3 }}
              className={`kanban-column min-w-[320px] max-w-[360px] flex-shrink-0 transition-all duration-200 ${
                isDragOver ? "ring-2 ring-primary/50 bg-primary/5" : ""
              }`}
              onDrop={(e) => handleDrop(e, col.id)}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
            >
              {/* Column header — same pattern as Propostas */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: col.color }}
                  />
                  <h3 className="font-semibold text-sm">{col.title}</h3>
                  <span className="bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full">
                    {colClients.length}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button className="p-1.5 rounded-lg hover:bg-background transition-colors">
                    <Plus className="w-4 h-4 text-muted-foreground" />
                  </button>
                  <button className="p-1.5 rounded-lg hover:bg-background transition-colors">
                    <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
              </div>

              {/* Column footer — Total */}
              <div className="mb-3 p-2 rounded-lg bg-background/50">
                <p className="text-xs text-muted-foreground">
                  Total:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(colVendas)}
                  </span>
                </p>
              </div>

              {/* Cards */}
              <div className="space-y-3 min-h-[100px]">
                {colClients.map((client, i) => (
                  <motion.div
                    key={client.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    draggable
                    onDragStart={(e) => handleDragStart(e as any, client.id)}
                  >
                    <UpsellClientCard
                      client={client}
                      totalVendas={vendasPorCliente[client.id] || 0}
                      onClick={() => openDetail(client.id)}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>

      <ClientDetailModal
        open={detailOpen}
        onOpenChange={setDetailOpen}
        clientId={detailClientId}
        onQuickSale={() => {
          if (detailClientId) {
            const client = clients.find((c) => c.id === detailClientId);
            if (client) {
              setDetailOpen(false);
              openQuickSale(client.id, client.name);
            }
          }
        }}
      />

      {quickSaleClientId && (
        <QuickSaleModal
          open={quickSaleOpen}
          onOpenChange={setQuickSaleOpen}
          clientId={quickSaleClientId}
          clientName={quickSaleClientName}
        />
      )}

      {isAdmin && (
        <PipeSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeType="upsell_gestao"
          stages={stages as PipelineStage[]}
        />
      )}
    </>
  );
}
