import {
  DollarSign,
  Receipt,
  RefreshCw,
  ShoppingCart,
  Calendar,
  Heart,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL, formatDateShort } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UpsellClient {
  lifetime_value?: number | null;
  avg_ticket?: number | null;
  reorder_cycle_days?: number | null;
  order_count?: number | null;
  next_order_expected?: string | null;
  health_score?: number | null;
  health_status?: string | null;
}

interface ClienteMetricsProps {
  client: UpsellClient;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function healthColor(score: number | null | undefined) {
  const s = score ?? 0;
  if (s >= 80) return "text-emerald-400";
  if (s >= 60) return "text-amber-400";
  return "text-red-400";
}

function healthBarColor(score: number | null | undefined) {
  const s = score ?? 0;
  if (s >= 80) return "bg-emerald-400";
  if (s >= 60) return "bg-amber-400";
  return "bg-red-400";
}

// ─── Sub-component ────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  sub?: React.ReactNode;
}

function MetricCard({ label, value, icon, sub }: MetricCardProps) {
  return (
    <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] uppercase tracking-wider font-medium text-zinc-500">
              {label}
            </span>
            <span className="text-xl font-semibold text-zinc-100 tabular-nums leading-tight">
              {value}
            </span>
            {sub && <span className="text-xs text-zinc-500 mt-0.5">{sub}</span>}
          </div>
          <div className="shrink-0 text-zinc-600 mt-0.5">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ClienteMetrics({ client }: ClienteMetricsProps) {
  const score = client.health_score ?? 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      <MetricCard
        label="LTV"
        value={client.lifetime_value != null ? formatBRL(client.lifetime_value) : "—"}
        icon={<DollarSign size={16} />}
        sub="valor total acumulado"
      />

      <MetricCard
        label="Ticket Médio"
        value={client.avg_ticket != null ? formatBRL(client.avg_ticket) : "—"}
        icon={<Receipt size={16} />}
        sub="por pedido"
      />

      <MetricCard
        label="Ciclo"
        value={client.reorder_cycle_days != null ? `${client.reorder_cycle_days} dias` : "—"}
        icon={<RefreshCw size={16} />}
        sub="entre pedidos"
      />

      <MetricCard
        label="Pedidos"
        value={client.order_count ?? "—"}
        icon={<ShoppingCart size={16} />}
        sub="total histórico"
      />

      <MetricCard
        label="Próx. Pedido"
        value={
          client.next_order_expected
            ? formatDateShort(client.next_order_expected)
            : "Sem dados"
        }
        icon={<Calendar size={16} />}
      />

      {/* Health card — custom */}
      <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5 min-w-0 w-full">
              <span className="text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                Health
              </span>
              <span className={cn("text-xl font-semibold tabular-nums leading-tight", healthColor(score))}>
                {score}
              </span>
              {/* Progress bar */}
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", healthBarColor(score))}
                  style={{ width: `${Math.min(score, 100)}%` }}
                />
              </div>
            </div>
            <Heart size={16} className={cn("shrink-0 mt-0.5", healthColor(score))} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
