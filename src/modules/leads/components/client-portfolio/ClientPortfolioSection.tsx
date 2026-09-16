import { useMemo, useState, useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  useClientPortfolio,
  PORTFOLIO_PAGE_SIZE,
} from "../../hooks/useClientPortfolio";
import { useLeadsDeals, type LeadDeal } from "../../hooks/useLeadsDeals";
import { useClientPortfolioPurchases } from "../../hooks/useClientPortfolioPurchases";
import type { LeadsFilterParams } from "../../hooks/useLeads";
import type {
  PortfolioReorder,
  PortfolioSegment,
} from "../../lib/client-portfolio-contract";
import { ClientPortfolio } from "./ClientPortfolio";
interface Props {
  filters: LeadsFilterParams;
  filterControls: (clearPortfolio: () => void) => ReactNode;
  onSearch: (value: string) => void;
  canCreate: boolean;
  onNewDeal: (id: string) => void;
  onOpenLead: (id: string) => void;
  onOpenDeal: (deal: LeadDeal) => void;
}
export function ClientPortfolioSection({
  filters,
  filterControls,
  onSearch,
  canCreate,
  onNewDeal,
  onOpenLead,
  onOpenDeal,
}: Props) {
  const [segment, setSegment] = useState<PortfolioSegment>("all");
  const [reorder, setReorder] = useState<PortfolioReorder>("all");
  const filterKey = JSON.stringify({
    ...filters,
    page: undefined,
    segment,
    reorder,
  });
  const [paging, setPaging] = useState({ key: filterKey, page: 0 });
  const page = paging.key === filterKey ? paging.page : 0;
  const query = useClientPortfolio(filters, segment, reorder, page);
  const ids = useMemo(
    () => query.data?.clients.map((c) => c.id) ?? [],
    [query.data],
  );
  const deals = useLeadsDeals(ids);
  const clients = useMemo(
    () =>
      query.data?.clients.map((c) => ({
        ...c,
        deals: deals.data?.[c.id] ?? [],
      })) ?? [],
    [query.data, deals.data],
  );
  const [selection, setSelection] = useState<string | null>(null);
  const selected = clients.some((c) => c.id === selection)
    ? selection
    : (clients[0]?.id ?? null);
  const purchases = useClientPortfolioPurchases(selected);
  const total = query.data?.total;
  const pages = Math.ceil((total ?? 0) / PORTFOLIO_PAGE_SIZE);
  const loading = query.isLoading || (ids.length > 0 && deals.isLoading);
  const error = query.isError || (ids.length > 0 && deals.isError);
  useEffect(() => {
    if (total !== undefined && page > 0 && page >= pages)
      setPaging({ key: filterKey, page: Math.max(0, pages - 1) });
  }, [total, page, pages, filterKey]);
  return (
    <ClientPortfolio
      clients={clients}
      total={total}
      summary={query.data?.summary}
      now={query.data ? Date.parse(query.data.asOf) : undefined}
      loading={loading}
      error={error}
      onRetry={() => {
        void query.refetch();
        void deals.refetch();
      }}
      search={filters.searchQuery ?? ""}
      onSearch={onSearch}
      segment={segment}
      onSegment={setSegment}
      reorder={reorder}
      onReorder={setReorder}
      selectedId={selected}
      onSelect={setSelection}
      canCreate={canCreate}
      onNewDeal={onNewDeal}
      onOpenLead={onOpenLead}
      onOpenDeal={onOpenDeal}
      purchases={purchases.data}
      purchasesLoading={purchases.isLoading}
      purchasesError={purchases.isError}
      onRetryPurchases={() => {
        void purchases.refetch();
      }}
      filters={filterControls(() => { setSegment("all"); setReorder("all"); })}
      pagination={
        <div
          className="flex items-center justify-between gap-2 px-5 py-4 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <span>
            {total
              ? `${page * PORTFOLIO_PAGE_SIZE + 1}–${page * PORTFOLIO_PAGE_SIZE + clients.length} de ${total.toLocaleString("pt-BR")} clientes`
              : loading
                ? "Carregando clientes…"
                : "Nenhum cliente"}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0 || loading}
              onClick={() => setPaging({ key: filterKey, page: page - 1 })}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pages - 1 || loading}
              onClick={() => setPaging({ key: filterKey, page: page + 1 })}
            >
              Próxima
            </Button>
          </div>
        </div>
      }
    />
  );
}
