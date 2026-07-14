import { useState, useMemo } from "react";
import { Plus, LayoutList, Kanban, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useDeals,
  useDealKPIs,
  useUpdateDeal,
  type Deal,
  type DealsFilter,
} from "@/modules/carteira/hooks/useDeals";
import { DealKPICards } from "@/modules/carteira/components/deal/DealKPICards";
import { DealDetailDrawer } from "@/modules/carteira/components/deal/DealDetailDrawer";
import { DealKanbanCard } from "@/modules/carteira/components/deal/DealKanbanCard";
import { CreateDealDialog } from "@/modules/carteira/components/deal/CreateDealDialog";
import {
  DraggableKanbanBoard,
  type KanbanColumn,
  type DraggableItem,
} from "@/modules/pipelines/components/kanban/DraggableKanbanBoard";
import {
  KanbanFilterPanel,
  FilterChips,
  type FilterSectionConfig,
} from "@/modules/pipelines/components/kanban/KanbanFilterPanel";
import { matchesQualificationFilters } from "@/modules/pipelines/lib/kanbanFilterParams";
import { usePersistedState } from "@/shared/hooks/usePersistedState";

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type ViewMode = "list" | "kanban";
type StatusTab = "all" | "open" | "won" | "lost";

type DealKanbanItem = Deal & DraggableItem;

export default function Negocios() {
  const [viewMode, setViewMode] = usePersistedState<ViewMode>(
    "deals-view",
    "list"
  );
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [search, setSearch] = useState("");
  const [qualificationTier, setQualificationTier] = useState<string[]>([]);
  const [preQualificationTier, setPreQualificationTier] = useState<string[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const filters: DealsFilter = {
    status: statusTab === "all" ? undefined : statusTab,
    search: search || undefined,
  };

  const { data: deals = [], isLoading } = useDeals(filters);
  const { data: kpis } = useDealKPIs();
  const updateDeal = useUpdateDeal();

  // Qualification-tier filter (client-side — Negócios não é paginado no
  // servidor). Aplicado sobre o `deals` já filtrado por status/busca no
  // servidor, e alimenta TANTO a lista quanto o kanban, então linhas, cards e
  // somatório por coluna ficam consistentes (mesma fonte filtrada).
  const tierFilterActive =
    qualificationTier.length > 0 || preQualificationTier.length > 0;
  const filteredDeals = useMemo(
    () =>
      tierFilterActive
        ? deals.filter((d) =>
            matchesQualificationFilters(d.lead, qualificationTier, preQualificationTier),
          )
        : deals,
    [deals, tierFilterActive, qualificationTier, preQualificationTier],
  );

  const filterSections: FilterSectionConfig[] = useMemo(
    () => [
      { type: "qualification-tier", value: qualificationTier, onChange: setQualificationTier },
      { type: "pre-qualification-tier", value: preQualificationTier, onChange: setPreQualificationTier },
    ],
    [qualificationTier, preQualificationTier],
  );

  const handleClearFilters = () => {
    setQualificationTier([]);
    setPreQualificationTier([]);
  };

  const openDeal = (id: string) => {
    setSelectedDealId(id);
    setDrawerOpen(true);
  };

  // Group open deals by stage_id for kanban
  const kanbanColumns = useMemo<KanbanColumn<DealKanbanItem>[]>(() => {
    const openDeals = filteredDeals.filter((d) => d.won === null);

    const stageGroups = new Map<string, DealKanbanItem[]>();
    stageGroups.set("__no_stage", []);

    for (const deal of openDeals) {
      const key = deal.stage_id ?? "__no_stage";
      if (!stageGroups.has(key)) stageGroups.set(key, []);
      stageGroups.get(key)!.push(deal as DealKanbanItem);
    }

    const cols: KanbanColumn<DealKanbanItem>[] = [];

    // No-stage column first if has items
    const noStageDeals = stageGroups.get("__no_stage") ?? [];
    if (noStageDeals.length > 0) {
      cols.push({
        id: "__no_stage",
        title: "Sem estágio",
        color: "#6b7280",
        items: noStageDeals,
      });
    }

    for (const [stageId, items] of stageGroups.entries()) {
      if (stageId === "__no_stage") continue;
      cols.push({
        id: stageId,
        title: `Estágio`,
        color: "#6b7280",
        items,
      });
    }

    return cols;
  }, [filteredDeals]);

  const handleStageChange = (dealId: string, newStageId: string) => {
    if (newStageId === "__no_stage") return;
    updateDeal.mutate({ id: dealId, stage_id: newStageId });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Negócios</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Novo negócio
        </Button>
      </div>

      {/* KPIs */}
      {kpis && <DealKPICards kpis={kpis} />}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar negócio..."
            className="pl-9"
          />
        </div>

        {/* Status tabs */}
        <Tabs
          value={statusTab}
          onValueChange={(v) => setStatusTab(v as StatusTab)}
        >
          <TabsList>
            <TabsTrigger value="all">Todos</TabsTrigger>
            <TabsTrigger value="open">Abertos</TabsTrigger>
            <TabsTrigger value="won">Ganhos</TabsTrigger>
            <TabsTrigger value="lost">Perdidos</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Qualification filter */}
        <KanbanFilterPanel sections={filterSections} onClearAll={handleClearFilters} />

        {/* View toggle */}
        <div className="flex border rounded-md ml-auto">
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-r-none"
            onClick={() => setViewMode("list")}
          >
            <LayoutList className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "kanban" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-l-none"
            onClick={() => setViewMode("kanban")}
          >
            <Kanban className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <FilterChips sections={filterSections} onClearAll={handleClearFilters} />

      {/* Content */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Carregando...
        </div>
      ) : viewMode === "list" ? (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-center">Prob.</TableHead>
                <TableHead>Previsão</TableHead>
                <TableHead>Produtos</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDeals.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-12 text-muted-foreground"
                  >
                    Nenhum negócio encontrado
                  </TableCell>
                </TableRow>
              ) : (
                filteredDeals.map((deal) => (
                  <TableRow
                    key={deal.id}
                    className="cursor-pointer"
                    onClick={() => openDeal(deal.id)}
                  >
                    <TableCell className="font-medium">{deal.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {deal.lead?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {deal.owner?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {fmt(deal.value ?? 0)}
                    </TableCell>
                    <TableCell className="text-center">
                      {deal.probability ?? 0}%
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {deal.expected_close_date
                        ? new Date(deal.expected_close_date).toLocaleDateString(
                            "pt-BR"
                          )
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {(deal.deal_items?.length ?? 0) > 0 && (
                        <Badge
                          variant="secondary"
                          className="text-[10px]"
                        >
                          {deal.deal_items!.length} prod.
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {deal.won === true && (
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                          Ganho
                        </Badge>
                      )}
                      {deal.won === false && (
                        <Badge variant="destructive">Perdido</Badge>
                      )}
                      {deal.won === null && (
                        <Badge variant="outline">Aberto</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <DraggableKanbanBoard<DealKanbanItem>
          columns={kanbanColumns}
          onStatusChange={handleStageChange}
          renderCard={(deal, isDragging) => (
            <div onClick={() => openDeal(deal.id)}>
              <DealKanbanCard deal={deal as Deal} isDragging={isDragging} />
            </div>
          )}
          renderColumnExtra={(col) => (
            <span className="text-xs text-muted-foreground ml-1">
              {fmt(
                col.items.reduce(
                  (s, d) => s + ((d as Deal).value ?? 0),
                  0
                )
              )}
            </span>
          )}
        />
      )}

      {/* Drawers / Dialogs */}
      <DealDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        dealId={selectedDealId}
      />
      <CreateDealDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
