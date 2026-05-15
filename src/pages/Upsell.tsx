import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Search, LayoutGrid, List, TrendingUp, ShoppingCart, Upload, BarChart3, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { UpsellStats } from "@/components/upsell/UpsellStats";
import { UpsellBaseKanban } from "@/components/upsell/UpsellBaseKanban";
import { UpsellBaseList } from "@/components/upsell/UpsellBaseList";
import { UpsellGestaoKanban } from "@/components/upsell/UpsellGestaoKanban";
import { CreateClientModal } from "@/components/upsell/CreateClientModal";
import { NovaVendaModal } from "@/components/upsell/NovaVendaModal";
import { PipeSettingsDialog } from "@/components/pipelines/PipeSettingsDialog";
import { usePipelineStages, type PipelineType } from "@/hooks/usePipelineStages";
import { useAutoMoveUpsellClients } from "@/hooks/useAutoMoveUpsellClients";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { usePortfolioKPIs } from "@/hooks/usePortfolioKPIs";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { CarteiraKPIs } from "@/components/carteira/CarteiraKPIs";
import { CarteiraAlertBanner } from "@/components/carteira/CarteiraAlertBanner";
import { CarteiraClientTable, type PortfolioClientRow } from "@/components/carteira/CarteiraClientTable";
import { CarteiraClientPreview } from "@/components/carteira/CarteiraClientPreview";
import { CarteiraBulkBar } from "@/components/carteira/CarteiraBulkBar";
import { CarteiraRevenueAtRisk } from "@/components/carteira/CarteiraRevenueAtRisk";
import { CarteiraCohortHeatmap } from "@/components/carteira/CarteiraCohortHeatmap";
import { CarteiraVendedorRanking } from "@/components/carteira/CarteiraVendedorRanking";
import { useBulkSelection } from "@/hooks/useBulkSelection";

type ViewMode = "kanban" | "list";

const PORTFOLIO_TABS = [
  { value: "all", label: "Todos" },
  { value: "expected", label: "Pedido previsto" },
  { value: "overdue", label: "Recompra atrasada", isRisk: true },
  { value: "ouro", label: "Ouro" },
  { value: "prata", label: "Prata" },
  { value: "novo", label: "Novos" },
  { value: "resgate", label: "Resgate" },
  { value: "dormindo", label: "Dormindo" },
] as const;

export default function Upsell() {
  // Auto-move clients based on stage rules
  useAutoMoveUpsellClients();

  // Feature flag
  const { hasFeature } = useOrgFeatures();
  const isPortfolio = hasFeature("customer_portfolio");
  const navigate = useNavigate();

  // Base de Clientes state
  const [baseSearch, setBaseSearch] = useState("");
  const [basePotencial, setBasePotencial] = useState("all");
  const [baseActive, setBaseActive] = useState("all");
  const [baseView, setBaseView] = useState<ViewMode>("kanban");
  const [createClientOpen, setCreateClientOpen] = useState(false);

  // Gestão state
  const [gestaoSearch, setGestaoSearch] = useState("");
  const [gestaoPotencial, setGestaoPotencial] = useState("all");
  const [novaVendaOpen, setNovaVendaOpen] = useState(false);

  // Tab + Import dialog
  const [activeTab, setActiveTab] = useState<"base" | "gestao">("base");
  const [importOpen, setImportOpen] = useState(false);
  const importPipeType: PipelineType = activeTab === "gestao" ? "upsell_gestao" : "upsell_base";
  const { data: importStages = [] } = usePipelineStages(importPipeType);

  // Portfolio (carteira) state — only used when isPortfolio
  const [selectedClient, setSelectedClient] = useState<PortfolioClientRow | null>(null);
  const [carteiraSearch, setCarteiraSearch] = useState("");
  const [carteiraFilter, setCarteiraFilter] = useState("all");
  const [quickOrderClientId, setQuickOrderClientId] = useState<string | null>(null);
  const [currentRows, setCurrentRows] = useState<PortfolioClientRow[]>([]);
  const [carteiraView, setCarteiraView] = useState<"clientes" | "analytics">("clientes");
  const bulk = useBulkSelection();
  const { data: kpiData } = usePortfolioKPIs();

  useRealtimeSubscription("upsell_clients", ["portfolio-clients", "portfolio-kpis"]);
  useRealtimeSubscription("upsell_orders", ["portfolio-clients", "portfolio-kpis"]);

  const tabCounts = useMemo(() => {
    if (!kpiData) return {} as Record<string, number>;
    return {
      all: kpiData.total_clients,
      overdue: kpiData.overdue_count,
      expected: kpiData.expected_this_week,
      ...kpiData.segment_counts,
    };
  }, [kpiData]);

  // ─── Portfolio layout ──────────────────────────────────────────────────────
  if (isPortfolio) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#27272a]">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Carteira de Clientes
            </h1>
            <p className="text-sm text-[#a1a1aa] mt-0.5">
              {kpiData
                ? `${kpiData.total_clients} clientes ativos · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(kpiData.total_recurring)}/mês recorrente`
                : "Health score, recompra e gestão de carteira"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setImportOpen(true)} variant="outline" className="gap-2">
              <Upload className="w-4 h-4" />
              Importar Planilha
            </Button>
            <Button
              onClick={() => {
                setQuickOrderClientId(null);
                setNovaVendaOpen(true);
              }}
              variant="outline"
              className="gap-2"
            >
              <ShoppingCart className="w-4 h-4" />
              Nova Venda
            </Button>
            <Button onClick={() => setCreateClientOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Novo Cliente
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <CarteiraKPIs />

        {/* Alert banner */}
        <CarteiraAlertBanner onViewDetails={() => setCarteiraFilter("overdue")} />

        {/* Tabs */}
        <div className="flex gap-0 border-b border-[#27272a] overflow-x-auto">
          {PORTFOLIO_TABS.map((tab) => {
            const count = tabCounts[tab.value] ?? 0;
            const active = carteiraFilter === tab.value;
            const isRisk = "isRisk" in tab && tab.isRisk;
            return (
              <button
                key={tab.value}
                onClick={() => {
                  setCarteiraFilter(tab.value);
                  setSelectedClient(null);
                }}
                className={cn(
                  "px-5 py-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap",
                  active
                    ? "text-[#fafafa] border-b-[#eab308]"
                    : "text-[#71717a] border-b-transparent hover:text-[#a1a1aa]",
                )}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className={cn(
                      "ml-1.5 text-[11px] px-1.5 py-px rounded-full inline-block",
                      active && !isRisk && "bg-[#422006] text-[#eab308]",
                      active && isRisk && "bg-[#450a0a] text-[#ef4444]",
                      !active && !isRisk && "bg-[#27272a] text-[#a1a1aa]",
                      !active && isRisk && "bg-[#450a0a] text-[#ef4444]",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search + View toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#52525b]" />
            <Input
              placeholder="Buscar cliente, empresa…"
              value={carteiraSearch}
              onChange={(e) => setCarteiraSearch(e.target.value)}
              className="pl-9 bg-[#18181b] border-[#27272a] text-[13px]"
            />
          </div>
          <div className="flex border border-[#27272a] rounded-md ml-auto">
            <button
              onClick={() => setCarteiraView("clientes")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-l-md transition-colors",
                carteiraView === "clientes"
                  ? "bg-[#27272a] text-[#fafafa]"
                  : "text-[#71717a] hover:text-[#a1a1aa]",
              )}
            >
              <Users className="w-3.5 h-3.5" />
              Clientes
            </button>
            <button
              onClick={() => setCarteiraView("analytics")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-r-md transition-colors",
                carteiraView === "analytics"
                  ? "bg-[#27272a] text-[#fafafa]"
                  : "text-[#71717a] hover:text-[#a1a1aa]",
              )}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Analytics
            </button>
          </div>
        </div>

        {carteiraView === "clientes" ? (
          <>
            {/* Main content: table + optional sidebar */}
            <div className="flex gap-4 items-start">
              <div className="flex-1 min-w-0">
                <CarteiraClientTable
                  selectedClientId={selectedClient?.id ?? null}
                  onSelectClient={(client) => setSelectedClient(client)}
                  onWhatsApp={(client) => {
                    if (client.lead_id) {
                      navigate(`/chat?lead=${client.lead_id}`);
                    } else if (client.phone) {
                      window.open(
                        `https://wa.me/${client.phone.replace(/\D/g, "")}`,
                        "_blank",
                      );
                    }
                  }}
                  onNewOrder={(id) => {
                    setQuickOrderClientId(id);
                    setNovaVendaOpen(true);
                  }}
                  onViewDetail={(id) => navigate(`/carteira/${id}`)}
                  searchQuery={carteiraSearch}
                  filter={carteiraFilter}
                  bulk={bulk}
                  onRowsChange={setCurrentRows}
                />
              </div>

              {selectedClient && (
                <CarteiraClientPreview
                  client={selectedClient}
                  onClose={() => setSelectedClient(null)}
                  onViewDetail={(id) => navigate(`/carteira/${id}`)}
                  onNewOrder={(id) => {
                    setQuickOrderClientId(id);
                    setNovaVendaOpen(true);
                  }}
                />
              )}
            </div>

            {/* Bulk action bar */}
            <CarteiraBulkBar
              selectedClients={currentRows.filter((r) => bulk.isSelected(r.id))}
              onClear={bulk.clearSelection}
            />
          </>
        ) : (
          <div className="space-y-6">
            <CarteiraRevenueAtRisk />
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
              <CarteiraCohortHeatmap />
              <CarteiraVendedorRanking />
            </div>
          </div>
        )}

        {/* Shared modals */}
        <CreateClientModal open={createClientOpen} onOpenChange={setCreateClientOpen} />
        <NovaVendaModal open={novaVendaOpen} onOpenChange={setNovaVendaOpen} />
        <PipeSettingsDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          pipeType={importPipeType}
          stages={importStages}
          defaultTab="importar"
        />
      </div>
    );
  }

  // ─── Original Upsell layout (unchanged) ───────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-primary" />
            Carteira de Clientes Ativos
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie sua carteira de clientes e classifique por perfil
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setImportOpen(true)} variant="outline" className="gap-2">
            <Upload className="w-4 h-4" />
            Importar Planilha
          </Button>
          <Button onClick={() => setNovaVendaOpen(true)} variant="outline" className="gap-2">
            <ShoppingCart className="w-4 h-4" />
            Nova Venda
          </Button>
          <Button onClick={() => setCreateClientOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Novo Cliente
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "base" | "gestao")} className="space-y-4">
        <TabsList>
          <TabsTrigger value="base">Tempo de Venda</TabsTrigger>
          <TabsTrigger value="gestao">Gestão</TabsTrigger>
        </TabsList>

        {/* ========== ABA: BASE DE CLIENTES ========== */}
        <TabsContent value="base" className="space-y-4">
          <UpsellStats view="base" />

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente..."
                value={baseSearch}
                onChange={(e) => setBaseSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={basePotencial} onValueChange={setBasePotencial}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Potencial" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="baixo">Baixo</SelectItem>
                <SelectItem value="medio">Medio</SelectItem>
                <SelectItem value="alto">Alto</SelectItem>
                <SelectItem value="estrategico">Estrategico</SelectItem>
              </SelectContent>
            </Select>

            <Select value={baseActive} onValueChange={setBaseActive}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Ativos</SelectItem>
                <SelectItem value="inactive">Inativos</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex border border-border rounded-md">
              <Button
                variant={baseView === "kanban" ? "default" : "ghost"}
                size="sm"
                onClick={() => setBaseView("kanban")}
                className="rounded-r-none"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={baseView === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setBaseView("list")}
                className="rounded-l-none"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {baseView === "kanban" ? (
            <UpsellBaseKanban
              searchQuery={baseSearch}
              filterPotencial={basePotencial}
              filterActive={baseActive}
            />
          ) : (
            <UpsellBaseList
              searchQuery={baseSearch}
              filterPotencial={basePotencial}
              filterActive={baseActive}
            />
          )}
        </TabsContent>

        {/* ========== ABA: GESTÃO ========== */}
        <TabsContent value="gestao" className="space-y-4">
          <UpsellStats view="gestao" />

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente..."
                value={gestaoSearch}
                onChange={(e) => setGestaoSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={gestaoPotencial} onValueChange={setGestaoPotencial}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Potencial" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="baixo">Baixo</SelectItem>
                <SelectItem value="medio">Medio</SelectItem>
                <SelectItem value="alto">Alto</SelectItem>
                <SelectItem value="estrategico">Estrategico</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <UpsellGestaoKanban
            searchQuery={gestaoSearch}
            filterPotencial={gestaoPotencial}
          />
        </TabsContent>
      </Tabs>

      <CreateClientModal open={createClientOpen} onOpenChange={setCreateClientOpen} />
      <NovaVendaModal open={novaVendaOpen} onOpenChange={setNovaVendaOpen} />
      <PipeSettingsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        pipeType={importPipeType}
        stages={importStages}
        defaultTab="importar"
      />
    </div>
  );
}
