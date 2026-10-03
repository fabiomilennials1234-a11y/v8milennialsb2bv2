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
import { UserAvatar } from "@/components/ui/user-avatar";
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

/** "hoje" · "ontem" · "há N dias". */
function relativeDays(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(d) || d < 0) return "";
  if (d === 0) return "hoje";
  if (d === 1) return "ontem";
  return `há ${d} dias`;
}

// ─── Constantes de estilo (espelham CarteiraClientTable:181-185) ────────────

const iconBtnClass =
  "w-[30px] h-[30px] rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const thBase =
  "h-auto border-b border-border/70 py-2.5 text-[11px] font-bold uppercase tracking-[.06em]";

/** Casca de cartão do V5 — a mesma nos três estados (carregando, vazio, tabela). */
const shell = "overflow-hidden rounded-card border border-card-border bg-card shadow-relevo";

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
      <div className={shell}>
        <div className="divide-y divide-border/60">
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
      <div className={cn(shell, "flex flex-col items-center gap-4 py-20")}>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
          <empty.Icon className="h-6 w-6" />
        </div>
        <div className="space-y-1 text-center">
          <p className="text-sm font-bold text-foreground">
            {empty.title}
          </p>
          <p className="max-w-[340px] text-[13px] text-muted-foreground">
            {empty.body}
          </p>
        </div>
      </div>
    );
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  return (
    <div className={shell}>
      {/* CarteiraClientTable não tem scroller horizontal (problema latente lá).
          Aqui a tabela é mais larga, então o scroller é obrigatório. */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead className={cn(thBase, "pl-4 text-muted-foreground")}>Pedido</TableHead>
              <SortableHeader col="client" label="Cliente" />
              <SortableHeader col="date" label="Data" />
              <TableHead className={cn(thBase, "text-muted-foreground hidden md:table-cell")}>Itens</TableHead>
              <TableHead className={cn(thBase, "text-muted-foreground")}>Situação</TableHead>
              <TableHead className={cn(thBase, "text-muted-foreground hidden lg:table-cell")}>Origem</TableHead>
              <TableHead className={cn(thBase, "text-muted-foreground hidden md:table-cell")}>Vendedor</TableHead>
              <SortableHeader col="value" label="Valor" className="text-right" />
              <TableHead className={cn(thBase, "text-muted-foreground pr-4 w-[60px]")} aria-label="Ações" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((order) => {
              const itemCount = order.items?.length ?? 0;
              const readOnly = order.is_erp_linked || order.source === "historical";

              // O botão é montado uma vez e envolvido condicionalmente —
              // padrão canônico de StageRail.tsx:304-315.
              const editBtn = (
                <button
                  type="button"
                  disabled={readOnly}
                  aria-disabled={readOnly || undefined}
                  onClick={readOnly ? undefined : () => onEdit(order)}
                  title={order.source === "historical" ? "Venda histórica vinculada a negócio ganho" : order.is_erp_linked ? undefined : "Editar pedido"}
                  className={cn(
                    iconBtnClass,
                    readOnly &&
                      "opacity-50 cursor-not-allowed pointer-events-none",
                  )}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              );

              return (
                <TableRow
                  key={order.id}
                  className="group/row border-border/60 transition-colors hover:bg-muted/40"
                >
                  {/* Pedido — o produto (não há número humano de pedido) */}
                  <TableCell className="pl-4 py-3">
                    <div className="max-w-[220px] truncate text-[13px] font-semibold text-foreground" title={order.product_name}>
                      {order.product_name || "—"}
                    </div>
                  </TableCell>

                  {/* Cliente — ladrilho + nome + empresa */}
                  <TableCell className="py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="grid size-[30px] shrink-0 place-items-center rounded-[10px] bg-muted text-[10.5px] font-extrabold text-foreground/70">
                        {initials(order.client_name)}
                      </span>
                      <div className="min-w-0 leading-tight">
                        <p className="max-w-[220px] truncate text-[13px] font-bold">{order.client_name}</p>
                        {order.client_company && (
                          <p className="max-w-[220px] truncate text-[11px] text-muted-foreground">{order.client_company}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  {/* Data + relativo */}
                  <TableCell className="py-3 whitespace-nowrap">
                    <p className="text-[13px] font-semibold tabular-nums">{formatDateFull(order.sold_at)}</p>
                    <p className="text-[11px] text-muted-foreground">{relativeDays(order.sold_at)}</p>
                  </TableCell>

                  <TableCell className="py-3 text-[13px] text-muted-foreground hidden md:table-cell whitespace-nowrap">
                    {itemCount > 0 ? `${itemCount} ${itemCount === 1 ? "item" : "itens"}` : "—"}
                  </TableCell>

                  {/* Situação: aprovado + procedência, quando há vínculo ERP.
                      Rotula o SISTEMA (TinyERP/Omie/NF-e), não "Faturado":
                      medido em prod, notas_fiscais tem 0 linhas e 232 pedidos
                      são bloqueados por tiny_order_id. */}
                  <TableCell className="py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="success" className="h-5 px-2 py-0 text-[10.5px]">
                        Aprovado
                      </Badge>
                      {order.is_erp_linked && (
                        <Badge variant="info" className="h-5 px-2 py-0 text-[10.5px]">
                          {order.erp_source === "nfe" ? (
                            <ReceiptText className="mr-1 h-3 w-3" />
                          ) : (
                            <Link2 className="mr-1 h-3 w-3" />
                          )}
                          {erpSourceLabel(order.erp_source)}
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  {/* Origem do registro */}
                  <TableCell className="py-3 hidden lg:table-cell">
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 px-2 py-0 text-[10.5px]",
                        sourceBadgeClass(order.source),
                      )}
                    >
                      {sourceLabel(order.source)}
                    </Badge>
                  </TableCell>

                  {/* Vendedor — avatar, nome no title */}
                  <TableCell className="py-3 hidden md:table-cell">
                    {order.closer_name ? (
                      <div title={order.closer_name} className="w-fit">
                        <UserAvatar name={order.closer_name} size="xs" />
                      </div>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </TableCell>

                  {/* Valor (alvo de comparação vertical: direita + tabular) */}
                  <TableCell className="py-3 text-right text-[13px] font-bold tabular-nums text-foreground whitespace-nowrap">
                    {formatBRL(Number(order.sale_value), 2)}
                  </TableCell>

                  {/* Ações — largura fixa: layout não desloca entre linhas
                      editáveis e bloqueadas. */}
                  <TableCell className="py-3 pr-4 w-[60px]">
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
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5">
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
