import { useState } from "react";
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

type ViewMode = "kanban" | "list";

export default function Upsell() {
  // Auto-move clients based on stage rules
  useAutoMoveUpsellClients();

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
