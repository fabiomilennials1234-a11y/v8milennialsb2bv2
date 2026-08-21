import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Pencil,
  ReceiptText,
  Link2,
  Receipt,
  SearchX,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL, formatDateFull } from "@/lib/format";
import {
  sourceLabel,
  sourceBadgeClass,
  erpSourceLabel,
  erpBlockMessage,
} from "@/modules/carteira/lib/order-display";
import type { CarteiraOrderRow } from "@/modules/carteira/hooks/useCarteiraOrders";

// ─── Props ──────────────────────────────────────────────────────────────────

interface OrdersTableProps {
  orders: CarteiraOrderRow[];
  isLoading: boolean;
  onEdit: (order: CarteiraOrderRow) => void;
  /** admin + membro — quem pode editar. */
  canMutate: boolean;
  hasSearch?: boolean;
  page: number;
  totalPages: number;
  total: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
}

// ─── Constantes de estilo (espelham CarteiraClientTable:181-185) ────────────

const iconBtnClass =
  "w-[30px] h-[30px] rounded-md border border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const thBase =
  "h-auto text-[11px] font-semibold uppercase tracking-wider py-2.5";

type SortColumn = "client" | "value" | "date";

// ─── Component ──────────────────────────────────────────────────────────────

export function OrdersTable({
  orders,
  isLoading,
  onEdit,
  canMutate,
  hasSearch = false,
  page,
  totalPages,
  total,
  from,
  to,
  onPageChange,
}: OrdersTableProps) {
  const [sortBy, setSortBy] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(col: SortColumn) {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir(col === "client" ? "asc" : "desc");
    }
  }

  // Ordenação é da PÁGINA carregada. A RPC já entrega por sold_at desc e não
  // tem parâmetro de ordenação — server-side ficou fora desta fatia.
  const rows = useMemo(() => {
    if (!sortBy) return orders;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...orders].sort((a, b) => {
      if (sortBy === "client")
        return a.client_name.localeCompare(b.client_name, "pt-BR") * dir;
      if (sortBy === "value")
        return (Number(a.sale_value) - Number(b.sale_value)) * dir;
      return (
        (new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime()) * dir
      );
    });
  }, [orders, sortBy, sortDir]);

  function SortIcon({ col }: { col: SortColumn }) {
    if (sortBy !== col)
      return (
        <ArrowUpDown className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-50" />
      );
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

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-3.5 animate-pulse">
              <div className="h-4 bg-muted rounded w-48" />
              <div className="h-4 bg-muted rounded w-20" />
              <div className="h-4 bg-muted rounded w-24" />
              <div className="h-4 bg-muted rounded w-28" />
              <div className="h-4 bg-muted rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (rows.length === 0) {
    const empty = hasSearch
      ? {
          Icon: SearchX,
          title: "Nenhum pedido encontrado",
          body: "Tente ajustar o termo de busca.",
        }
      : {
          Icon: Receipt,
          title: "Nenhum pedido registrado",
          body: "Pedidos aprovados aparecem aqui. Use Nova Venda para registrar o primeiro.",
        };

    return (
      <div className="rounded-xl border border-border bg-card py-20 flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
          <empty.Icon className="w-6 h-6 text-muted-foreground/60" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-muted-foreground">
            {empty.title}
          </p>
          <p className="text-[13px] text-muted-foreground/60 max-w-[340px]">
            {empty.body}
          </p>
        </div>
      </div>
    );
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* CarteiraClientTable não tem scroller horizontal (problema latente lá).
          Aqui a tabela é mais larga, então o scroller é obrigatório. */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent bg-muted/50">
              <SortableHeader col="client" label="Cliente" className="pl-4" />
              <SortableHeader col="value" label="Valor" className="text-right" />
              <SortableHeader col="date" label="Data" />
              <TableHead
                className={cn(thBase, "text-muted-foreground hidden md:table-cell")}
              >
                Closer
              </TableHead>
              <TableHead
                className={cn(thBase, "text-muted-foreground hidden lg:table-cell")}
              >
                Origem
              </TableHead>
              <TableHead className={cn(thBase, "text-muted-foreground")}>
                Situação
              </TableHead>
              <TableHead
                className={cn(thBase, "text-muted-foreground pr-4 w-[70px]")}
              />
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((order) => {
              const itemCount = order.items?.length ?? 0;

              // O botão é montado uma vez e envolvido condicionalmente —
              // padrão canônico de StageRail.tsx:304-315.
              const editBtn = (
                <button
                  type="button"
                  disabled={order.is_erp_linked}
                  aria-disabled={order.is_erp_linked || undefined}
                  onClick={order.is_erp_linked ? undefined : () => onEdit(order)}
                  title={order.is_erp_linked ? undefined : "Editar pedido"}
                  className={cn(
                    iconBtnClass,
                    order.is_erp_linked &&
                      "opacity-50 cursor-not-allowed pointer-events-none",
                  )}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              );

              return (
                <TableRow
                  key={order.id}
                  className="border-border transition-colors group/row hover:bg-muted/50"
                >
                  {/* 1 — Cliente */}
                  <TableCell className="pl-4 py-3">
                    <div className="text-sm font-semibold text-foreground truncate max-w-[240px]">
                      {order.client_name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-[240px]">
                      {order.product_name}
                      {itemCount > 0 &&
                        ` · ${itemCount} ${itemCount === 1 ? "item" : "itens"}`}
                    </div>
                  </TableCell>

                  {/* 2 — Valor (alvo de comparação vertical: direita + tabular) */}
                  <TableCell className="py-3 text-right text-sm tabular-nums text-foreground">
                    {formatBRL(Number(order.sale_value), 2)}
                  </TableCell>

                  {/* 3 — Data */}
                  <TableCell className="py-3 text-[13px] text-muted-foreground whitespace-nowrap">
                    {formatDateFull(order.sold_at)}
                  </TableCell>

                  {/* 4 — Closer */}
                  <TableCell className="py-3 text-[13px] hidden md:table-cell">
                    {order.closer_name ? (
                      <span className="text-muted-foreground truncate max-w-[140px] inline-block align-bottom">
                        {order.closer_name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </TableCell>

                  {/* 5 — Origem do registro */}
                  <TableCell className="py-3 hidden lg:table-cell">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-1.5 py-0 h-4 border",
                        sourceBadgeClass(order.source),
                      )}
                    >
                      {sourceLabel(order.source)}
                    </Badge>
                  </TableCell>

                  {/* 6 — Situação: procedência, quando há vínculo ERP.
                      Rotula o SISTEMA (TinyERP/Omie/NF-e), não "Faturado":
                      medido em prod, notas_fiscais tem 0 linhas e 232 pedidos
                      são bloqueados por tiny_order_id. */}
                  <TableCell className="py-3">
                    {order.is_erp_linked && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 h-4 border bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      >
                        {order.erp_source === "nfe" ? (
                          <ReceiptText className="w-2.5 h-2.5 mr-0.5" />
                        ) : (
                          <Link2 className="w-2.5 h-2.5 mr-0.5" />
                        )}
                        {erpSourceLabel(order.erp_source)}
                      </Badge>
                    )}
                  </TableCell>

                  {/* Ações — largura fixa: layout não desloca entre linhas
                      editáveis e bloqueadas. */}
                  <TableCell className="py-3 pr-4 w-[70px]">
                    <div className="flex items-center justify-end gap-1">
                      {canMutate &&
                        (order.is_erp_linked ? (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                {/* shim de pointer-events: <button disabled>
                                    não emite eventos de mouse. tabIndex torna
                                    o motivo alcançável por teclado. */}
                                <span
                                  tabIndex={0}
                                  aria-label={`Edição bloqueada: ${erpBlockMessage(order.erp_source)}`}
                                  className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {editBtn}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="left"
                                className="max-w-[240px]"
                              >
                                {erpBlockMessage(order.erp_source)}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          editBtn
                        ))}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <span className="text-[13px] text-muted-foreground tabular-nums">
            Mostrando {from}–{to} de {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="h-7 px-2 text-[13px] gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Anterior
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(page + 1)}
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
  );
}
