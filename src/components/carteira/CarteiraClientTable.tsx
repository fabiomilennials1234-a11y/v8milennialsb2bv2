import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import {
  usePortfolioClients,
  type PortfolioClientRow,
  type SortColumn,
} from "@/hooks/usePortfolioClients";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export type { PortfolioClientRow };

// ─── Props ──────────────────────────────────────────────────────────────────

interface CarteiraClientTableProps {
  selectedClientId: string | null;
  onSelectClient: (client: PortfolioClientRow | null) => void;
  onWhatsApp?: (client: PortfolioClientRow) => void;
  onNewOrder?: (clientId: string) => void;
  onViewDetail?: (clientId: string) => void;
  searchQuery: string;
  filter: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// ─── Helpers ────────────────────────────────────────────────────────────────

function healthConfig(status: string | null, score: number | null) {
  const s = score ?? 0;
  if (status === "saudavel" || (!status && s >= 80))
    return { label: String(s), bg: "bg-[#052e16]", text: "text-[#22c55e]", dot: "bg-[#22c55e]" };
  if (status === "atencao" || (!status && s >= 60))
    return { label: String(s), bg: "bg-[#422006]", text: "text-[#f59e0b]", dot: "bg-[#f59e0b]" };
  if (status === "risco" || (!status && s > 0))
    return { label: String(s), bg: "bg-[#450a0a]", text: "text-[#ef4444]", dot: "bg-[#ef4444]" };
  if (status === "inativo")
    return { label: String(s), bg: "bg-[#172554]", text: "text-[#3b82f6]", dot: "bg-[#3b82f6]" };
  return { label: "—", bg: "bg-zinc-800", text: "text-zinc-500", dot: "bg-zinc-500" };
}

function segmentConfig(segment: string | null) {
  switch (segment) {
    case "ouro":
      return { label: "OURO", className: "bg-[#422006] text-[#eab308]" };
    case "prata":
      return { label: "PRATA", className: "bg-[#1e293b] text-[#94a3b8]" };
    case "novo":
      return { label: "NOVO", className: "bg-[#172554] text-[#60a5fa]" };
    case "resgate":
      return { label: "RESGATE", className: "bg-[#450a0a] text-[#f87171]" };
    case "dormindo":
      return { label: "DORMINDO", className: "bg-zinc-800 text-zinc-400" };
    default:
      return null;
  }
}

function recompraCell(
  daysSinceLast: number | null,
  cycleDays: number | null,
  nextExpected: string | null,
) {
  if (!cycleDays) return { label: "—", className: "text-[#71717a]" };

  if (nextExpected) {
    const diff = Math.round(
      (new Date(nextExpected).getTime() - Date.now()) / 86_400_000,
    );
    if (diff < 0)
      return { label: `${Math.abs(diff)} dias atrasado`, className: "text-[#ef4444] font-semibold" };
    if (diff <= 3)
      return { label: `Em ${diff} dias`, className: "text-[#f59e0b]" };
    return { label: `Em ${diff} dias`, className: "text-[#22c55e]" };
  }

  if (daysSinceLast !== null && cycleDays) {
    const overdue = daysSinceLast - cycleDays;
    if (overdue > 0)
      return { label: `${overdue} dias atrasado`, className: "text-[#ef4444] font-semibold" };
    const remaining = cycleDays - daysSinceLast;
    if (remaining <= 3)
      return { label: `Em ${remaining} dias`, className: "text-[#f59e0b]" };
    return { label: `Em ${remaining} dias`, className: "text-[#22c55e]" };
  }

  return { label: "—", className: "text-[#71717a]" };
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
  "w-[30px] h-[30px] rounded-md border border-[#3f3f46] bg-transparent text-[#a1a1aa] hover:bg-[#27272a] hover:text-[#fafafa] transition-colors flex items-center justify-center";

const thBase =
  "h-auto text-[11px] font-semibold uppercase tracking-wider py-2.5";

export function CarteiraClientTable({
  selectedClientId,
  onSelectClient,
  onWhatsApp,
  onNewOrder,
  onViewDetail,
  searchQuery,
  filter,
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
          "cursor-pointer select-none group transition-colors hover:text-[#a1a1aa]",
          sortBy === col ? "text-[#fafafa]" : "text-[#71717a]",
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
      <div className="rounded-xl border border-[#27272a] bg-[#18181b] overflow-hidden">
        <div className="divide-y divide-[#27272a]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-3.5 animate-pulse">
              <div className="h-4 bg-zinc-800 rounded w-40" />
              <div className="h-4 bg-zinc-800 rounded w-14" />
              <div className="h-4 bg-zinc-800 rounded w-24" />
              <div className="h-4 bg-zinc-800 rounded w-20" />
              <div className="h-4 bg-zinc-800 rounded w-16" />
              <div className="h-4 bg-zinc-800 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  if (rows.length === 0 && !isFetching) {
    return (
      <div className="rounded-xl border border-[#27272a] bg-[#18181b] py-16 text-center">
        <p className="text-sm text-[#71717a]">Nenhum cliente encontrado.</p>
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

      <div className="rounded-xl border border-[#27272a] bg-[#18181b] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-[#27272a] hover:bg-transparent bg-[#111113]">
              <SortableHeader col="name" label="Cliente" className="pl-4" />
              <SortableHeader col="health_score" label="Health" />
              <SortableHeader col="days_since_last_order" label="Recompra" />
              <SortableHeader col="avg_ticket" label="Ticket médio" />
              <TableHead className={cn(thBase, "text-[#71717a]")}>
                Tendência
              </TableHead>
              <TableHead className={cn(thBase, "text-[#71717a]")}>
                Segmento
              </TableHead>
              <TableHead
                className={cn(thBase, "text-[#71717a] pr-4 w-[100px]")}
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

              return (
                <TableRow
                  key={client.id}
                  onClick={() => onSelectClient(isSelected ? null : client)}
                  className={cn(
                    "border-[#1e1e21] cursor-pointer transition-colors",
                    isSelected ? "bg-[#232326]" : "hover:bg-[#1c1c1f]",
                  )}
                >
                  <TableCell className="py-3 pl-4">
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-sm font-semibold text-[#fafafa] truncate max-w-[220px]">
                        {client.name}
                      </span>
                      <span className="text-xs text-[#71717a] truncate max-w-[220px]">
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
                          ? "text-[#fafafa]"
                          : "text-[#3f3f46]",
                      )}
                    >
                      {client.avg_ticket != null
                        ? formatBRL(client.avg_ticket)
                        : "—"}
                    </span>
                  </TableCell>

                  <TableCell className="py-3">
                    {client.trend === "up" && (
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-[#22c55e]">
                        <TrendingUp className="w-3.5 h-3.5" />
                        Subindo
                      </span>
                    )}
                    {client.trend === "down" && (
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-[#ef4444]">
                        <TrendingDown className="w-3.5 h-3.5" />
                        Caindo
                      </span>
                    )}
                    {client.trend === "stable" && (
                      <span className="inline-flex items-center gap-1 text-[13px] text-[#71717a]">
                        <Minus className="w-3.5 h-3.5" />
                        Estável
                      </span>
                    )}
                    {!client.trend && (
                      <span className="text-[13px] text-[#3f3f46]">—</span>
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
                      <span className="text-[#71717a] text-sm">—</span>
                    )}
                  </TableCell>

                  <TableCell className="py-3 pr-4">
                    <div className="flex gap-1">
                      {onWhatsApp && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onWhatsApp(client);
                          }}
                          className={iconBtnClass}
                          title="WhatsApp"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </button>
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
          <div className="flex items-center justify-between border-t border-[#27272a] px-4 py-2.5">
            <span className="text-[13px] text-[#71717a] tabular-nums">
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
              <span className="text-[13px] text-[#a1a1aa] tabular-nums">
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
