import { X, MessageCircle, ArrowRight, ShoppingCart, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FocusCard, FocusTile } from "@/components/ui/bento";
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
  className?: string;
}

/*
 * V5 (2026-10): o painel lateral vira o CARTÃO DE OURO do painel-herói — o
 * detalhe da linha selecionada na tabela em tinta. Mesmos dados, mesmas ações
 * (fechar, resolver alerta, Ver 360°, Novo pedido, WhatsApp).
 *
 * Sobre o ouro, verde/âmbar/vermelho não leem (o âmbar some no amarelo). As
 * mesmas faixas de antes passam a ser ditas por PESO, na cor do próprio cartão:
 *   grave  → pílula invertida (tinta cheia)
 *   médio  → pílula translúcida
 *   normal → texto simples
 * A faixa do health, que antes só existia como cor do anel, vira palavra.
 */

type Peso = "grave" | "medio" | "normal";

const PESO_CLASS: Record<Peso, string> = {
  grave: "rounded-full bg-primary-foreground px-2 py-px text-primary",
  medio: "rounded-full bg-primary-foreground/15 px-2 py-px",
  normal: "",
};

/** Mesmas faixas do anel de antes (80/60/>0). */
function healthFaixa(status: string | null, score: number): { label: string; peso: Peso } {
  if (status === "saudavel" || score >= 80) return { label: "Saudável", peso: "normal" };
  if (status === "atencao" || score >= 60) return { label: "Atenção", peso: "medio" };
  if (status === "risco" || score > 0) return { label: "Em risco", peso: "grave" };
  return { label: "Sem dado", peso: "normal" };
}

/** Mesmas faixas de churn de antes (70/40). */
function churnPeso(p: number): Peso {
  if (p >= 70) return "grave";
  if (p >= 40) return "medio";
  return "normal";
}

function alertPeso(severity: string): Peso {
  if (severity === "critical") return "grave";
  if (severity === "warning") return "medio";
  return "normal";
}

const ALERT_TILE: Record<Peso, string> = {
  grave: "border-transparent bg-primary-foreground text-primary",
  medio: "",
  normal: "bg-transparent",
};

function MiniMetric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <FocusTile className="flex flex-col gap-0.5 px-3 py-2.5">
      <span className="text-[11px] font-bold text-primary-foreground/70">{label}</span>
      <span className="truncate text-[15px] font-extrabold tabular-nums tracking-[-0.02em]">{children}</span>
    </FocusTile>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CarteiraClientPreview({
  client,
  onClose,
  onViewDetail,
  onNewOrder,
  className,
}: CarteiraClientPreviewProps) {
  const { data: alerts = [], resolveAlert } = useClientAlerts(client.id);
  const { data: healthHistory = [] } = useHealthHistory(client.id);

  const score = client.health_score ?? 0;
  const status = client.health_status ?? null;
  const faixa = healthFaixa(status, score);
  // SVG circle circumference for r=35: 2 * π * 35 ≈ 220
  const circumference = 220;
  const dashArray = `${Math.round((score / 100) * circumference)} ${circumference}`;

  // Recompra info
  const cycleDays = client?.reorder_cycle_days ?? null;
  const daysSince = client?.days_since_last_order ?? null;
  const atrasado = !!(cycleDays && daysSince != null && daysSince > cycleDays);

  const onGoldSecondary =
    "flex-1 gap-2 border-primary-foreground/20 bg-primary-foreground/[.07] text-primary-foreground shadow-none hover:-translate-y-0 hover:border-primary-foreground/30 hover:bg-primary-foreground/15 hover:text-primary-foreground";

  return (
    <FocusCard className={cn("gap-3.5", className)} aria-label={`Resumo de ${erpLabel(client)}`}>
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-primary-foreground/70">Cliente selecionado</p>
          <p
            className="mt-0.5 truncate text-[1.3rem] font-extrabold leading-tight tracking-[-0.03em]"
            title={erpLabel(client)}
          >
            {client ? erpLabel(client) : "Carregando…"}
          </p>
          {client?.company && (
            <p className="truncate text-[12px] font-semibold text-primary-foreground/70">{client.company}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
          aria-label="Fechar painel"
        >
          <X size={15} />
        </button>
      </div>

      {/* Health */}
      <FocusTile className="flex items-center gap-3">
        <div className="relative h-14 w-14 shrink-0">
          <svg className="h-14 w-14 -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
            <circle
              cx="40"
              cy="40"
              r="35"
              fill="none"
              stroke="currentColor"
              strokeWidth="7"
              className="text-primary-foreground/15"
            />
            <circle
              cx="40"
              cy="40"
              r="35"
              fill="none"
              stroke="currentColor"
              strokeWidth="7"
              className="text-primary-foreground"
              strokeDasharray={dashArray}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-base font-extrabold tabular-nums">
            {score}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-primary-foreground/70">Health Score</p>
          <p className="mt-0.5 text-[13px] font-bold">
            <span className={PESO_CLASS[faixa.peso]}>{faixa.label}</span>
          </p>
          {healthHistory.length >= 2 && (
            <HealthSparkline
              data={healthHistory}
              width={120}
              height={24}
              color="hsl(var(--primary-foreground))"
              className="mt-1.5 flex items-center gap-1.5"
            />
          )}
        </div>
      </FocusTile>

      {/* Mini Metrics */}
      <div className="grid grid-cols-2 gap-2">
        <MiniMetric label="Ciclo">{cycleDays ? `${cycleDays} dias` : "—"}</MiniMetric>
        <MiniMetric label="Dias s/ pedido">
          {daysSince != null ? (
            <span className={atrasado ? PESO_CLASS.grave : undefined} title={atrasado ? "Acima do ciclo" : undefined}>
              {daysSince}
            </span>
          ) : (
            "—"
          )}
        </MiniMetric>
        <MiniMetric label="LTV">
          {client?.lifetime_value != null ? formatBRL(client.lifetime_value) : "—"}
        </MiniMetric>
        <MiniMetric label="Ticket">
          {client?.avg_ticket != null ? formatBRL(client.avg_ticket) : "—"}
        </MiniMetric>
        <MiniMetric label="Churn">
          {client?.churn_probability != null ? (
            <span className={PESO_CLASS[churnPeso(client.churn_probability)]}>
              {client.churn_probability}%
            </span>
          ) : (
            "—"
          )}
        </MiniMetric>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-bold text-primary-foreground/70">Alertas ativos</p>
          <ul className="space-y-1.5">
            {alerts.slice(0, 5).map((alert) => {
              const peso = alertPeso(alert.severity);
              return (
                <li key={alert.id}>
                  <FocusTile
                    className={cn(
                      "flex items-start justify-between gap-2 px-2.5 py-2 text-xs font-semibold",
                      ALERT_TILE[peso],
                    )}
                  >
                    {peso === "grave" && <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />}
                    <span className="line-clamp-2 flex-1 leading-snug">{alert.message}</span>
                    <button
                      type="button"
                      onClick={() => resolveAlert.mutate(alert.id)}
                      className="mt-px shrink-0 rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                      aria-label="Resolver alerta"
                    >
                      <CheckCircle2 size={14} />
                    </button>
                  </FocusTile>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex flex-col gap-2 border-t border-primary-foreground/15 pt-3.5">
        <Button variant="ink" className="w-full gap-2" onClick={() => onViewDetail(client.id)}>
          Ver 360°
          <ArrowRight />
        </Button>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className={onGoldSecondary}
            onClick={() => onNewOrder(client.id)}
          >
            <ShoppingCart />
            Novo pedido
          </Button>
          {client?.lead_id && (
            <AbrirConversaButton
              leadId={client.lead_id}
              phone={client.phone}
              size="sm"
              variant="outline"
              className={onGoldSecondary}
            >
              <MessageCircle />
              WhatsApp
            </AbrirConversaButton>
          )}
        </div>
      </div>
    </FocusCard>
  );
}
