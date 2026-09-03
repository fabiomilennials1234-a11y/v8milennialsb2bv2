import { X, MessageCircle, ExternalLink, ShoppingCart, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { formatBRL } from "@/lib/format";
import { useClientAlerts } from "@/modules/carteira/hooks/useClientAlerts";
import { useHealthHistory } from "@/modules/platform/hooks/useHealthHistory";
import { HealthSparkline } from "./HealthSparkline";
import type { PortfolioClientRow } from "@/modules/carteira/hooks/usePortfolioClients";
import { erpLabel } from "@/shared/format/erp-code";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CarteiraClientPreviewProps {
  client: PortfolioClientRow;
  onClose: () => void;
  onViewDetail: (clientId: string) => void;
  onNewOrder: (clientId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function healthRingColor(status: string | null, score: number) {
  if (status === "saudavel" || score >= 80) return "text-emerald-400";
  if (status === "atencao" || score >= 60) return "text-amber-400";
  if (status === "risco" || score > 0) return "text-red-400";
  return "text-muted-foreground";
}

function alertSeverityStyle(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "warning":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

interface MiniMetricProps {
  label: string;
  value: React.ReactNode;
}

function MiniMetric({ label, value }: MiniMetricProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CarteiraClientPreview({
  client,
  onClose,
  onViewDetail,
  onNewOrder,
}: CarteiraClientPreviewProps) {
  const { data: alerts = [], resolveAlert } = useClientAlerts(client.id);
  const { data: healthHistory = [] } = useHealthHistory(client.id);

  const score = client.health_score ?? 0;
  const status = client.health_status ?? null;
  const ringColor = healthRingColor(status, score);
  // SVG circle circumference for r=35: 2 * π * 35 ≈ 220
  const circumference = 220;
  const dashArray = `${Math.round((score / 100) * circumference)} ${circumference}`;

  // Recompra info
  const cycleDays = client?.reorder_cycle_days ?? null;
  const daysSince = client?.days_since_last_order ?? null;

  return (
    <aside className="w-80 shrink-0 flex flex-col rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate" title={erpLabel(client)}>
            {client ? erpLabel(client) : "Carregando…"}
          </p>
          {client?.company && (
            <p className="text-xs text-muted-foreground truncate">{client.company}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors mt-0.5"
          aria-label="Fechar painel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto">
        {/* Health Ring */}
        <div className="flex flex-col items-center py-5 border-b border-border">
          <div className="relative w-20 h-20">
            <svg
              className="w-20 h-20 -rotate-90"
              viewBox="0 0 80 80"
              aria-hidden="true"
            >
              <circle
                cx="40"
                cy="40"
                r="35"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                className="text-border"
              />
              <circle
                cx="40"
                cy="40"
                r="35"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                className={ringColor}
                strokeDasharray={dashArray}
                strokeLinecap="round"
              />
            </svg>
            <span
              className={cn(
                "absolute inset-0 flex items-center justify-center text-lg font-bold",
                ringColor,
              )}
            >
              {score}
            </span>
          </div>
          <span className="mt-2 text-xs text-muted-foreground">Health Score</span>
          {healthHistory.length >= 2 && (
            <HealthSparkline
              data={healthHistory}
              width={140}
              height={28}
              className="mt-3 flex items-center gap-1.5"
            />
          )}
        </div>

        {/* Mini Metrics */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-3 px-4 py-4 border-b border-border">
          <MiniMetric
            label="Ciclo"
            value={cycleDays ? `${cycleDays} dias` : "—"}
          />
          <MiniMetric
            label="Dias s/ pedido"
            value={
              daysSince != null ? (
                <span
                  className={
                    cycleDays && daysSince > cycleDays
                      ? "text-red-400"
                      : "text-foreground"
                  }
                >
                  {daysSince}
                </span>
              ) : (
                "—"
              )
            }
          />
          <MiniMetric
            label="LTV"
            value={
              client?.lifetime_value != null
                ? formatBRL(client.lifetime_value)
                : "—"
            }
          />
          <MiniMetric
            label="Ticket"
            value={
              client?.avg_ticket != null ? formatBRL(client.avg_ticket) : "—"
            }
          />
          <MiniMetric
            label="Churn"
            value={
              client?.churn_probability != null ? (
                <span
                  className={
                    client.churn_probability >= 70
                      ? "text-red-400"
                      : client.churn_probability >= 40
                        ? "text-amber-400"
                        : "text-emerald-400"
                  }
                >
                  {client.churn_probability}%
                </span>
              ) : (
                "—"
              )
            }
          />
        </div>

        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
              Alertas ativos
            </p>
            <ul className="space-y-1.5">
              {alerts.slice(0, 5).map((alert) => (
                <li
                  key={alert.id}
                  className={cn(
                    "flex items-start justify-between gap-2 rounded-md px-2.5 py-2 border text-xs",
                    alertSeverityStyle(alert.severity),
                  )}
                >
                  <span className="leading-snug line-clamp-2">{alert.message}</span>
                  <button
                    onClick={() => resolveAlert.mutate(alert.id)}
                    className="shrink-0 opacity-50 hover:opacity-100 transition-opacity mt-0.5"
                    aria-label="Resolver alerta"
                  >
                    <CheckCircle2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 px-4 py-3 border-t border-border bg-card/80">
        <Button
          size="sm"
          className="w-full gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          onClick={() => onViewDetail(client.id)}
        >
          <ExternalLink size={14} />
          Ver 360°
        </Button>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-2 border-border hover:bg-muted"
            onClick={() => onNewOrder(client.id)}
          >
            <ShoppingCart size={13} />
            Novo Pedido
          </Button>
          {client?.lead_id && (
            <AbrirConversaButton
              leadId={client.lead_id}
              phone={client.phone}
              size="sm"
              variant="outline"
              className="flex-1 gap-2 border-border hover:bg-muted hover:border-green-600/50 hover:text-green-400"
            >
              <MessageCircle size={13} />
              WhatsApp
            </AbrirConversaButton>
          )}
        </div>
      </div>
    </aside>
  );
}
