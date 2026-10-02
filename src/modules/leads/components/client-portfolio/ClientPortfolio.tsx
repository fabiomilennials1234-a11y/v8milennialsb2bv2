import { useState, type ReactNode } from "react";
import {
  Clock3,
  Plus,
  RotateCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  Users,
} from "lucide-react";
import { useViewport } from "@/shared/hooks/use-viewport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiTile } from "@/components/ui/bento";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import {
  Client360,
  ClientAvatar,
  ClientTier,
  ReorderCaption,
} from "./Client360";
import {
  cycleDate,
  portfolioDate,
  SEGMENTS,
  type PortfolioClient,
  type PortfolioPurchase,
} from "./portfolio-model";
import type {
  PortfolioSummary,
  PortfolioSegment,
  PortfolioReorder,
} from "../../lib/client-portfolio-contract";
import type { LeadDeal } from "../../hooks/useLeadsDeals";

export interface ClientPortfolioProps {
  clients: PortfolioClient[];
  total?: number;
  summary?: PortfolioSummary;
  segment: PortfolioSegment;
  onSegment: (value: PortfolioSegment) => void;
  reorder: PortfolioReorder;
  onReorder: (value: PortfolioReorder) => void;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  search: string;
  onSearch: (value: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewDeal: (id: string) => void;
  onOpenLead: (id: string) => void;
  onOpenDeal: (deal: LeadDeal) => void;
  canCreate: boolean;
  purchases?: PortfolioPurchase[];
  purchasesLoading?: boolean;
  purchasesError?: boolean;
  onRetryPurchases?: () => void;
  filters?: ReactNode;
  pagination?: ReactNode;
  now?: number;
}
export function ClientPortfolio({
  clients,
  total,
  summary,
  segment,
  onSegment,
  reorder,
  onReorder,
  loading,
  error,
  onRetry,
  search,
  onSearch,
  selectedId,
  onSelect,
  onNewDeal,
  onOpenLead,
  onOpenDeal,
  canCreate,
  purchases,
  purchasesLoading,
  purchasesError,
  onRetryPurchases,
  filters,
  pagination,
  now = Date.now(),
}: ClientPortfolioProps) {
  const { width } = useViewport();
  const compact = (width ?? 1024) < 1024;
  const [showFilters, setShowFilters] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const visible = clients;
  const selected = clients.find((c) => c.id === selectedId);
  const detail = selected ? (
    <Client360
      key={selected.id}
      client={selected}
      historyOpen={historyOpen}
      onHistoryOpenChange={setHistoryOpen}
      now={now}
      canCreate={canCreate}
      purchases={purchases}
      purchasesLoading={purchasesLoading}
      purchasesError={purchasesError}
      onRetryPurchases={onRetryPurchases}
      onNewDeal={(id) => {
        setMobileDetail(false);
        onNewDeal(id);
      }}
      onOpenLead={(id) => {
        setMobileDetail(false);
        onOpenLead(id);
      }}
      onOpenDeal={(deal) => {
        setMobileDetail(false);
        onOpenDeal(deal);
      }}
    />
  ) : null;
  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_330px] xl:grid-cols-[minmax(0,1fr)_350px] 2xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="min-w-0 space-y-4">
        {/* Os quatro números da carteira — mesmos valores e mesma fonte
            (`client_portfolio_page`), agora no cartão de número do V5. Erro
            vira "—", nunca zero fabricado. */}
        <div
          role="group"
          className="grid grid-cols-2 gap-4 2xl:grid-cols-4"
          aria-label="Indicadores da carteira"
        >
          {([
            {
              icon: Users,
              tone: "neutral",
              value: total?.toLocaleString("pt-BR") ?? "—",
              label: "Clientes",
              scope: "No recorte atual",
            },
            {
              icon: TrendingUp,
              tone: "good",
              value: summary ? formatBRL(summary.monthlyRevenue) : "—",
              label: "Receita no mês",
              scope: "No recorte atual",
            },
            {
              icon: RotateCw,
              tone: "info",
              value: summary?.expectedCount ?? "—",
              label: "Recompras previstas",
              scope: "Próximos 7 dias",
            },
            {
              icon: Clock3,
              tone: (summary?.overdueCount ?? 0) > 0 ? "bad" : "neutral",
              value: summary?.overdueCount ?? "—",
              label: "Em atraso",
              scope: "No recorte atual",
            },
          ] as const).map(({ icon, tone, value, label, scope }) => {
            const exibido = loading ? "·" : error ? "—" : value;
            return (
              <KpiTile
                key={label}
                label={label}
                icon={icon}
                tone={tone}
                loading={loading}
                // Receita cheia ("R$ 1.234.567") não cabe num quarto da coluna:
                // o número trunca com o valor inteiro no `title`, nunca estoura.
                value={<span className="block truncate" title={String(exibido)}>{exibido}</span>}
                note={scope}
              />
            );
          })}
        </div>
        {compact && selected && !loading && !error && (
          <Button variant="outline" className="w-full justify-between" onClick={() => setMobileDetail(true)}>
            <span>Cliente 360 · {selected.company || selected.name}</span><span>Abrir →</span>
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-44 flex-1">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Buscar cliente"
              placeholder="Buscar cliente…"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              className="h-10 bg-card pl-9"
            />
          </div>
          <Select
            value={segment}
            onValueChange={(value) => onSegment(value as PortfolioSegment)}
          >
            <SelectTrigger
              className="h-10 w-[145px] bg-card"
              aria-label="Faixa dos clientes"
            >
              <SelectValue placeholder="Classificação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Classificação</SelectItem>
              {Object.entries(SEGMENTS).map(([key, tier]) => (
                <SelectItem key={key} value={key}>
                  {tier.label}
                </SelectItem>
              ))}
              <SelectItem value="none">Sem faixa</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={reorder}
            onValueChange={(value) => onReorder(value as PortfolioReorder)}
          >
            <SelectTrigger
              className="h-10 w-[145px] bg-card"
              aria-label="Recompra dos clientes"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Recompra</SelectItem>
              <SelectItem value="late">Em atraso</SelectItem>
              <SelectItem value="soon">Prevista em 7 dias</SelectItem>
              <SelectItem value="on-time">No ciclo</SelectItem>
              <SelectItem value="unknown">Sem previsão</SelectItem>
            </SelectContent>
          </Select>
          {filters && (
            <Button
              variant="outline"
              className="h-10 gap-2 bg-card"
              aria-expanded={showFilters}
              onClick={() => setShowFilters((v) => !v)}
            >
              <SlidersHorizontal className="size-4" />
              Filtros
            </Button>
          )}
        </div>
        {showFilters && filters}
        {(segment !== "all" || reorder !== "all") && (
          <p className="text-xs text-muted-foreground">
            Faixa e recompra aplicadas à carteira inteira.{" "}
            <button
              type="button"
              className="font-semibold text-foreground underline underline-offset-2"
              onClick={() => {
                onSegment("all");
                onReorder("all");
              }}
            >
              Limpar filtros
            </button>
          </p>
        )}
        <section
          className="overflow-hidden rounded-card border border-card-border bg-card shadow-relevo"
          aria-label="Carteira de clientes"
        >
          <div className="px-5 pb-4 pt-5">
            <h2 className="text-base font-bold tracking-tight">
              Carteira de clientes
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Previsões calculadas pelo histórico de compras
            </p>
          </div>
          {error ? (
            <div role="alert" className="px-5 py-12 text-center">
              <p className="text-sm">
                Não foi possível carregar a carteira completa.
              </p>
              <Button variant="outline" className="mt-3" onClick={onRetry}>
                Tentar novamente
              </Button>
            </div>
          ) : loading ? (
            <div
              aria-label="Carregando clientes"
              className="space-y-1 px-4 pb-4"
            >
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Users className="mx-auto mb-3 size-7 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhum cliente encontrado</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {segment !== "all" || reorder !== "all"
                  ? "Ajuste os filtros da carteira."
                  : "Clientes aparecem conforme negócios ganhos ou classificação do ERP."}
              </p>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                    {[
                      "Cliente",
                      "Faixa",
                      "Última compra",
                      "Ciclo",
                      "Próxima compra",
                      "Negócios",
                      "",
                    ].map((label, i) => (
                      <th
                        key={i}
                        scope="col"
                        className={cn(
                          "whitespace-nowrap px-3 py-3 font-bold",
                          i === 0 && "pl-5",
                        )}
                      >
                        {label || <span className="sr-only">Ações</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((client) => {
                    const openCount = client.deals.filter(
                      (d) => d.outcome === "open",
                    ).length;
                    return (
                      <tr
                        key={client.id}
                        className={cn(
                          "border-b border-border/70 transition-colors hover:bg-muted/30",
                          selectedId === client.id &&
                            "bg-primary-soft/60 shadow-[inset_3px_0_0_hsl(var(--primary))]",
                        )}
                      >
                        <td className="py-3 pl-5 pr-3">
                          <button
                            type="button"
                            aria-pressed={selectedId === client.id}
                            aria-label={`Ver 360 de ${client.company || client.name}`}
                            onClick={() => {
                              onSelect(client.id);
                              setMobileDetail(compact);
                            }}
                            className="flex w-full items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ClientAvatar
                              name={client.company || client.name}
                            />
                            <span className="min-w-0">
                              <span className="block max-w-52 truncate font-semibold">
                                {client.company || client.name}
                              </span>
                              <span className="mt-1 block max-w-52 truncate text-[10px] text-muted-foreground">
                                {client.identity || client.name}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-3">
                          <ClientTier segment={client.metrics?.segment} />
                        </td>
                        <td className="whitespace-nowrap px-3 tabular-nums">
                          {portfolioDate(
                            client.lastPurchaseAt ?? cycleDate(
                              client.cycle?.diasDesdeUltima == null
                                ? null
                                : -client.cycle.diasDesdeUltima,
                              now,
                            ),
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 text-muted-foreground">
                          {client.cycle?.mediaDias
                            ? `${client.cycle.mediaDias} dias`
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3">
                          <span className="block tabular-nums">
                            {portfolioDate(
                              client.nextPurchaseAt ??
                                cycleDate(client.cycle?.diasRestantes, now),
                            )}
                          </span>
                          <ReorderCaption client={client} />
                        </td>
                        <td className="px-3">
                          {openCount ? (
                            <span className="whitespace-nowrap rounded-full bg-muted px-2 py-1 text-[11px] font-semibold">
                              {openCount}{" "}
                              {openCount === 1 ? "aberto" : "abertos"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="pl-1 pr-4">
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-8 rounded-lg"
                            disabled={!canCreate}
                            aria-label={`Novo negócio para ${client.company || client.name}`}
                            onClick={() => onNewDeal(client.id)}
                          >
                            <Plus className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {pagination}
        </section>
      </div>
      <div className="hidden lg:block">
        {!compact && !loading && !error && detail ? (
          detail
        ) : (
          <div className="rounded-card border border-card-border bg-card p-6 shadow-relevo">
            <h2 className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
              Cliente 360
            </h2>
            <p className="mt-6 text-sm text-muted-foreground">
              Selecione um cliente para conhecer sua próxima oportunidade.
            </p>
          </div>
        )}
      </div>
      <Sheet
        open={compact && mobileDetail && !!selected && !loading && !error}
        onOpenChange={setMobileDetail}
      >
        <SheetContent onEscapeKeyDown={event => {
          // Before Radix registers the nested layer, Escape can still reach
          // this sheet. Close only history even during that first frame.
          if (historyOpen) { event.preventDefault(); setHistoryOpen(false); }
        }} className="w-full overflow-y-auto p-3 sm:max-w-md lg:hidden motion-reduce:animate-none motion-reduce:transition-none">
          <SheetHeader className="sr-only">
            <SheetTitle>Cliente 360</SheetTitle>
            <SheetDescription>
              Histórico de compras, recompra e negócios do cliente selecionado.
            </SheetDescription>
          </SheetHeader>
          {compact ? detail : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
