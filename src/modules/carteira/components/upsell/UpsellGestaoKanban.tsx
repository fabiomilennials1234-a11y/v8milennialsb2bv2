import { useNavigate } from "react-router-dom";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Settings, Plus, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stagesToColumns, type PipelineStage } from "@/modules/pipelines";
import { useCarteiraStages } from "@/modules/carteira/hooks/useCarteiraStages";
import { useUpsellClients, useUpdateUpsellClient } from "@/modules/carteira/hooks/useUpsellClients";
import { useUpsellOrders } from "@/modules/carteira/hooks/useUpsellOrders";
import { LeadCard, type LeadCardData } from "@/modules/leads";
import { NewOrderModal } from "@/modules/carteira/components/client/NewOrderModal";
import { PipeSettingsDialog } from "@/modules/pipelines";
import { ImportUpsellClientsContent } from "./ImportUpsellClientsContent";
import { useIdentity } from "@/modules/identity";
import { useCreateAcaoDoDia } from "@/modules/engagement/hooks/useAcoesDoDia";
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

function UpsellGestaoKanbanInner({ searchQuery, filterPotencial }: UpsellGestaoKanbanProps) {
  const { data: stages = [] } = useCarteiraStages("upsell_gestao");
  const { data: clients = [] } = useUpsellClients();
  const { data: orders = [] } = useUpsellOrders();
  const updateClient = useUpdateUpsellClient();
  const createAcaoDoDia = useCreateAcaoDoDia();
  const { isAdmin } = useIdentity();
  const navigate = useNavigate();

  const [quickSaleClientId, setQuickSaleClientId] = useState<string>();
  const [quickSaleClientName, setQuickSaleClientName] = useState("");
  const [quickSaleOpen, setQuickSaleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  }, [stages, clients]);

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

  const openDetail = (client: any) => {
    const leadId = (client as any).lead_id || client?.lead?.id;
    if (leadId) navigate(`/leads?lead=${leadId}`);
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
              className={`kanban-column min-w-[320px] max-w-[360px] flex-shrink-0 flex flex-col transition-all duration-200 ${
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
              <div className="space-y-3 min-h-[100px] overflow-y-auto flex-1 min-h-0">
                {colClients.map((client, i) => (
                  <motion.div
                    key={client.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    draggable
                    onDragStart={(e) => handleDragStart(e as any, client.id)}
                  >
                    <LeadCard
                      lead={{
                        id: client.id,
                        name: client.name,
                        erpCode: client.external_id,
                        company: client.company,
                        phone: client.phone,
                        value: vendasPorCliente[client.id] || 0,
                        valueLabel: formatCurrency(vendasPorCliente[client.id] || 0),
                        responsible: (client.closer as any)?.name,
                        potencial: client.potencial,
                        isInactive: !client.is_active,
                        createdAt: client.created_at,
                        leadId: (client as any).lead_id,
                      }}
                      variant="upsell_client"
                      onClick={() => openDetail(client)}
                      onQuickAction={(title) => {
                        createAcaoDoDia.mutate({ title, lead_id: (client as any).lead_id || undefined });
                      }}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>

      {quickSaleClientId && (
        <NewOrderModal
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
          upsellImportSlot={<ImportUpsellClientsContent pipeType="upsell_gestao" />}
        />
      )}
    </>
  );
}

export function UpsellGestaoKanban(props: UpsellGestaoKanbanProps) {
  return (
        <UpsellGestaoKanbanInner {...props} />
  );
}
