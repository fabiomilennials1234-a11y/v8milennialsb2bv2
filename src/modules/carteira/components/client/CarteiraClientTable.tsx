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
import type { useBulkSelection } from "@/shared/hooks/useBulkSelection";
import { erpLabel } from "@/shared/format/erp-code";

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
 * V5 (mockup, 02/10): a tabela saiu do painel em tinta e virou cartão BRANCO
 * — o herói da tela agora é o Radar de recompra, acima dela. As faixas de
 * health, recompra e segmento são as mesmas de antes; o que muda é a forma:
 * anel de health, ciclo com barra (dias sem pedido ÷ ciclo), dias sem pedido em
 * destaque e a próxima compra com data + relativo.
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

const HEALTH_STROKE: Record<HealthTone, string> = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  idle: "text-insights",
  none: "text-muted-foreground/40",
};

const SEGMENT_DOT: Record<string, string> = {
  ouro: "bg-primary",
  prata: "bg-silver",
  novo: "bg-insights",
  resgate: "bg-chart-5",
  dormindo: "bg-muted-foreground",
};

const SEGMENT_LABEL: Record<string, string> = {
  ouro: "Ouro",
  prata: "Prata",
  novo: "Novos",
  resgate: "Resgate",
  dormindo: "Dormindo",
};

/** Dias até a próxima compra (negativo = atrasado). */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

function initials(text: string): string {
  return (
    text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/** Anel de health 34 px. */
function HealthRing({ score, tone }: { score: number | null; tone: HealthTone }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, score ?? 0));
  return (
    <span className="relative inline-grid size-[34px] place-items-center" role="img" aria-label={score != null ? `Health ${score}` : "Sem health"}>
      <svg className="absolute inset-0 size-[34px] -rotate-90" viewBox="0 0 34 34" aria-hidden>
        <circle cx="17" cy="17" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-muted" />
        {score != null && (
          <circle
            cx="17"
            cy="17"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`}
            className={HEALTH_STROKE[tone]}
          />
        )}
      </svg>
      <span className="text-[10.5px] font-extrabold tabular-nums">{score ?? "—"}</span>
    </span>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

const iconBtnClass = cn(
  "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-input bg-card p-0 text-muted-foreground shadow-relevo transition-colors",
  "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5",
);

const thBase =
  "h-11 whitespace-nowrap border-b border-border py-2.5 text-[11px] font-bold uppercase tracking-[.06em]";

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
  const [sortBy, setSortBy] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

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
          "cursor-pointer select-none group transition-colors hover:text-foreground",
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
      <div className="divide-y divide-border/60" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-4 animate-pulse">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-4 w-14 rounded bg-muted" />
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-4 w-20 rounded bg-muted" />
            <div className="h-4 w-16 rounded bg-muted" />
            <div className="h-4 w-16 rounded bg-muted" />
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
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
          {hasActiveFilters ? (
            <SearchX className="h-6 w-6" />
          ) : (
            <Users className="h-6 w-6" />
          )}
        </div>
        <div className="space-y-1 text-center">
          <p className="text-sm font-bold text-foreground">
            {hasActiveFilters
              ? "Nenhum cliente encontrado"
              : "Sua carteira está vazia"}
          </p>
          <p className="max-w-[320px] text-[13px] text-muted-foreground">
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
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            {bulk && (
              <TableHead className={cn(thBase, "w-10 pl-4 pr-0")}>
                <button
                  type="button"
                  onClick={() => bulk.selectAll(rowIds)}
                  aria-label="Selecionar todos desta página"
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-[5px] border-[1.5px] transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    allChecked
                      ? "border-tinta bg-tinta text-tinta-foreground"
                      : someChecked
                        ? "border-tinta/60 bg-tinta/20 text-foreground"
                        : "border-border hover:border-foreground/40",
                  )}
                >
                  {(allChecked || someChecked) && <Check className="h-3 w-3" />}
                </button>
              </TableHead>
            )}
            <SortableHeader col="name" label="Cliente" className={bulk ? "" : "pl-4"} />
            <SortableHeader col="health_score" label="Health" />
            <SortableHeader col="avg_ticket" label="Ticket médio" />
            <TableHead className={cn(thBase, "text-muted-foreground")}>Recompra (ciclo)</TableHead>
            <SortableHeader col="days_since_last_order" label="Dias sem pedido" />
            <SortableHeader col="next_order_expected" label="Próximo pedido" />
            <TableHead className={cn(thBase, "w-[112px] pr-4")} aria-label="Ações" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((client) => {
            const isSelected = client.id === selectedClientId;
            const health = healthConfig(client.health_status, client.health_score);
            const next = daysUntil(client.next_order_expected);
            const cycle = client.reorder_cycle_days ?? null;
            const since = client.days_since_last_order ?? null;
            const atrasado = next != null ? next < 0 : !!(cycle && since != null && since > cycle);
            const progresso = cycle && since != null ? Math.min(1, since / cycle) : null;
            const bulkChecked = bulk?.isSelected(client.id);
            const segLabel = client.segment ? SEGMENT_LABEL[client.segment] ?? client.segment : null;

            return (
              <TableRow
                key={client.id}
                onClick={() => onSelectClient(isSelected ? null : client)}
                aria-selected={isSelected}
                className={cn(
                  "group/row cursor-pointer border-border/60 transition-colors",
                  isSelected ? "bg-primary-soft/70 hover:bg-primary-soft" : bulkChecked ? "bg-muted/50" : "hover:bg-muted/40",
                )}
              >
                {bulk && (
                  <TableCell className="w-10 py-3 pl-4 pr-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (e.shiftKey) bulk.toggleRange(client.id, rowIds);
                        else bulk.toggle(client.id);
                      }}
                      aria-label={`Selecionar ${erpLabel(client)}`}
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-[5px] border-[1.5px] transition-all",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        bulkChecked ? "border-tinta bg-tinta text-tinta-foreground" : "border-border hover:border-foreground/40",
                      )}
                    >
                      {bulkChecked && <Check className="h-3 w-3" />}
                    </button>
                  </TableCell>
                )}

                {/* Cliente — ladrilho, nome, empresa e o segmento como tag */}
                <TableCell className={cn("py-3", bulk ? "" : "pl-4")}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-muted text-[11px] font-extrabold text-foreground/70">
                      {initials(erpLabel(client))}
                    </span>
                    <div className="min-w-0 leading-tight">
                      <p className="max-w-[260px] truncate text-[13px] font-bold" title={erpLabel(client)}>
                        {erpLabel(client)}
                      </p>
                      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="max-w-[160px] truncate">
                          {[client.company, client.order_count ? `${client.order_count} pedido${client.order_count !== 1 ? "s" : ""}` : null]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                        {segLabel && (
                          <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[6px] bg-muted px-1.5 text-[10.5px] font-bold text-foreground/75">
                            <span aria-hidden className={cn("size-1.5 rounded-[2px]", SEGMENT_DOT[client.segment ?? ""] ?? "bg-muted-foreground")} />
                            {segLabel}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="py-3">
                  <HealthRing score={client.health_score} tone={health.tone} />
                </TableCell>

                {/* Ticket médio + a tendência como seta */}
                <TableCell className="py-3">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-bold tabular-nums">
                    {client.avg_ticket != null ? formatBRL(client.avg_ticket) : <span className="font-normal text-muted-foreground/60">—</span>}
                    {client.trend === "up" && <TrendingUp className="size-3.5 text-success-strong" aria-label="Subindo" />}
                    {client.trend === "down" && <TrendingDown className="size-3.5 text-destructive" aria-label="Caindo" />}
                    {client.trend === "stable" && <Minus className="size-3.5 text-muted-foreground" aria-label="Estável" />}
                  </span>
                </TableCell>

                {/* Ciclo + barra dias-sem-pedido ÷ ciclo */}
                <TableCell className="py-3">
                  {cycle ? (
                    <div className="w-[130px]">
                      <p className="text-[12.5px] font-semibold">a cada {cycle} dias</p>
                      <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            atrasado ? "bg-destructive" : (progresso ?? 0) > 0.75 ? "bg-primary" : "bg-tinta dark:bg-foreground/70",
                          )}
                          style={{ width: `${Math.max(4, (atrasado ? 1 : progresso ?? 0) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-[13px] text-muted-foreground/60">—</span>
                  )}
                </TableCell>

                <TableCell className="py-3">
                  {since != null ? (
                    <span className="whitespace-nowrap">
                      <b className={cn("text-[15px] font-extrabold tabular-nums", atrasado && "text-destructive")}>{since}</b>
                      <span className="ml-1 text-[11px] text-muted-foreground">{since === 1 ? "dia" : "dias"}</span>
                    </span>
                  ) : (
                    <span className="text-[13px] text-muted-foreground/60">—</span>
                  )}
                </TableCell>

                <TableCell className="py-3">
                  {client.next_order_expected ? (
                    <div className="leading-tight">
                      <p className={cn("text-[13px] font-bold tabular-nums", atrasado && "text-destructive")}>
                        {new Date(client.next_order_expected).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {next == null ? "" : next < 0 ? `atrasado ${Math.abs(next)} d` : next === 0 ? "hoje" : `em ${next} ${next === 1 ? "dia" : "dias"}`}
                      </p>
                    </div>
                  ) : (
                    <div className="leading-tight">
                      <p className="text-[13px] text-muted-foreground/60">—</p>
                      <p className="text-[11px] text-muted-foreground">sem previsão</p>
                    </div>
                  )}
                </TableCell>

                {/* Ações — aparecem no hover (e no foco por teclado) */}
                <TableCell className="py-3 pr-4">
                  <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 max-md:opacity-100">
                    {/* Cliente sem lead vinculado não tem Conversa do Lead. */}
                    {client.lead_id && (
                      <AbrirConversaButton
                        leadId={client.lead_id}
                        phone={client.phone}
                        variant="ghost"
                        size="icon"
                        className={iconBtnClass}
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
                        className={iconBtnClass}
                        title="Novo pedido"
                        aria-label={`Novo pedido para ${erpLabel(client)}`}
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
                        className={iconBtnClass}
                        title="Detalhes"
                        aria-label={`Abrir ${erpLabel(client)}`}
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
      </div>

      {/* Rodapé */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <span className="text-[13px] tabular-nums text-muted-foreground">
          Mostrando {from}–{to} de {total.toLocaleString("pt-BR")} clientes
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPage((p) => p - 1);
                onSelectClient(null);
              }}
              disabled={page <= 1}
              className="h-8 gap-1 px-2.5 text-[13px]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Anterior
            </Button>
            <span className="text-[13px] tabular-nums text-muted-foreground">
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
              className="h-8 gap-1 px-2.5 text-[13px]"
            >
              Próxima
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
