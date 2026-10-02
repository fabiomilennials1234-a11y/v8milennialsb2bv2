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

/*
 * V5 (2026-10): esta tabela mora DENTRO do painel-herói em tinta (ver
 * `pages/Upsell.tsx`). Tinta é escura nos dois temas, então as cores daqui são
 * escolhidas para fundo escuro — e a linha selecionada vira ouro, com a cor da
 * tinta do cartão de ouro (`primary-foreground`). Nenhuma faixa mudou: os
 * limiares de health, recompra e segmento são os mesmos de antes; só o par de
 * cores é que agora vem de token.
 *
 * Sobre o ouro, cor semântica vira ruído (âmbar some no amarelo). Lá a régua é
 * outra: o estado grave vira pílula invertida (tinta cheia), o resto fica na
 * cor do cartão. O detalhe com as cores completas está no cartão ao lado.
 */

type HealthTone = "good" | "warn" | "bad" | "idle" | "none";

function healthConfig(status: string | null, score: number | null): { label: string; tone: HealthTone } {
  const s = score ?? 0;
  if (status === "saudavel" || (!status && s >= 80)) return { label: String(s), tone: "good" };
  if (status === "atencao" || (!status && s >= 60)) return { label: String(s), tone: "warn" };
  if (status === "risco" || (!status && s > 0)) return { label: String(s), tone: "bad" };
  if (status === "inativo") return { label: String(s), tone: "idle" };
  return { label: "—", tone: "none" };
}

const HEALTH_ON_INK: Record<HealthTone, { chip: string; dot: string }> = {
  good: { chip: "bg-success/15 text-success", dot: "bg-success" },
  warn: { chip: "bg-warning/15 text-warning", dot: "bg-warning" },
  bad: { chip: "bg-destructive/15 text-destructive", dot: "bg-destructive" },
  idle: { chip: "bg-white/[.08] text-tinta-foreground", dot: "bg-insights" },
  none: { chip: "bg-white/[.06] text-tinta-muted", dot: "bg-tinta-muted" },
};

function segmentConfig(segment: string | null) {
  switch (segment) {
    case "ouro":
      return { label: "OURO", className: "bg-primary/15 text-primary" };
    case "prata":
      return { label: "PRATA", className: "bg-silver/20 text-tinta-foreground" };
    case "novo":
      return { label: "NOVO", className: "bg-insights/30 text-tinta-foreground" };
    case "resgate":
      return { label: "RESGATE", className: "bg-destructive/20 text-destructive" };
    case "dormindo":
      return { label: "DORMINDO", className: "bg-white/[.08] text-tinta-muted" };
    default:
      return null;
  }
}

type RecompraTone = "late" | "soon" | "ok" | "none";

function recompraCell(
  daysSinceLast: number | null,
  cycleDays: number | null,
  nextExpected: string | null,
): { label: string; tone: RecompraTone } {
  if (!cycleDays) return { label: "—", tone: "none" };

  if (nextExpected) {
    const diff = Math.round(
      (new Date(nextExpected).getTime() - Date.now()) / 86_400_000,
    );
    if (diff < 0)
      return { label: `${Math.abs(diff)} dias atrasado`, tone: "late" };
    if (diff <= 3)
      return { label: `Em ${diff} dias`, tone: "soon" };
    return { label: `Em ${diff} dias`, tone: "ok" };
  }

  if (daysSinceLast !== null && cycleDays) {
    const overdue = daysSinceLast - cycleDays;
    if (overdue > 0)
      return { label: `${overdue} dias atrasado`, tone: "late" };
    const remaining = cycleDays - daysSinceLast;
    if (remaining <= 3)
      return { label: `Em ${remaining} dias`, tone: "soon" };
    return { label: `Em ${remaining} dias`, tone: "ok" };
  }

  return { label: "—", tone: "none" };
}

const RECOMPRA_ON_INK: Record<RecompraTone, string> = {
  late: "font-semibold text-destructive",
  soon: "text-warning",
  ok: "text-success",
  none: "text-tinta-muted",
};

const RECOMPRA_ON_GOLD: Record<RecompraTone, string> = {
  late: "rounded-full bg-primary-foreground px-2 py-0.5 font-bold text-primary",
  soon: "font-semibold",
  ok: "",
  none: "opacity-60",
};

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

/** Botão quadrado de ação da linha — sobre tinta ou sobre o ouro da selecionada. */
function iconBtnClass(onGold: boolean) {
  return cn(
    "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border p-0 shadow-none transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 [&_svg]:size-3.5",
    onGold
      ? "border-primary-foreground/15 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground focus-visible:ring-primary-foreground"
      : "border-white/10 bg-transparent text-tinta-muted hover:bg-white/10 hover:text-tinta-foreground focus-visible:ring-primary",
  );
}

const thBase =
  "h-auto whitespace-nowrap border-b border-tinta-line py-2.5 text-[11px] font-bold uppercase tracking-[.06em]";

/** Linha da tabela no vocabulário do InkRow: sem divisória, cantos de pílula. */
const rowBase =
  "group/row cursor-pointer border-0 hover:bg-transparent [&>td]:transition-colors [&>td:first-child]:rounded-l-2xl [&>td:last-child]:rounded-r-2xl";

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

  // Memoizado porque a identidade importa duas vezes logo abaixo: `rowIds` é um
  // useMemo com `[rows]` na dependência, e o efeito que chama `onRowsChange`
  // também. Com `data?.rows ?? []` cru, o `[]` do ramo vazio nasce novo a cada
  // render e os dois disparam sem que nada tenha mudado.
  const rows = useMemo(() => data?.rows ?? [], [data]);
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
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-60" />;
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
          "cursor-pointer select-none group transition-colors hover:text-tinta-foreground",
          sortBy === col ? "text-tinta-foreground" : "text-tinta-muted",
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
      <div className="space-y-1.5 p-1.5" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-4 rounded-2xl px-3 py-3.5 animate-pulse">
            <div className="h-4 w-40 rounded bg-white/[.08]" />
            <div className="h-4 w-14 rounded bg-white/[.08]" />
            <div className="h-4 w-24 rounded bg-white/[.08]" />
            <div className="h-4 w-20 rounded bg-white/[.08]" />
            <div className="h-4 w-16 rounded bg-white/[.08]" />
            <div className="h-4 w-16 rounded bg-white/[.08]" />
          </div>
        ))}
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  if (rows.length === 0 && !isFetching) {
    const hasActiveFilters = filter !== "all" || searchQuery.length > 0;
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[.08] text-primary">
          {hasActiveFilters ? (
            <SearchX className="h-6 w-6" />
          ) : (
            <Users className="h-6 w-6" />
          )}
        </div>
        <div className="space-y-1 text-center">
          <p className="text-sm font-bold text-tinta-foreground">
            {hasActiveFilters
              ? "Nenhum cliente encontrado"
              : "Sua carteira está vazia"}
          </p>
          <p className="max-w-[320px] text-[13px] text-tinta-muted">
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
    <div className="min-w-0">
      {/* Cabeçalho do painel: título, total e exportar. */}
      <div className="flex flex-wrap items-center gap-2 px-1.5 pb-3 pt-1">
        <h2 className="text-base font-bold tracking-tight text-tinta-foreground">Clientes</h2>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-tinta-foreground">
          {total.toLocaleString("pt-BR")}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExport}
          disabled={exporting || total === 0}
          className="h-8 gap-1.5 rounded-full border border-white/10 bg-white/[.06] px-3 text-[12px] text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground"
        >
          {exporting ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Download />
          )}
          Exportar
        </Button>
      </div>

      <Table className="border-separate border-spacing-x-0 border-spacing-y-0.5">
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            {bulk && (
              <TableHead className={cn(thBase, "w-10 pl-3 pr-0")}>
                <button
                  type="button"
                  onClick={() => bulk.selectAll(rowIds)}
                  aria-label="Selecionar todos desta página"
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-md border transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    allChecked
                      ? "border-primary bg-primary text-primary-foreground"
                      : someChecked
                        ? "border-primary/60 bg-primary/25 text-primary"
                        : "border-white/25 hover:border-white/50",
                  )}
                >
                  {(allChecked || someChecked) && <Check className="h-3 w-3" />}
                </button>
              </TableHead>
            )}
            <SortableHeader col="name" label="Cliente" className={bulk ? "" : "pl-4"} />
            <SortableHeader col="health_score" label="Health" />
            <SortableHeader col="days_since_last_order" label="Recompra" />
            <SortableHeader col="avg_ticket" label="Ticket médio" />
            <TableHead className={cn(thBase, "text-tinta-muted")}>
              Tendência
            </TableHead>
            <TableHead className={cn(thBase, "text-tinta-muted")}>
              Segmento
            </TableHead>
            <TableHead
              className={cn(thBase, "w-[100px] pr-4 text-tinta-muted")}
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
            const healthStyle = HEALTH_ON_INK[health.tone];
            const segment = segmentConfig(client.segment);
            const recompra = recompraCell(
              client.days_since_last_order,
              client.reorder_cycle_days,
              client.next_order_expected,
            );

            const bulkChecked = bulk?.isSelected(client.id);
            const subText = isSelected ? "text-primary-foreground/70" : "text-tinta-muted";
            const faint = isSelected ? "text-primary-foreground/40" : "text-tinta-muted/50";

            return (
              <TableRow
                key={client.id}
                onClick={() => onSelectClient(isSelected ? null : client)}
                className={cn(
                  rowBase,
                  isSelected
                    ? "[&>td]:bg-primary [&>td]:text-primary-foreground"
                    : bulkChecked
                      ? "[&>td]:bg-white/[.07] [&:hover>td]:bg-white/[.09]"
                      : "[&:hover>td]:bg-white/[.04]",
                )}
              >
                {bulk && (
                  <TableCell className="w-10 py-3 pl-3 pr-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.shiftKey) bulk.toggleRange(client.id, rowIds);
                        else bulk.toggle(client.id);
                      }}
                      aria-label={`Selecionar ${erpLabel(client)}`}
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-md border transition-all",
                        "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        bulkChecked
                          ? isSelected
                            ? "border-primary-foreground bg-primary-foreground text-primary"
                            : "border-primary bg-primary text-primary-foreground"
                          : isSelected
                            ? "border-primary-foreground/40 opacity-0 group-hover/row:opacity-100"
                            : "border-white/25 opacity-0 group-hover/row:opacity-100",
                      )}
                    >
                      {bulkChecked && <Check className="h-3 w-3" />}
                    </button>
                  </TableCell>
                )}
                <TableCell className={cn("py-3", bulk ? "" : "pl-4")}>
                  <div className="flex min-w-0 flex-col gap-px">
                    <span
                      className="max-w-[220px] truncate text-sm font-semibold"
                      title={erpLabel(client)}
                    >
                      {erpLabel(client)}
                    </span>
                    <span className={cn("max-w-[220px] truncate text-xs", subText)}>
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
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums",
                      isSelected ? "bg-primary-foreground/10 text-primary-foreground" : healthStyle.chip,
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        isSelected ? "bg-primary-foreground" : healthStyle.dot,
                      )}
                    />
                    {health.label}
                  </span>
                </TableCell>

                <TableCell className="py-3">
                  <span
                    className={cn(
                      "whitespace-nowrap text-[13px]",
                      isSelected ? RECOMPRA_ON_GOLD[recompra.tone] : RECOMPRA_ON_INK[recompra.tone],
                    )}
                  >
                    {recompra.label}
                  </span>
                </TableCell>

                <TableCell className="py-3">
                  <span
                    className={cn(
                      "text-sm tabular-nums",
                      client.avg_ticket == null && faint,
                    )}
                  >
                    {client.avg_ticket != null
                      ? formatBRL(client.avg_ticket)
                      : "—"}
                  </span>
                </TableCell>

                <TableCell className="py-3">
                  {client.trend === "up" && (
                    <span className={cn("inline-flex items-center gap-1 text-[13px] font-medium", !isSelected && "text-success")}>
                      <TrendingUp className="h-3.5 w-3.5" />
                      Subindo
                    </span>
                  )}
                  {client.trend === "down" && (
                    <span className={cn("inline-flex items-center gap-1 text-[13px] font-medium", isSelected ? "font-bold" : "text-destructive")}>
                      <TrendingDown className="h-3.5 w-3.5" />
                      Caindo
                    </span>
                  )}
                  {client.trend === "stable" && (
                    <span className={cn("inline-flex items-center gap-1 text-[13px]", subText)}>
                      <Minus className="h-3.5 w-3.5" />
                      Estável
                    </span>
                  )}
                  {!client.trend && (
                    <span className={cn("text-[13px]", faint)}>—</span>
                  )}
                </TableCell>

                <TableCell className="py-3">
                  {segment ? (
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[.06em]",
                        isSelected ? "bg-primary-foreground/10 text-primary-foreground" : segment.className,
                      )}
                    >
                      {segment.label}
                    </span>
                  ) : (
                    <span className={cn("text-sm", faint)}>—</span>
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
                        variant="ghost"
                        size="icon"
                        className={iconBtnClass(isSelected)}
                        title="WhatsApp"
                      >
                        <MessageCircle />
                      </AbrirConversaButton>
                    )}
                    {onNewOrder && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNewOrder(client.id);
                        }}
                        className={iconBtnClass(isSelected)}
                        title="Novo pedido"
                      >
                        <ClipboardList />
                      </button>
                    )}
                    {onViewDetail && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewDetail(client.id);
                        }}
                        className={iconBtnClass(isSelected)}
                        title="Detalhes"
                      >
                        <ChevronRight />
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
        <div className="mt-2 flex items-center justify-between border-t border-tinta-line px-3 pt-3">
          <span className="text-[13px] tabular-nums text-tinta-muted">
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
              className="h-8 gap-1 px-2.5 text-[13px] text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Anterior
            </Button>
            <span className="text-[13px] tabular-nums text-tinta-muted">
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
              className="h-8 gap-1 px-2.5 text-[13px] text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground"
            >
              Próxima
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
