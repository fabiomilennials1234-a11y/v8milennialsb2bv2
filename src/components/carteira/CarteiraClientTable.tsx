import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MessageCircle, ClipboardList, ChevronRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CarteiraClient {
  id: string;
  name: string;
  company: string | null;
  health_score: number | null;
  health_status: string | null;
  segment: string | null;
  avg_ticket: number | null;
  days_since_last_order: number | null;
  reorder_cycle_days: number | null;
  next_order_expected: string | null;
  order_count: number | null;
  lifetime_value: number | null;
  lead_id: string | null;
  trend: string | null;
}

interface CarteiraClientTableProps {
  clients: CarteiraClient[];
  selectedClientId: string | null;
  onSelectClient: (clientId: string) => void;
  onWhatsApp?: (clientId: string) => void;
  onNewOrder?: (clientId: string) => void;
  onViewDetail?: (clientId: string) => void;
  searchQuery: string;
  filter: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function matchesFilter(client: CarteiraClient, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "overdue") {
    const { days_since_last_order: d, reorder_cycle_days: c } = client;
    return !!(d && c && d > c * 1.15);
  }
  if (filter === "expected") {
    if (!client.next_order_expected) return false;
    const t = new Date(client.next_order_expected).getTime();
    return t >= Date.now() && t <= Date.now() + 7 * 86_400_000;
  }
  return client.segment === filter;
}

// ─── Component ───────────────────────────────────────────────────────────────

const iconBtnClass =
  "w-[30px] h-[30px] rounded-md border border-[#3f3f46] bg-transparent text-[#a1a1aa] hover:bg-[#27272a] hover:text-[#fafafa] transition-colors flex items-center justify-center";

export function CarteiraClientTable({
  clients,
  selectedClientId,
  onSelectClient,
  onWhatsApp,
  onNewOrder,
  onViewDetail,
  searchQuery,
  filter,
}: CarteiraClientTableProps) {
  const q = searchQuery.toLowerCase().trim();

  const filtered = clients.filter((c) => {
    if (q) {
      const name = c.name.toLowerCase();
      const company = (c.company ?? "").toLowerCase();
      if (!name.includes(q) && !company.includes(q)) return false;
    }
    return matchesFilter(c, filter);
  });

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border border-[#27272a] bg-[#18181b] py-16 text-center">
        <p className="text-sm text-[#71717a]">Nenhum cliente encontrado.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#27272a] bg-[#18181b] overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-[#27272a] hover:bg-transparent bg-[#111113]">
            <TableHead className="h-auto text-[#71717a] text-[11px] font-semibold uppercase tracking-wider py-2.5 pl-4">
              Cliente
            </TableHead>
            <TableHead className="h-auto text-[#71717a] text-[11px] font-semibold uppercase tracking-wider py-2.5">
              Health
            </TableHead>
            <TableHead className="h-auto text-[#71717a] text-[11px] font-semibold uppercase tracking-wider py-2.5">
              Recompra
            </TableHead>
            <TableHead className="h-auto text-[#71717a] text-[11px] font-semibold uppercase tracking-wider py-2.5">
              Ticket médio
            </TableHead>
            <TableHead className="h-auto text-[#71717a] text-[11px] font-semibold uppercase tracking-wider py-2.5">
              Tendência
            </TableHead>
            <TableHead className="h-auto text-[#71717a] text-[11px] font-semibold uppercase tracking-wider py-2.5">
              Segmento
            </TableHead>
            <TableHead className="h-auto text-[#71717a] text-[11px] font-semibold uppercase tracking-wider py-2.5 pr-4 w-[100px]" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {filtered.map((client) => {
            const isSelected = client.id === selectedClientId;
            const health = healthConfig(client.health_status, client.health_score);
            const segment = segmentConfig(client.segment);
            const recompra = recompraCell(
              client.days_since_last_order,
              client.reorder_cycle_days,
              client.next_order_expected,
            );

            return (
              <TableRow
                key={client.id}
                onClick={() => onSelectClient(client.id)}
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
                    <span className={cn("w-1.5 h-1.5 rounded-full", health.dot)} />
                    {health.label}
                  </span>
                </TableCell>

                <TableCell className="py-3">
                  <span className={cn("text-[13px]", recompra.className)}>
                    {recompra.label}
                  </span>
                </TableCell>

                <TableCell className="py-3">
                  <span className={cn("text-sm", client.avg_ticket != null ? "text-[#fafafa]" : "text-[#3f3f46]")}>
                    {client.avg_ticket != null ? formatBRL(client.avg_ticket) : "—"}
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
                          onWhatsApp(client.id);
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
    </div>
  );
}
