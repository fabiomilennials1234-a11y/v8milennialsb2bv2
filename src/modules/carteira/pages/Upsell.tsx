import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  ShoppingCart,
  Upload,
  BarChart3,
  Users,
  ClipboardCheck,
  Send,
  Receipt,
  Download,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterChip } from "@/shared/components/FilterChip";
import { useOrganization } from "@/modules/identity";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
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
import { CarteiraClientTable } from "@/modules/carteira/components/client/CarteiraClientTable";
import { exportPortfolioCsv } from "@/modules/carteira/lib/portfolio-csv";
import type { PortfolioClientRow } from "@/modules/carteira/hooks/usePortfolioClients";
import { CarteiraRadar } from "@/modules/carteira/components/client/CarteiraRadar";
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

// Ordem do mockup V5: Clientes · Pedidos · Aprovações · Analytics.
const CARTEIRA_VIEWS = [
  { value: "clientes", label: "Clientes", Icon: Users },
  // Sem badge de contagem, de propósito: o badge de Aprovações significa
  // "aja em mim" e decai a zero. Pedidos é inventário — grande, nunca zero,
  // não acionável. Um número ali roubaria o significado do vizinho.
  { value: "pedidos", label: "Pedidos", Icon: Receipt },
  { value: "aprovacoes", label: "Aprovações", Icon: ClipboardCheck },
  { value: "analytics", label: "Analytics", Icon: BarChart3 },
] as const satisfies readonly {
  value: CarteiraView;
  label: string;
  Icon: typeof Users;
}[];

/** Recortes da tabela de clientes — os mesmos filtros da RPC, agora em chips. */
const PORTFOLIO_TABS = [
  { value: "all", label: "Todos", swatch: null },
  { value: "novo", label: "Novos", swatch: "hsl(var(--insights))" },
  { value: "ouro", label: "Ouro", swatch: "hsl(var(--primary))" },
  { value: "prata", label: "Prata", swatch: "hsl(var(--silver))" },
  { value: "dormindo", label: "Dormindo", swatch: "hsl(var(--muted-foreground))" },
  { value: "resgate", label: "Resgate", swatch: "hsl(var(--chart-5))" },
  { value: "overdue", label: "Recompra atrasada", swatch: "hsl(var(--destructive))" },
  { value: "expected", label: "Pedido previsto", swatch: "hsl(var(--success))" },
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
  const [disparoOpen, setDisparoOpen] = useState(false);
  const bulk = useBulkSelection();
  const { data: kpiData } = usePortfolioKPIs();
  const { organizationId } = useOrganization();
  const [exporting, setExporting] = useState(false);
  const tableRef = useRef<HTMLElement>(null);
  const radarRef = useRef<HTMLDivElement>(null);
  const handleExport = async () => {
    if (!organizationId) return;
    setExporting(true);
    try {
      await exportPortfolioCsv(organizationId, carteiraFilter, carteiraSearch);
    } finally {
      setExporting(false);
    }
  };

  useRealtimeSubscription("upsell_clients", ["portfolio-clients", "portfolio-kpis"]);
  // "carteira_orders" entra aqui porque a aba Pedidos lê pela RPC
  // carteira_list_orders — sem esta chave, editar num aparelho não atualiza a
  // lista aberta em outro.
  useRealtimeSubscription("upsell_orders", ["portfolio-clients", "portfolio-kpis", "pending-orders", "carteira_orders", "order-status-counts"]);
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
  //
  // V5 (2026-10): o seletor de visão (Clientes · Analytics · Aprovações ·
  // Pedidos) vira a pílula de navegação do cabeçalho — agora Radix Tabs, que
  // já dá o que o tablist feito à mão dava (roving tabIndex, setas, painel
  // ligado ao gatilho). Mesmos `value`s, mesmo estado.
  //
  // Na visão Clientes, tabela + prévia viram o painel-herói: a lista em tinta,
  // a linha selecionada em ouro e a prévia como o cartão de ouro ao lado.
  if (isPortfolio) {
    const openNewOrder = (clientId: string | null) => {
      setQuickOrderClientId(clientId);
      setNovaVendaOpen(true);
    };
    const secondary = [
      { label: "Disparo", icon: Send, onSelect: () => setDisparoOpen(true), disabled: false },
      { label: "Importar planilha", icon: Upload, onSelect: () => setImportOpen(true), disabled: false },
      ...(carteiraView === "clientes"
        ? [{ label: "Exportar clientes", icon: Download, onSelect: handleExport, disabled: exporting || !kpiData?.total_clients }]
        : []),
    ];

    return (
      <Tabs
        value={carteiraView}
        onValueChange={(v) => setCarteiraView(v as CarteiraView)}
        className="space-y-5"
      >
        <PageHeader
          title="Carteira de Clientes"
          subtitle="Quem já compra, quando vai comprar de novo e quem está esfriando."
          actions={
            <>
              {/* Ações de apoio em ícone (mockup); no celular, um menu ⋯. */}
              {secondary.map(({ label, icon: Icon, onSelect, disabled }) => (
                <Button
                  key={label}
                  variant="outline"
                  size="icon"
                  className="max-sm:hidden"
                  aria-label={label}
                  title={label}
                  onClick={onSelect}
                  disabled={disabled}
                >
                  {label === "Exportar clientes" && exporting ? <Loader2 className="animate-spin" /> : <Icon />}
                </Button>
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="sm:hidden" aria-label="Mais ações da carteira">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {secondary.map(({ label, icon: Icon, onSelect, disabled }) => (
                    <DropdownMenuItem key={label} onSelect={onSelect} disabled={disabled}>
                      <Icon className="mr-2 h-4 w-4" />
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" onClick={() => setCreateClientOpen(true)}>
                <Plus />
                Novo cliente
              </Button>
              <Button onClick={() => openNewOrder(null)}>
                <ShoppingCart />
                Nova venda
              </Button>
            </>
          }
          tabs={
            <TabsList variant="pill" aria-label="Visão da carteira">
              {CARTEIRA_VIEWS.map((view) => {
                const n =
                  view.value === "clientes"
                    ? kpiData?.total_clients ?? 0
                    : view.value === "aprovacoes"
                      ? pendingCount
                      : 0;
                return (
                  <TabsTrigger key={view.value} value={view.value} className="group">
                    <view.Icon className="h-3.5 w-3.5" />
                    {view.label}
                    {n > 0 && (
                      <span className="rounded-full bg-white/15 px-1.5 py-px text-[10px] font-bold tabular-nums group-data-[state=active]:bg-primary-foreground group-data-[state=active]:text-primary">
                        {n.toLocaleString("pt-BR")}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          }
        />

        <TabsContent value="clientes" className="mt-0 space-y-5">
          {/* KPIs só nesta aba; o banner de atraso virou o último cartão. */}
          <CarteiraKPIs
            onViewOverdue={() => {
              setCarteiraFilter("overdue");
              setSelectedClient(null);
              tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />

          {/* Herói: Radar de recompra — fila em tinta + cartão de ouro sempre aberto. */}
          <div ref={radarRef} className="scroll-mt-4">
            <CarteiraRadar
              focusClient={selectedClient}
              onFocusClient={setSelectedClient}
              onViewDetail={(id) => navigate(`/carteira/${id}`)}
              onNewOrder={openNewOrder}
              counts={{ expected: kpiData?.expected_this_week, overdue: kpiData?.overdue_count }}
            />
          </div>

          {/* A carteira inteira em cartão BRANCO: recortes em chips + busca. */}
          <section
            ref={tableRef}
            className="scroll-mt-4 overflow-hidden rounded-card border border-card-border bg-card shadow-relevo"
            aria-label="Clientes da carteira"
          >
            <div className="flex flex-col gap-3 border-b border-border px-4 py-3.5 lg:flex-row lg:items-center">
              <div
                role="tablist"
                aria-label="Filtro da carteira"
                className="-mx-4 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-4 py-1 scrollbar-hide lg:mx-0 lg:flex-wrap lg:px-0"
              >
                {PORTFOLIO_TABS.map((tab) => {
                  const count = tabCounts[tab.value] ?? 0;
                  const active = carteiraFilter === tab.value;
                  return (
                    <FilterChip
                      key={tab.value}
                      role="tab"
                      aria-selected={active}
                      active={active}
                      swatch={tab.swatch}
                      count={count > 0 ? count.toLocaleString("pt-BR") : undefined}
                      onClick={() => {
                        setCarteiraFilter(tab.value);
                        setSelectedClient(null);
                      }}
                    >
                      {tab.label}
                    </FilterChip>
                  );
                })}
              </div>
              <div className="relative w-full lg:w-[240px] lg:shrink-0">
                <Search className="absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  aria-label="Buscar clientes"
                  placeholder="Cliente, empresa…"
                  value={carteiraSearch}
                  onChange={(e) => setCarteiraSearch(e.target.value)}
                  className="h-[38px] rounded-full pl-9 text-[13px] shadow-relevo"
                />
              </div>
            </div>
            <CarteiraClientTable
              selectedClientId={selectedClient?.id ?? null}
              onSelectClient={(client) => {
                setSelectedClient(client);
                // A linha põe o cliente no cartão de ouro, que mora no Radar acima.
                if (client) radarRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }}
              onNewOrder={(id) => openNewOrder(id)}
              onViewDetail={(id) => navigate(`/carteira/${id}`)}
              searchQuery={carteiraSearch}
              filter={carteiraFilter}
              bulk={bulk}
              onRowsChange={setCurrentRows}
            />
          </section>

          {/* Bulk action bar */}
          <CarteiraBulkBar
            selectedClients={currentRows.filter((r) => bulk.isSelected(r.id))}
            onClear={bulk.clearSelection}
          />
        </TabsContent>

        <TabsContent value="pedidos" className="mt-0">
          {/* Sem gate em `organizationId`: o hook já espera o auth context
              (`enabled: isReady && !!organizationId`) e mostra skeleton. */}
          <CarteiraOrders
            searchQuery={carteiraSearch}
            onSearchChange={setCarteiraSearch}
            onReviewQueue={() => setCarteiraView("aprovacoes")}
          />
        </TabsContent>

        <TabsContent value="aprovacoes" className="mt-0">
          <CarteiraApprovals />
        </TabsContent>

        <TabsContent value="analytics" className="mt-0 space-y-4">
          <AnalyticsKPICards />
          <RevenueChart />
          <CarteiraCohortHeatmap />
          <CarteiraVendedorRanking />
        </TabsContent>

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
      </Tabs>
    );
  }

  // ─── Original Upsell layout ────────────────────────────────────────────────
  // V5 (2026-10): só forma — cabeçalho, abas em pílula e filtros no vocabulário
  // novo. Mesmas abas, mesmos filtros, mesmos kanbans.
  const potencialOptions = (
    <SelectContent>
      <SelectItem value="all">Todos</SelectItem>
      <SelectItem value="baixo">Baixo</SelectItem>
      <SelectItem value="medio">Médio</SelectItem>
      <SelectItem value="alto">Alto</SelectItem>
      <SelectItem value="estrategico">Estratégico</SelectItem>
    </SelectContent>
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as "base" | "gestao")}
      className="space-y-5"
    >
      <PageHeader
        title="Carteira de Clientes Ativos"
        subtitle="Gerencie sua carteira de clientes e classifique por perfil"
        secondaryActions={[{ label: "Importar planilha", icon: Upload, onSelect: () => setImportOpen(true) }]}
        secondaryActionsLabel="Mais ações da carteira"
        actions={
          <>
            <Button onClick={() => setNovaVendaOpen(true)} variant="ink">
              <ShoppingCart />
              Nova venda
            </Button>
            <Button onClick={() => setCreateClientOpen(true)}>
              <Plus />
              Novo cliente
            </Button>
          </>
        }
        tabs={
          <TabsList variant="pill">
            <TabsTrigger value="base">Tempo de Venda</TabsTrigger>
            <TabsTrigger value="gestao">Gestão</TabsTrigger>
          </TabsList>
        }
      />

      {/* ========== ABA: BASE DE CLIENTES ========== */}
      <TabsContent value="base" className="mt-0 space-y-4">
        <UpsellStats view="base" />

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente..."
              value={baseSearch}
              onChange={(e) => setBaseSearch(e.target.value)}
              className="rounded-full pl-9"
            />
          </div>

          <Select value={basePotencial} onValueChange={setBasePotencial}>
            <SelectTrigger className="w-[150px]" aria-label="Potencial">
              <SelectValue placeholder="Potencial" />
            </SelectTrigger>
            {potencialOptions}
          </Select>

          <Select value={baseActive} onValueChange={setBaseActive}>
            <SelectTrigger className="w-[130px]" aria-label="Status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="inactive">Inativos</SelectItem>
            </SelectContent>
          </Select>

          {/* Alternador kanban/lista — mesmo estado, forma de segmentado. */}
          <div className="inline-flex items-center gap-0.5 rounded-full bg-muted p-[3px]">
            {([
              { value: "kanban" as const, label: "Kanban", Icon: LayoutGrid },
              { value: "list" as const, label: "Lista", Icon: List },
            ]).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setBaseView(value)}
                aria-label={label}
                aria-pressed={baseView === value}
                title={label}
                className={cn(
                  "grid h-8 w-9 place-items-center rounded-full transition-[background-color,color,box-shadow] duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  baseView === value
                    ? "bg-card text-foreground shadow-relevo"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
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
      <TabsContent value="gestao" className="mt-0 space-y-4">
        <UpsellStats view="gestao" />

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] max-w-sm flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente..."
              value={gestaoSearch}
              onChange={(e) => setGestaoSearch(e.target.value)}
              className="rounded-full pl-9"
            />
          </div>

          <Select value={gestaoPotencial} onValueChange={setGestaoPotencial}>
            <SelectTrigger className="w-[150px]" aria-label="Potencial">
              <SelectValue placeholder="Potencial" />
            </SelectTrigger>
            {potencialOptions}
          </Select>
        </div>

        <UpsellGestaoKanban
          searchQuery={gestaoSearch}
          filterPotencial={gestaoPotencial}
        />
      </TabsContent>

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
    </Tabs>
  );
}
