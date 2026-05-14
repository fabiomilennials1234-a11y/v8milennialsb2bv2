import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, Search, LayoutGrid, List, TrendingUp, ShoppingCart, Upload } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { usePortfolioHealth } from "@/hooks/usePortfolioHealth";
import { CarteiraKPIs } from "@/components/carteira/CarteiraKPIs";
import { CarteiraAlertBanner } from "@/components/carteira/CarteiraAlertBanner";
import { CarteiraClientTable } from "@/components/carteira/CarteiraClientTable";
import { CarteiraClientPreview } from "@/components/carteira/CarteiraClientPreview";

type ViewMode = "kanban" | "list";

const FILTER_TABS = [
  { value: "all", label: "Todos" },
  { value: "overdue", label: "Atrasados" },
  { value: "expected", label: "Esta Semana" },
  { value: "ouro", label: "Ouro" },
  { value: "prata", label: "Prata" },
  { value: "novo", label: "Novo" },
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
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [carteiraSearch, setCarteiraSearch] = useState("");
  const [carteiraFilter, setCarteiraFilter] = useState("all");
  const [quickOrderClientId, setQuickOrderClientId] = useState<string | null>(null);
  const { data: portfolioData } = usePortfolioHealth();

  // ─── Portfolio layout ──────────────────────────────────────────────────────
  if (isPortfolio) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="w-7 h-7 text-primary" />
              Carteira de Clientes
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Health score, recompra e gestão de carteira
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

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente ou empresa…"
              value={carteiraSearch}
              onChange={(e) => setCarteiraSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Segment filter tabs */}
          <div className="flex flex-wrap gap-1">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => {
                  setCarteiraFilter(tab.value);
                  setSelectedClientId(null);
                }}
                className={
                  carteiraFilter === tab.value
                    ? "px-3 py-1.5 rounded-md text-xs font-semibold bg-[hsl(47_100%_50%_/_0.15)] text-[hsl(47_100%_60%)] border border-[hsl(47_100%_50%_/_0.3)] transition-colors"
                    : "px-3 py-1.5 rounded-md text-xs font-medium text-zinc-400 border border-zinc-800 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main content: table + optional sidebar */}
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <CarteiraClientTable
              clients={portfolioData?.clients ?? []}
              selectedClientId={selectedClientId}
              onSelectClient={(id) =>
                setSelectedClientId((prev) => (prev === id ? null : id))
              }
              searchQuery={carteiraSearch}
              filter={carteiraFilter}
            />
          </div>

          {selectedClientId && (
            <CarteiraClientPreview
              clientId={selectedClientId}
              onClose={() => setSelectedClientId(null)}
              onViewDetail={(id) => navigate(`/carteira/${id}`)}
              onNewOrder={(id) => {
                setQuickOrderClientId(id);
                setNovaVendaOpen(true);
              }}
            />
          )}
        </div>

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
