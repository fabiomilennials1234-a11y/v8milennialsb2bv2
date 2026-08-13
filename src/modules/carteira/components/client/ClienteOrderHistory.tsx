import { ShoppingCart, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatBRL, formatDateFull } from "@/lib/format";
import {
  sourceLabel,
  sourceBadgeClass,
} from "@/modules/carteira/lib/order-display";
import type { Tables } from "@/integrations/supabase/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClienteOrderHistoryProps {
  orders: Tables<"upsell_orders">[];
  cycleDays: number;
  /**
   * Ids de pedidos que já têm NF-e emitida (faturados). Fonte: notas_fiscais do
   * ERP. Distingue o vendido do faturado (ADR-0020). Opcional — quando ausente,
   * nenhum badge de faturamento aparece.
   */
  invoicedOrderIds?: Set<string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dotColor(gap: number | null, cycleDays: number) {
  if (gap == null || cycleDays === 0) return "bg-muted-foreground";
  if (gap <= cycleDays) return "bg-emerald-400";
  if (gap <= cycleDays * 1.3) return "bg-amber-400";
  return "bg-red-400";
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ClienteOrderHistory({
  orders,
  cycleDays,
  invoicedOrderIds,
}: ClienteOrderHistoryProps) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
        <ShoppingCart size={28} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nenhum pedido registrado</p>
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
      <div className="absolute left-[7px] top-3 bottom-3 w-px bg-border" aria-hidden="true" />

      <ul className="space-y-3">
        {withGaps.map((order) => (
          <li key={order.id} className="relative flex gap-3">
            {/* Dot */}
            <div
              className={cn(
                "relative z-10 mt-1.5 w-3.5 h-3.5 shrink-0 rounded-full border-2 border-background",
                dotColor(order.gap, cycleDays),
              )}
            />

            {/* Content */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-card-foreground truncate">
                    {order.product_name ?? "Pedido"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {order.sold_at ? formatDateFull(order.sold_at) : "—"}
                    {order.gap != null && (
                      <span className="ml-2 text-muted-foreground">
                        +{order.gap}d desde anterior
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-sm font-semibold tabular-nums text-card-foreground">
                    {order.sale_value != null ? formatBRL(order.sale_value) : "—"}
                  </span>
                  <div className="flex items-center gap-1">
                    {invoicedOrderIds?.has(order.id) && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 h-4 border bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      >
                        <ReceiptText className="w-2.5 h-2.5 mr-0.5" />
                        Faturado
                      </Badge>
                    )}
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
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
