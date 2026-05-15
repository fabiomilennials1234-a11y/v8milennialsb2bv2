import { ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBRL, formatDateFull } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClienteOrderHistoryProps {
  orders: any[];
  cycleDays: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sourceLabel(source: string | null) {
  switch (source) {
    case "pipe":
      return "Pipeline";
    case "manual":
      return "Manual";
    case "erp":
      return "ERP";
    case "copilot":
      return "Copilot";
    case "csv_import":
      return "CSV";
    default:
      return source ?? "—";
  }
}

function sourceBadgeClass(source: string | null) {
  switch (source) {
    case "pipe":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "copilot":
      return "bg-[hsl(47_100%_50%/0.1)] text-[hsl(47_100%_60%)] border-[hsl(47_100%_50%/0.2)]";
    case "erp":
      return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    default:
      return "bg-zinc-700/30 text-zinc-400 border-zinc-600/20";
  }
}

function dotColor(gap: number | null, cycleDays: number) {
  if (gap == null || cycleDays === 0) return "bg-zinc-600";
  if (gap <= cycleDays) return "bg-emerald-400";
  if (gap <= cycleDays * 1.3) return "bg-amber-400";
  return "bg-red-400";
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ClienteOrderHistory({ orders, cycleDays }: ClienteOrderHistoryProps) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
        <ShoppingCart size={28} className="text-zinc-700" />
        <p className="text-sm text-zinc-500">Nenhum pedido registrado</p>
      </div>
    );
  }

  // Sort descending
  const sorted = [...orders].sort(
    (a, b) => new Date(b.sold_at ?? 0).getTime() - new Date(a.sold_at ?? 0).getTime()
  );

  // Compute gaps between orders
  const withGaps = sorted.map((order, idx) => {
    const next = sorted[idx + 1];
    let gap: number | null = null;
    if (next?.sold_at && order.sold_at) {
      gap = Math.round(
        (new Date(order.sold_at).getTime() - new Date(next.sold_at).getTime()) / 86_400_000
      );
    }
    return { ...order, gap };
  });

  return (
    <div className="relative flex flex-col">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-3 bottom-3 w-px bg-zinc-800" aria-hidden="true" />

      <ul className="space-y-3">
        {withGaps.map((order) => (
          <li key={order.id} className="relative flex gap-3">
            {/* Dot */}
            <div
              className={cn(
                "relative z-10 mt-1.5 w-3.5 h-3.5 shrink-0 rounded-full border-2 border-zinc-900",
                dotColor(order.gap, cycleDays),
              )}
            />

            {/* Content */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200 truncate">
                    {order.product_name ?? "Pedido"}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {order.sold_at ? formatDateFull(order.sold_at) : "—"}
                    {order.gap != null && (
                      <span className="ml-2 text-zinc-600">
                        +{order.gap}d desde anterior
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-sm font-semibold tabular-nums text-zinc-200">
                    {order.total_value != null ? formatBRL(order.total_value) : "—"}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] px-1.5 py-0 h-4 border",
                      sourceBadgeClass(order.source),
                    )}
                  >
                    {sourceLabel(order.source)}
                  </Badge>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
