import { ShoppingCart, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClienteTimelineProps {
  orders: any[];
  alerts: any[];
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

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function alertSeverityDot(severity: string | undefined) {
  switch (severity) {
    case "critical":
      return "bg-red-400";
    case "warning":
      return "bg-amber-400";
    default:
      return "bg-zinc-500";
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
      value: o.total_value ?? null,
    })),
    ...alerts.map((a) => ({
      id: `alert-${a.id}`,
      type: "alert" as const,
      date: a.created_at ?? "",
      description: a.message ?? "Alerta gerado",
      severity: a.severity,
    })),
  ]
    .filter((item) => !!item.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 20);

  if (items.length === 0) {
    return (
      <p className="text-sm text-zinc-500 text-center py-6">
        Nenhuma atividade registrada.
      </p>
    );
  }

  return (
    <div className="relative flex flex-col">
      {/* Vertical line */}
      <div className="absolute left-[7px] top-3 bottom-3 w-px bg-zinc-800" aria-hidden="true" />

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="relative flex gap-3">
            {/* Icon dot */}
            <div className="relative z-10 mt-1 flex items-center justify-center w-3.5 h-3.5 shrink-0 rounded-full bg-zinc-900 border border-zinc-700">
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
                  item.type === "order" ? "text-zinc-300" : "text-zinc-400",
                )}>
                  {item.description}
                </p>
                {item.value != null && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-200">
                    {formatBRL(item.value)}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-zinc-600 mt-0.5">
                {formatDateTime(item.date)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
