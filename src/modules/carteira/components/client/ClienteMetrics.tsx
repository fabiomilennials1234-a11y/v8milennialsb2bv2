import {
  DollarSign,
  Receipt,
  RefreshCw,
  ShoppingCart,
  Calendar,
  HeartPulse,
} from "lucide-react";
import { KpiTile } from "@/components/ui/bento";
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

/** Mesmas faixas de antes (80/60), em token. */
function healthColor(score: number | null | undefined) {
  const s = score ?? 0;
  if (s >= 80) return "text-success";
  if (s >= 60) return "text-warning-strong";
  return "text-destructive";
}

function healthBarColor(score: number | null | undefined) {
  const s = score ?? 0;
  if (s >= 80) return "bg-success";
  if (s >= 60) return "bg-warning";
  return "bg-destructive";
}

function healthTone(score: number) {
  if (score >= 80) return "good" as const;
  if (score >= 60) return "neutral" as const;
  return "bad" as const;
}

// ─── Component ───────────────────────────────────────────────────────────────
//
// V5 (2026-10): os seis cartões viram `KpiTile`. Mesmos valores e legendas.

export function ClienteMetrics({ client }: ClienteMetricsProps) {
  const score = client.health_score ?? 0;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <KpiTile
        label="LTV"
        value={client.lifetime_value != null ? formatBRL(client.lifetime_value) : "—"}
        icon={DollarSign}
        tone="gold"
        note="valor total acumulado"
      />

      <KpiTile
        label="Ticket médio"
        value={client.avg_ticket != null ? formatBRL(client.avg_ticket) : "—"}
        icon={Receipt}
        tone="info"
        note="por pedido"
      />

      <KpiTile
        label="Ciclo"
        value={client.reorder_cycle_days != null ? `${client.reorder_cycle_days} dias` : "—"}
        icon={RefreshCw}
        tone="neutral"
        note={(client.order_count ?? 0) < 2 ? "estimado — poucos pedidos" : "entre pedidos"}
      />

      <KpiTile
        label="Pedidos"
        value={client.order_count ?? "—"}
        icon={ShoppingCart}
        tone="neutral"
        note="total histórico"
      />

      <KpiTile
        label="Próximo pedido"
        value={
          client.next_order_expected
            ? formatDateShort(client.next_order_expected)
            : "Sem dados"
        }
        icon={Calendar}
        tone="neutral"
        note={(client.order_count ?? 0) < 2 && client.next_order_expected ? "baseado em estimativa" : undefined}
      />

      <KpiTile
        label="Health"
        value={<span className={healthColor(score)}>{score}</span>}
        icon={HeartPulse}
        tone={healthTone(score)}
      >
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Health score"
          aria-valuenow={Math.min(score, 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn("h-full rounded-full transition-all", healthBarColor(score))}
            style={{ width: `${Math.min(score, 100)}%` }}
          />
        </div>
      </KpiTile>
    </div>
  );
}
