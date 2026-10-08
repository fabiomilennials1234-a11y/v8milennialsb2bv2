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
      return "bg-destructive";
    case "warning":
      return "bg-warning";
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
      <div className="absolute bottom-3 left-[7.5px] top-3 w-px bg-border" aria-hidden="true" />

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="relative flex gap-3">
            {/* Icon dot */}
            <div className="relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border bg-card">
              {item.type === "order" ? (
                <ShoppingCart size={8} className="text-success" />
              ) : (
                <AlertTriangle
                  size={8}
                  className={cn(
                    item.severity === "critical" ? "text-destructive" : "text-warning-strong",
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
                  <span className="shrink-0 text-sm font-bold tabular-nums text-card-foreground">
                    {formatBRL(item.value)}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {formatDateTime(item.date)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
