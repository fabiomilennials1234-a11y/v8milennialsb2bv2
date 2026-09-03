import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  MessageCircle,
  ClipboardList,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Loader2,
  Users,
  SearchX,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { formatBRL } from "@/lib/format";
import {
  usePortfolioClients,
  type PortfolioClientRow,
  type SortColumn,
} from "@/modules/carteira/hooks/usePortfolioClients";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { useBulkSelection } from "@/shared/hooks/useBulkSelection";
import { erpLabel } from "@/shared/format/erp-code";

export type { PortfolioClientRow };

// ─── Props ──────────────────────────────────────────────────────────────────

interface CarteiraClientTableProps {
  selectedClientId: string | null;
  onSelectClient: (client: PortfolioClientRow | null) => void;
  onNewOrder?: (clientId: string) => void;
  onViewDetail?: (clientId: string) => void;
  searchQuery: string;
  filter: string;
  bulk?: ReturnType<typeof useBulkSelection>;
  onRowsChange?: (rows: PortfolioClientRow[]) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// ─── Helpers ────────────────────────────────────────────────────────────────

function healthConfig(status: string | null, score: number | null) {
  const s = score ?? 0;
  if (status === "saudavel" || (!status && s >= 80))
    return { label: String(s), bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" };
  if (status === "atencao" || (!status && s >= 60))
    return { label: String(s), bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" };
  if (status === "risco" || (!status && s > 0))
    return { label: String(s), bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", dot: "bg-red-500" };
  if (status === "inativo")
    return { label: String(s), bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500" };
  return { label: "—", bg: "bg-muted", text: "text-muted-foreground", dot: "bg-muted-foreground" };
}

function segmentConfig(segment: string | null) {
  switch (segment) {
    case "ouro":
      return { label: "OURO", className: "bg-primary/10 text-primary" };
    case "prata":
      return { label: "PRATA", className: "bg-slate-500/10 text-slate-500" };
    case "novo":
      return { label: "NOVO", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" };
    case "resgate":
      return { label: "RESGATE", className: "bg-red-500/10 text-red-600 dark:text-red-400" };
    case "dormindo":
      return { label: "DORMINDO", className: "bg-muted text-muted-foreground" };
    default:
      return null;
  }
}

function recompraCell(
  daysSinceLast: number | null,
  cycleDays: number | null,
  nextExpected: string | null,
) {
  if (!cycleDays) return { label: "—", className: "text-muted-foreground" };

  if (nextExpected) {
    const diff = Math.round(
      (new Date(nextExpected).getTime() - Date.now()) / 86_400_000,
    );
    if (diff < 0)
      return { label: `${Math.abs(diff)} dias atrasado`, className: "text-destructive font-semibold" };
    if (diff <= 3)
      return { label: `Em ${diff} dias`, className: "text-amber-600 dark:text-amber-400" };
    return { label: `Em ${diff} dias`, className: "text-emerald-600 dark:text-emerald-400" };
  }

  if (daysSinceLast !== null && cycleDays) {
    const overdue = daysSinceLast - cycleDays;
    if (overdue > 0)
      return { label: `${overdue} dias atrasado`, className: "text-destructive font-semibold" };
    const remaining = cycleDays - daysSinceLast;
    if (remaining <= 3)
      return { label: `Em ${remaining} dias`, className: "text-amber-600 dark:text-amber-400" };
    return { label: `Em ${remaining} dias`, className: "text-emerald-600 dark:text-emerald-400" };
  }

  return { label: "—", className: "text-muted-foreground" };
}

async function downloadCSV(
  orgId: string,
  filter: string,
  search: string,
) {
  const { data, error } = await supabase.rpc("get_portfolio_clients", {
    p_org_id: orgId,
    p_filter: filter,
    p_search: search,
    p_sort_by: "name",
    p_sort_dir: "asc",
    p_page: 1,
    p_page_size: 10000,
  });
  if (error) throw error;

  const response = data as { rows: PortfolioClientRow[] };
  const headers = [
    "Nome",
    "Empresa",
    "Health Score",
    "Status",
    "Segmento",
    "Ticket Médio",
    "Dias Sem Pedido",
    "Próximo Pedido",
    "LTV",
    "Tendência",
  ];

  const csvRows = response.rows.map((r) =>
    [
      `"${(r.name ?? "").replace(/"/g, '""')}"`,
      `"${(r.company ?? "").replace(/"/g, '""')}"`,
      r.health_score ?? "",
      r.health_status ?? "",
      r.segment ?? "",
      r.avg_ticket ?? "",
      r.days_since_last_order ?? "",
      r.next_order_expected ? r.next_order_expected.slice(0, 10) : "",
      r.lifetime_value ?? "",
      r.trend ?? "",
    ].join(","),
  );

  const csv = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `carteira-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ──────────────────────────────────────────────────────────────

const iconBtnClass =
  "w-[30px] h-[30px] rounded-md border border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center justify-center";

const thBase =
  "h-auto text-[11px] font-semibold uppercase tracking-wider py-2.5";

export function CarteiraClientTable({
  selectedClientId,
  onSelectClient,
  onNewOrder,
  onViewDetail,
  searchQuery,
  filter,
  bulk,
  onRowsChange,
}: CarteiraClientTableProps) {
  const { organizationId } = useOrganization();
  const [sortBy, setSortBy] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  // Reset page when filter/search changes
  useEffect(() => {
    setPage(1);
    onSelectClient(null);
  }, [filter, searchQuery]);

  const { data, isLoading, isFetching } = usePortfolioClients({
    filter,
    search: searchQuery,
    sortBy: sortBy ?? "name",
    sortDir,
    page,
    pageSize: PAGE_SIZE,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);

  useEffect(() => {
    onRowsChange?.(rows);
  }, [rows]);
  const allChecked = bulk && rows.length > 0 && rows.every((r) => bulk.isSelected(r.id));
  const someChecked = bulk && rows.some((r) => bulk.isSelected(r.id));

  const handleSort = useCallback(
    (col: SortColumn) => {
      if (sortBy === col) {
        if (sortDir === "asc") {
          setSortDir("desc");
        } else {
          setSortBy(null);
          setSortDir("asc");
        }
      } else {
        setSortBy(col);
        setSortDir("asc");
      }
      setPage(1);
      onSelectClient(null);
    },
    [sortBy, sortDir, onSelectClient],
  );

  const handleExport = useCallback(async () => {
    if (!organizationId) return;
    setExporting(true);
    try {
      await downloadCSV(organizationId, filter, searchQuery);
    } finally {
      setExporting(false);
    }
  }, [organizationId, filter, searchQuery]);

  function SortIcon({ col }: { col: SortColumn }) {
    if (sortBy !== col)
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-50" />;
    if (sortDir === "asc") return <ArrowUp className="w-3 h-3 ml-1" />;
    return <ArrowDown className="w-3 h-3 ml-1" />;
  }

  function SortableHeader({
    col,
    label,
    className,
  }: {
    col: SortColumn;
    label: string;
    className?: string;
  }) {
    return (
      <TableHead
        className={cn(
          thBase,
          "cursor-pointer select-none group transition-colors hover:text-muted-foreground",
          sortBy === col ? "text-foreground" : "text-muted-foreground",
          className,
        )}
        onClick={() => handleSort(col)}
      >
        <span className="inline-flex items-center">
          {label}
          <SortIcon col={col} />
        </span>
      </TableHead>
    );
  }

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-3.5 animate-pulse">
              <div className="h-4 bg-muted rounded w-40" />
              <div className="h-4 bg-muted rounded w-14" />
              <div className="h-4 bg-muted rounded w-24" />
              <div className="h-4 bg-muted rounded w-20" />
              <div className="h-4 bg-muted rounded w-16" />
              <div className="h-4 bg-muted rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  if (rows.length === 0 && !isFetching) {
    const hasActiveFilters = filter !== "all" || searchQuery.length > 0;
    return (
      <div className="rounded-xl border border-border bg-card py-20 flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
          {hasActiveFilters ? (
            <SearchX className="w-6 h-6 text-muted-foreground/60" />
          ) : (
            <Users className="w-6 h-6 text-muted-foreground/60" />
          )}
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-muted-foreground">
            {hasActiveFilters
              ? "Nenhum cliente encontrado"
              : "Sua carteira está vazia"}
          </p>
          <p className="text-[13px] text-muted-foreground/60 max-w-[320px]">
            {hasActiveFilters
              ? "Tente ajustar o filtro ou termo de busca."
              : "Use os botões acima para cadastrar, importar uma planilha ou marcar propostas como vendidas."}
          </p>
        </div>
      </div>
    );
  }

  // ── Pagination range ────────────────────────────────────────────────────
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-0">
      {/* Export button */}
      <div className="flex justify-end mb-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting || total === 0}
          className="gap-2 text-[13px]"
        >
          {exporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          Exportar
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent bg-muted/50">
              {bulk && (
                <TableHead className={cn(thBase, "w-10 pl-3 pr-0")}>
                  <button
                    onClick={() => bulk.selectAll(rowIds)}
                    className={cn(
                      "w-5 h-5 rounded border flex items-center justify-center transition-all",
                      allChecked
                        ? "bg-primary border-primary text-black"
                        : someChecked
                          ? "border-primary/60 bg-primary/20"
                          : "border-border hover:border-muted-foreground",
                    )}
                  >
                    {(allChecked || someChecked) && <Check className="w-3 h-3" />}
                  </button>
                </TableHead>
              )}
              <SortableHeader col="name" label="Cliente" className={bulk ? "" : "pl-4"} />
              <SortableHeader col="health_score" label="Health" />
              <SortableHeader col="days_since_last_order" label="Recompra" />
              <SortableHeader col="avg_ticket" label="Ticket médio" />
              <TableHead className={cn(thBase, "text-muted-foreground")}>
                Tendência
              </TableHead>
              <TableHead className={cn(thBase, "text-muted-foreground")}>
                Segmento
              </TableHead>
              <TableHead
                className={cn(thBase, "text-muted-foreground pr-4 w-[100px]")}
              />
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((client) => {
              const isSelected = client.id === selectedClientId;
              const health = healthConfig(
                client.health_status,
                client.health_score,
              );
              const segment = segmentConfig(client.segment);
              const recompra = recompraCell(
                client.days_since_last_order,
                client.reorder_cycle_days,
                client.next_order_expected,
              );

              const bulkChecked = bulk?.isSelected(client.id);

              return (
                <TableRow
                  key={client.id}
                  onClick={() => onSelectClient(isSelected ? null : client)}
                  className={cn(
                    "border-border cursor-pointer transition-colors group/row",
                    isSelected ? "bg-muted" : "hover:bg-muted/50",
                    bulkChecked && "bg-primary/5",
                  )}
                >
                  {bulk && (
                    <TableCell className="py-3 pl-3 pr-0 w-10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (e.shiftKey) bulk.toggleRange(client.id, rowIds);
                          else bulk.toggle(client.id);
                        }}
                        className={cn(
                          "w-5 h-5 rounded border flex items-center justify-center transition-all",
                          bulkChecked
                            ? "bg-primary border-primary text-black"
                            : "border-border opacity-0 group-hover/row:opacity-100",
                        )}
                      >
                        {bulkChecked && <Check className="w-3 h-3" />}
                      </button>
                    </TableCell>
                  )}
                  <TableCell className={cn("py-3", bulk ? "" : "pl-4")}>
                    <div className="flex flex-col gap-px min-w-0">
                      <span
                        className="text-sm font-semibold text-foreground truncate max-w-[220px]"
                        title={erpLabel(client)}
                      >
                        {erpLabel(client)}
                      </span>
                      <span className="text-xs text-muted-foreground truncate max-w-[220px]">
                        {[
                          client.order_count
                            ? `${client.order_count} pedido${client.order_count !== 1 ? "s" : ""}`
                            : null,
                          client.company,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className="py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium",
                        health.bg,
                        health.text,
                      )}
                    >
                      <span
                        className={cn("w-1.5 h-1.5 rounded-full", health.dot)}
                      />
                      {health.label}
                    </span>
                  </TableCell>

                  <TableCell className="py-3">
                    <span className={cn("text-[13px]", recompra.className)}>
                      {recompra.label}
                    </span>
                  </TableCell>

                  <TableCell className="py-3">
                    <span
                      className={cn(
                        "text-sm",
                        client.avg_ticket != null
                          ? "text-foreground"
                          : "text-muted-foreground/30",
                      )}
                    >
                      {client.avg_ticket != null
                        ? formatBRL(client.avg_ticket)
                        : "—"}
                    </span>
                  </TableCell>

                  <TableCell className="py-3">
                    {client.trend === "up" && (
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
                        <TrendingUp className="w-3.5 h-3.5" />
                        Subindo
                      </span>
                    )}
                    {client.trend === "down" && (
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-destructive">
                        <TrendingDown className="w-3.5 h-3.5" />
                        Caindo
                      </span>
                    )}
                    {client.trend === "stable" && (
                      <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
                        <Minus className="w-3.5 h-3.5" />
                        Estável
                      </span>
                    )}
                    {!client.trend && (
                      <span className="text-[13px] text-muted-foreground/30">—</span>
                    )}
                  </TableCell>

                  <TableCell className="py-3">
                    {segment ? (
                      <span
                        className={cn(
                          "px-2.5 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide",
                          segment.className,
                        )}
                      >
                        {segment.label}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>

                  <TableCell className="py-3 pr-4">
                    <div className="flex gap-1">
                      {/* Cliente sem lead vinculado não tem Conversa do Lead.
                          A prop `onWhatsApp` deixou de existir: o botão resolve
                          a caixa aqui, em vez de o pai improvisar a navegação. */}
                      {client.lead_id && (
                        <AbrirConversaButton
                          leadId={client.lead_id}
                          phone={client.phone}
                          className={iconBtnClass}
                          title="WhatsApp"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </AbrirConversaButton>
                      )}
                      {onNewOrder && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onNewOrder(client.id);
                          }}
                          className={iconBtnClass}
                          title="Novo pedido"
                        >
                          <ClipboardList className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onViewDetail && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewDetail(client.id);
                          }}
                          className={iconBtnClass}
                          title="Detalhes"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Pagination bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
            <span className="text-[13px] text-muted-foreground tabular-nums">
              Mostrando {from}–{to} de {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPage((p) => p - 1);
                  onSelectClient(null);
                }}
                disabled={page <= 1}
                className="h-7 px-2 text-[13px] gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Anterior
              </Button>
              <span className="text-[13px] text-muted-foreground tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPage((p) => p + 1);
                  onSelectClient(null);
                }}
                disabled={page >= totalPages}
                className="h-7 px-2 text-[13px] gap-1"
              >
                Próxima
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
