import { ShoppingCart, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL, formatDateTime } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClienteTimelineProps {
  orders: Tables<"upsell_orders">[];
  alerts: Tables<"client_alerts">[];
}

interface TimelineItem {
  id: string;
  type: "order" | "alert";
  date: string;
  description: string;
  severity?: string;
  value?: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function alertSeverityDot(severity: string | undefined) {
  switch (severity) {
    case "critical":
      return "bg-red-400";
    case "warning":
      return "bg-amber-400";
    default:
      return "bg-muted-foreground";
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ClienteTimeline({ orders, alerts }: ClienteTimelineProps) {
  const items: TimelineItem[] = [
    ...orders.map((o) => ({
      id: `order-${o.id}`,
      type: "order" as const,
      date: o.sold_at ?? o.created_at ?? "",
      description: o.product_name
        ? `Pedido: ${o.product_name}`
        : "Pedido registrado",
      value: o.sale_value != null ? Number(o.sale_value) : null,
    })),
    ...alerts.map((a) => ({
      id: `alert-${a.id}`,
      type: "alert" as const,
      date: a.created_at ?? "",
      description: a.description ?? a.title ?? "Alerta gerado",
      severity: a.severity,
    })),
  ]
    .filter((item) => !!item.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 20);

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        Nenhuma atividade registrada.
      </p>
    );
  }

  return (
    <div className="relative flex flex-col">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-3 bottom-3 w-px bg-border" aria-hidden="true" />

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="relative flex gap-3">
            {/* Icon dot */}
            <div className="relative z-10 mt-1 flex items-center justify-center w-3.5 h-3.5 shrink-0 rounded-full bg-card border border-border">
              {item.type === "order" ? (
                <ShoppingCart size={7} className="text-emerald-400" />
              ) : (
                <AlertTriangle
                  size={7}
                  className={cn(
                    item.severity === "critical" ? "text-red-400" : "text-amber-400",
                  )}
                />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-start justify-between gap-2">
                <p className={cn(
                  "text-sm leading-snug",
                  item.type === "order" ? "text-card-foreground" : "text-muted-foreground",
                )}>
                  {item.description}
                </p>
                {item.value != null && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-card-foreground">
                    {formatBRL(item.value)}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {formatDateTime(item.date)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
