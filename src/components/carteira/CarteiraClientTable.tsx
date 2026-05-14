import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
}

interface CarteiraClientTableProps {
  clients: CarteiraClient[];
  selectedClientId: string | null;
  onSelectClient: (clientId: string) => void;
  searchQuery: string;
  filter: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);

function healthConfig(status: string | null, score: number | null) {
  const s = score ?? 0;
  switch (status) {
    case "saudavel":
      return {
        label: `${s} Saudável`,
        className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
      };
    case "atencao":
      return {
        label: `${s} Atenção`,
        className: "bg-amber-500/15 text-amber-400 border-amber-500/25",
      };
    case "risco":
      return {
        label: `${s} Risco`,
        className: "bg-red-500/15 text-red-400 border-red-500/25",
      };
    case "inativo":
      return {
        label: `${s} Inativo`,
        className: "bg-zinc-700/40 text-zinc-400 border-zinc-600/30",
      };
    default: {
      // Derive from score when status is null
      if (s >= 80) return { label: `${s} Saudável`, className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" };
      if (s >= 60) return { label: `${s} Atenção`, className: "bg-amber-500/15 text-amber-400 border-amber-500/25" };
      if (s > 0) return { label: `${s} Risco`, className: "bg-red-500/15 text-red-400 border-red-500/25" };
      return { label: "—", className: "bg-zinc-700/40 text-zinc-400 border-zinc-600/30" };
    }
  }
}

function segmentConfig(segment: string | null) {
  switch (segment) {
    case "ouro":
      return {
        label: "Ouro",
        className: "bg-[hsl(47_100%_50%_/_0.15)] text-[hsl(47_100%_60%)] border-[hsl(47_100%_50%_/_0.3)]",
      };
    case "prata":
      return {
        label: "Prata",
        className: "bg-slate-500/15 text-slate-300 border-slate-500/25",
      };
    case "novo":
      return {
        label: "Novo",
        className: "bg-blue-500/15 text-blue-400 border-blue-500/25",
      };
    case "resgate":
      return {
        label: "Resgate",
        className: "bg-rose-500/15 text-rose-400 border-rose-500/25",
      };
    case "dormindo":
      return {
        label: "Dormindo",
        className: "bg-zinc-700/40 text-zinc-400 border-zinc-600/30",
      };
    default:
      return null;
  }
}

function recompraCell(
  daysSinceLast: number | null,
  cycleDays: number | null,
  nextExpected: string | null,
) {
  if (!cycleDays) return { label: "—", className: "text-zinc-500" };

  if (nextExpected) {
    const diff = Math.round(
      (new Date(nextExpected).getTime() - Date.now()) / 86_400_000,
    );
    if (diff < 0) {
      return {
        label: `${Math.abs(diff)} dias atrasado`,
        className: "text-red-400",
      };
    }
    return {
      label: `Em ${diff} dias`,
      className: "text-emerald-400",
    };
  }

  if (daysSinceLast !== null && cycleDays) {
    const overdue = daysSinceLast - cycleDays;
    if (overdue > 0) {
      return {
        label: `${overdue} dias atrasado`,
        className: "text-red-400",
      };
    }
    const remaining = cycleDays - daysSinceLast;
    return {
      label: `Em ${remaining} dias`,
      className: "text-emerald-400",
    };
  }

  return { label: "—", className: "text-zinc-500" };
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
  // segment-based filters
  return client.segment === filter;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CarteiraClientTable({
  clients,
  selectedClientId,
  onSelectClient,
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
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 py-16 text-center">
        <p className="text-sm text-zinc-500">Nenhum cliente encontrado.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            <TableHead className="text-zinc-400 text-xs font-medium uppercase tracking-wider py-3 pl-4">
              Cliente
            </TableHead>
            <TableHead className="text-zinc-400 text-xs font-medium uppercase tracking-wider py-3">
              Health
            </TableHead>
            <TableHead className="text-zinc-400 text-xs font-medium uppercase tracking-wider py-3">
              Recompra
            </TableHead>
            <TableHead className="text-zinc-400 text-xs font-medium uppercase tracking-wider py-3">
              Ticket Médio
            </TableHead>
            <TableHead className="text-zinc-400 text-xs font-medium uppercase tracking-wider py-3 pr-4">
              Segmento
            </TableHead>
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
                  "border-zinc-800 cursor-pointer transition-colors",
                  isSelected
                    ? "bg-[hsl(47_100%_50%_/_0.06)] hover:bg-[hsl(47_100%_50%_/_0.09)]"
                    : "hover:bg-zinc-800/40",
                )}
              >
                {/* Cliente */}
                <TableCell className="py-3 pl-4">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span
                      className={cn(
                        "text-sm font-medium leading-tight truncate max-w-[200px]",
                        isSelected ? "text-[hsl(47_100%_60%)]" : "text-zinc-100",
                      )}
                    >
                      {client.name}
                    </span>
                    {client.company && (
                      <span className="text-xs text-zinc-500 truncate max-w-[200px]">
                        {client.company}
                      </span>
                    )}
                  </div>
                  {(client.order_count ?? 0) > 0 && (
                    <Badge
                      variant="outline"
                      className="mt-1 h-4 px-1 text-[10px] border-zinc-700 text-zinc-500"
                    >
                      {client.order_count} pedido{client.order_count !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </TableCell>

                {/* Health */}
                <TableCell className="py-3">
                  <Badge
                    variant="outline"
                    className={cn("text-xs font-medium tabular-nums", health.className)}
                  >
                    {health.label}
                  </Badge>
                </TableCell>

                {/* Recompra */}
                <TableCell className="py-3">
                  <span className={cn("text-sm tabular-nums", recompra.className)}>
                    {recompra.label}
                  </span>
                </TableCell>

                {/* Ticket Médio */}
                <TableCell className="py-3">
                  <span className="text-sm tabular-nums text-zinc-200">
                    {client.avg_ticket != null ? formatBRL(client.avg_ticket) : "—"}
                  </span>
                </TableCell>

                {/* Segmento */}
                <TableCell className="py-3 pr-4">
                  {segment ? (
                    <Badge
                      variant="outline"
                      className={cn("text-xs font-medium", segment.className)}
                    >
                      {segment.label}
                    </Badge>
                  ) : (
                    <span className="text-zinc-600 text-sm">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
