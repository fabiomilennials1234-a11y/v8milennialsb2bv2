import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Search, LayoutGrid, List, TrendingUp, ShoppingCart, Upload, BarChart3, Users, ClipboardCheck, Send, Receipt } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { UpsellStats } from "@/modules/carteira/components/upsell/UpsellStats";
import { UpsellBaseKanban } from "@/modules/carteira/components/upsell/UpsellBaseKanban";
import { UpsellBaseList } from "@/modules/carteira/components/upsell/UpsellBaseList";
import { UpsellGestaoKanban } from "@/modules/carteira/components/upsell/UpsellGestaoKanban";
import { CreateClientModal } from "@/modules/carteira/components/upsell/CreateClientModal";
import { NewOrderModal } from "@/modules/carteira/components/client/NewOrderModal";
import { PipeSettingsDialog } from "@/modules/pipelines/components/shared/PipeSettingsDialog";
import { DisparoWizard } from "@/modules/pipelines";
import { useCarteiraStages, type CarteiraStageFamily } from "@/modules/carteira/hooks/useCarteiraStages";
import { useAutoMoveUpsellClients } from "@/modules/carteira/hooks/useAutoMoveUpsellClients";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { usePortfolioKPIs } from "@/modules/carteira/hooks/usePortfolioKPIs";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { CarteiraKPIs } from "@/modules/carteira/components/client/CarteiraKPIs";
import { CarteiraAlertBanner } from "@/modules/carteira/components/client/CarteiraAlertBanner";
import { CarteiraClientTable, type PortfolioClientRow } from "@/modules/carteira/components/client/CarteiraClientTable";
import { CarteiraClientPreview } from "@/modules/carteira/components/client/CarteiraClientPreview";
import { CarteiraBulkBar } from "@/modules/carteira/components/client/CarteiraBulkBar";
import { AnalyticsKPICards } from "@/modules/carteira/components/client/AnalyticsKPICards";
import { RevenueChart } from "@/modules/carteira/components/client/RevenueChart";
import { CarteiraCohortHeatmap } from "@/modules/carteira/components/client/CarteiraCohortHeatmap";
import { CarteiraVendedorRanking } from "@/modules/carteira/components/client/CarteiraVendedorRanking";
import { CarteiraApprovals } from "@/modules/carteira/components/client/CarteiraApprovals";
import { CarteiraOrders } from "@/modules/carteira/components/orders/CarteiraOrders";
import { usePendingOrders } from "@/modules/carteira/hooks/useOrderApproval";
import { useBulkSelection } from "@/shared/hooks/useBulkSelection";

type ViewMode = "kanban" | "list";

type CarteiraView = "clientes" | "analytics" | "aprovacoes" | "pedidos";

const CARTEIRA_VIEWS = [
  { value: "clientes", label: "Clientes", Icon: Users },
  { value: "analytics", label: "Analytics", Icon: BarChart3 },
  { value: "aprovacoes", label: "Aprovações", Icon: ClipboardCheck },
  // Sem badge de contagem, de propósito: o badge de Aprovações significa
  // "aja em mim" e decai a zero. Pedidos é inventário — grande, nunca zero,
  // não acionável. Um número ali roubaria o significado do vizinho. A
  // contagem vive na linha de resumo do conteúdo.
  { value: "pedidos", label: "Pedidos", Icon: Receipt },
] as const satisfies readonly {
  value: CarteiraView;
  label: string;
  Icon: typeof Users;
}[];

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
  const importPipeType: CarteiraStageFamily = activeTab === "gestao" ? "upsell_gestao" : "upsell_base";
  const { data: importStages = [] } = useCarteiraStages(importPipeType);

  // Portfolio (carteira) state — only used when isPortfolio
  const [quickOrderClientId, setQuickOrderClientId] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<PortfolioClientRow | null>(null);
  const [carteiraSearch, setCarteiraSearch] = useState("");
  const [carteiraFilter, setCarteiraFilter] = useState("all");

  const [currentRows, setCurrentRows] = useState<PortfolioClientRow[]>([]);
  const [carteiraView, setCarteiraView] = useState<CarteiraView>("clientes");
  const viewTabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleViewKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next =
      (index + delta + CARTEIRA_VIEWS.length) % CARTEIRA_VIEWS.length;
    setCarteiraView(CARTEIRA_VIEWS[next].value);
    viewTabRefs.current[next]?.focus();
  }
  const [disparoOpen, setDisparoOpen] = useState(false);
  const bulk = useBulkSelection();
  const { data: kpiData } = usePortfolioKPIs();

  useRealtimeSubscription("upsell_clients", ["portfolio-clients", "portfolio-kpis"]);
  // "carteira_orders" entra aqui porque a aba Pedidos lê pela RPC
  // carteira_list_orders — sem esta chave, editar num aparelho não atualiza a
  // lista aberta em outro.
  useRealtimeSubscription("upsell_orders", ["portfolio-clients", "portfolio-kpis", "pending-orders", "carteira_orders"]);
  const { data: pendingOrders = [] } = usePendingOrders();
  const pendingCount = pendingOrders.length;

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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              Carteira de Clientes
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {kpiData
                ? `${kpiData.total_clients} clientes ativos · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(kpiData.total_recurring)}/mês recorrente`
                : "Health score, recompra e gestão de carteira"}
            </p>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 [&>*]:shrink-0">
            <Button
              onClick={() => setDisparoOpen(true)}
              variant="outline"
              className="gap-2 border-primary/30 text-foreground hover:border-primary/60 hover:bg-primary/5"
            >
              <Send className="w-4 h-4 text-primary" />
              Disparo
            </Button>
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

        {/* Fileira de segmentos — só na view Clientes.
            `carteiraFilter` só é consumido por CarteiraClientTable, então em
            analytics/aprovações/pedidos esta fileira renderizava e não fazia
            nada (UI morta pré-existente). */}
        {carteiraView === "clientes" && (
          <div
            role="tablist"
            aria-label="Filtro da carteira"
            className="flex gap-0 border-b border-border overflow-x-auto"
          >
            {PORTFOLIO_TABS.map((tab) => {
              const count = tabCounts[tab.value] ?? 0;
              const active = carteiraFilter === tab.value;
              const isRisk = "isRisk" in tab && tab.isRisk;
              return (
                <button
                  key={tab.value}
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setCarteiraFilter(tab.value);
                    setSelectedClient(null);
                  }}
                  className={cn(
                    "px-5 py-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    active
                      ? "text-foreground border-b-primary"
                      : "text-muted-foreground border-b-transparent hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {count > 0 && (
                    <span
                      className={cn(
                        "ml-1.5 text-[11px] px-1.5 py-px rounded-full inline-block",
                        active && !isRisk && "bg-primary/10 text-primary",
                        active && isRisk && "bg-destructive/10 text-destructive",
                        !active && !isRisk && "bg-muted text-muted-foreground",
                        !active && isRisk && "bg-destructive/10 text-destructive",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Search + View toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-[320px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              placeholder={
                carteiraView === "pedidos"
                  ? "Buscar cliente, produto…"
                  : "Buscar cliente, empresa…"
              }
              value={carteiraSearch}
              onChange={(e) => setCarteiraSearch(e.target.value)}
              className="pl-9 bg-card border-border text-[13px]"
            />
          </div>
          <div
            role="tablist"
            aria-label="Visão da carteira"
            className="flex border border-border rounded-md ml-auto"
          >
            {CARTEIRA_VIEWS.map((view, i) => {
              const active = carteiraView === view.value;
              return (
                <button
                  key={view.value}
                  ref={(el) => {
                    viewTabRefs.current[i] = el;
                  }}
                  role="tab"
                  aria-selected={active}
                  aria-controls="carteira-view-panel"
                  // Roving tabIndex: o control inteiro é UMA parada de Tab; as
                  // setas navegam entre os itens (padrão WAI-ARIA tablist).
                  tabIndex={active ? 0 : -1}
                  onKeyDown={(e) => handleViewKeyDown(e, i)}
                  onClick={() => setCarteiraView(view.value)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                    i === 0 && "rounded-l-md",
                    i === CARTEIRA_VIEWS.length - 1 && "rounded-r-md",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    active
                      ? "bg-muted text-foreground"
                      : // `hover:text-muted-foreground` era no-op (mesma cor do
                        // estado base) — hover invisível nos 4 itens.
                        "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                  )}
                >
                  <view.Icon className="w-3.5 h-3.5" />
                  {view.label}
                  {view.value === "aprovacoes" && pendingCount > 0 && (
                    <span className="ml-1 bg-primary/15 text-primary text-[10px] font-semibold px-1.5 py-px rounded-full">
                      {pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div id="carteira-view-panel" role="tabpanel" className="space-y-6">
        {carteiraView === "clientes" ? (
          <>
            {/* Main content: table + optional sidebar */}
            <div className="flex gap-4 items-start">
              <div className="flex-1 min-w-0">
                <CarteiraClientTable
                  selectedClientId={selectedClient?.id ?? null}
                  onSelectClient={(client) => setSelectedClient(client)}
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
        ) : carteiraView === "analytics" ? (
          <div className="space-y-6">
            <AnalyticsKPICards />
            <RevenueChart />
            <CarteiraCohortHeatmap />
            <CarteiraVendedorRanking />
          </div>
        ) : carteiraView === "aprovacoes" ? (
          <CarteiraApprovals />
        ) : (
          // Sem gate em `organizationId`: o hook já espera o auth context
          // (`enabled: isReady && !!organizationId`) e mostra skeleton. Gatear o
          // render aqui deixava a aba EM BRANCO — sem skeleton, sem empty
          // state — no intervalo até o contexto resolver.
          <CarteiraOrders searchQuery={carteiraSearch} />
        )}
        </div>

        {/* Shared modals */}
        <CreateClientModal open={createClientOpen} onOpenChange={setCreateClientOpen} />
        <NewOrderModal
          open={novaVendaOpen}
          onOpenChange={setNovaVendaOpen}
          clientId={quickOrderClientId ?? undefined}
          clientName={selectedClient?.name}
        />
        <PipeSettingsDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          pipeType={importPipeType}
          stages={importStages}
          defaultTab="importar"
        />

        {/* Disparo Wizard (Mass Send — carteira context). Header entry opens the
            Segmento source so the operator can blast by segment + conditions.
            Mounted only while open so the carteira lead-id resolution never runs
            in the background. */}
        {disparoOpen && (
          <DisparoWizard
            open={disparoOpen}
            onOpenChange={setDisparoOpen}
            context={{ kind: "carteira" }}
          />
        )}
      </div>
    );
  }

  // ─── Original Upsell layout (unchanged) ───────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-primary shrink-0" />
            Carteira de Clientes Ativos
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie sua carteira de clientes e classifique por perfil
          </p>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 [&>*]:shrink-0">
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
      <NewOrderModal
        open={novaVendaOpen}
        onOpenChange={setNovaVendaOpen}
        clientId={quickOrderClientId ?? undefined}
      />
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
