import type { ReactNode } from "react";
import { X, MessageCircle, ArrowRight, ShoppingCart, CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FocusCard, FocusTile } from "@/components/ui/bento";
import { cn } from "@/lib/utils";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { formatBRL } from "@/lib/format";
import { useClientAlerts } from "@/modules/carteira/hooks/useClientAlerts";
import type { PortfolioClientRow } from "@/modules/carteira/hooks/usePortfolioClients";
import { erpLabel } from "@/shared/format/erp-code";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CarteiraClientPreviewProps {
  client: PortfolioClientRow;
  /** Sem handler, o cartão não tem "fechar" — é o caso do Radar, sempre aberto. */
  onClose?: () => void;
  onViewDetail: (clientId: string) => void;
  onNewOrder: (clientId: string) => void;
  className?: string;
}

/*
 * O CARTÃO DE OURO do Radar de recompra (mockup V5): o cliente em foco, sempre
 * visível. Composição do mockup — pílulas, nome grande, quatro sub-blocos
 * (Health · Próximo pedido · Último pedido · Ticket médio), alertas em uma
 * linha e o rodapé com as ações. Todos os números saem da linha do
 * `get_portfolio_clients` que a tela já carregou; nenhuma consulta nova além
 * dos alertas, que já existiam aqui.
 *
 * Sobre o ouro, verde/âmbar/vermelho não leem (o âmbar some no amarelo). As
 * faixas são ditas por PESO, na cor do próprio cartão:
 *   grave  → pílula invertida (tinta cheia)
 *   médio  → pílula translúcida
 *   normal → texto simples
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

const SEGMENT_LABEL: Record<string, string> = {
  ouro: "Ouro",
  prata: "Prata",
  novo: "Novo",
  resgate: "Resgate",
  dormindo: "Dormindo",
};

/** Dias até a data esperada (negativo = atrasado), no relógio do navegador. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

function Tile({ label, value, sub, children }: { label: string; value?: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <FocusTile className="flex min-w-0 flex-col gap-1 px-3.5 py-3">
      {children ?? (
        <>
          <span className="truncate text-[11px] font-bold text-primary-foreground/70">{label}</span>
          <span className="truncate text-[1.15rem] font-extrabold leading-tight tabular-nums tracking-[-0.03em]">{value}</span>
          {sub && <span className="truncate text-[11px] font-semibold text-primary-foreground/70">{sub}</span>}
        </>
      )}
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

  const score = client.health_score ?? 0;
  const faixa = healthFaixa(client.health_status ?? null, score);
  // Anel de 44 px: r=18, circunferência ≈ 113.
  const circumference = 2 * Math.PI * 18;
  const dash = `${(Math.max(0, Math.min(100, score)) / 100) * circumference} ${circumference}`;

  const cycleDays = client.reorder_cycle_days ?? null;
  const daysSince = client.days_since_last_order ?? null;
  const next = daysUntil(client.next_order_expected);
  const atrasado = next != null ? next < 0 : !!(cycleDays && daysSince != null && daysSince > cycleDays);
  const segment = client.segment ? SEGMENT_LABEL[client.segment] ?? client.segment : null;

  const meta = [
    client.lifetime_value != null ? `LTV ${formatBRL(client.lifetime_value)}` : null,
    client.order_count ? `${client.order_count} ${client.order_count === 1 ? "pedido" : "pedidos"}` : null,
  ].filter(Boolean);

  const iconOnGold =
    "h-10 w-10 rounded-full border-primary-foreground/20 bg-primary-foreground/[.07] p-0 text-primary-foreground shadow-none hover:-translate-y-0 hover:border-primary-foreground/30 hover:bg-primary-foreground/15 hover:text-primary-foreground";

  const alerta = alerts[0];

  return (
    <FocusCard className={cn("min-h-[340px] gap-4 p-[18px]", className)} aria-label={`Resumo de ${erpLabel(client)}`}>
      {/* Pílulas + fechar */}
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground px-2.5 py-1 text-[11px] font-bold text-primary">
            <Sparkles className="size-3" aria-hidden />
            Cliente 360
          </span>
          {segment && (
            <span className="rounded-full bg-primary-foreground/10 px-2.5 py-1 text-[11px] font-bold">{segment}</span>
          )}
          {next != null && (
            <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold", atrasado ? "bg-primary-foreground text-primary" : "bg-primary-foreground/10")}>
              {atrasado ? "Recompra atrasada" : "Pedido previsto"}
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
            aria-label="Fechar painel"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Nome */}
      <div className="min-w-0">
        <p className="truncate text-[1.6rem] font-extrabold leading-[1.1] tracking-[-0.035em]" title={erpLabel(client)}>
          {erpLabel(client)}
        </p>
        {client.company && (
          <p className="mt-0.5 truncate text-[13px] font-semibold text-primary-foreground/70">{client.company}</p>
        )}
      </div>

      {/* Quatro sub-blocos */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Health">
          <div className="flex items-center gap-3">
            <div className="relative size-11 shrink-0">
              <svg className="size-11 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="4" className="text-primary-foreground/15" />
                <circle
                  cx="22"
                  cy="22"
                  r="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={dash}
                  className="text-primary-foreground"
                />
              </svg>
              <span className="absolute inset-0 grid place-items-center text-[13px] font-extrabold tabular-nums">{score}</span>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-bold">Health</p>
              <p className="mt-0.5 truncate text-[11px] font-semibold">
                <span className={PESO_CLASS[faixa.peso]}>{faixa.label}</span>
              </p>
            </div>
          </div>
        </Tile>
        <Tile
          label="Próximo pedido previsto"
          value={
            client.next_order_expected
              ? new Date(client.next_order_expected).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
              : "—"
          }
          sub={
            next == null ? "sem previsão" : next < 0 ? (
              <span className={PESO_CLASS.grave}>atrasado {Math.abs(next)} d</span>
            ) : next === 0 ? "hoje" : `em ${next} ${next === 1 ? "dia" : "dias"}`
          }
        />
        <Tile
          label="Último pedido"
          value={daysSince != null ? `há ${daysSince} ${daysSince === 1 ? "dia" : "dias"}` : "—"}
          sub={client.churn_probability != null ? (
            <>
              churn <span className={PESO_CLASS[churnPeso(client.churn_probability)]}>{client.churn_probability}%</span>
            </>
          ) : undefined}
        />
        <Tile
          label="Ticket médio"
          value={client.avg_ticket != null ? formatBRL(client.avg_ticket) : "—"}
          sub={cycleDays ? `compra a cada ${cycleDays} dias` : undefined}
        />
      </div>

      {/* Alerta ativo em uma linha */}
      {alerta && (
        <FocusTile
          className={cn(
            "flex items-center gap-2 px-3 py-2 text-xs font-semibold",
            alerta.severity === "critical" && "border-transparent bg-primary-foreground text-primary",
          )}
        >
          {alerta.severity === "critical" && <AlertTriangle size={13} className="shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1 truncate">{alerta.message}</span>
          {alerts.length > 1 && <span className="shrink-0 opacity-70">+{alerts.length - 1}</span>}
          <button
            type="button"
            onClick={() => resolveAlert.mutate(alerta.id)}
            className="shrink-0 rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            aria-label="Resolver alerta"
          >
            <CheckCircle2 size={14} />
          </button>
        </FocusTile>
      )}

      {/* Rodapé */}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-primary-foreground/15 pt-3.5">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-primary-foreground/70">
          {meta.join(" · ")}
        </span>
        {client.lead_id && (
          <AbrirConversaButton
            leadId={client.lead_id}
            phone={client.phone}
            size="icon"
            variant="outline"
            className={iconOnGold}
            title="WhatsApp"
            aria-label="WhatsApp"
          >
            <MessageCircle />
          </AbrirConversaButton>
        )}
        <Button
          size="icon"
          variant="outline"
          className={iconOnGold}
          onClick={() => onNewOrder(client.id)}
          title="Novo pedido"
          aria-label="Novo pedido"
        >
          <ShoppingCart />
        </Button>
        <Button
          variant="on-gold"
          onClick={() => onViewDetail(client.id)}
        >
          Abrir Cliente 360
          <ArrowRight />
        </Button>
      </div>
    </FocusCard>
  );
}
