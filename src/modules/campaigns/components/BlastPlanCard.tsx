/**
 * BlastPlanCard — um Blast Plan na grade do painel de Disparos (#707/#709).
 *
 * Forma do V5 (mockup "Disparos"): cabeçalho com chip + título + origem do
 * público + selo; linha do lote; barras por lote; barra "Lotes liberados";
 * quatro mini-blocos (Aceitas, Falhas, Ignorados, Na fila); ações; rodapé com
 * início e caixa. Um cartão = um plano, dono do próprio `useBlastPlanProgress`
 * (hooks não rodam em laço).
 *
 * "Aceita" é aceita PARA ENVIO — entrou na fila do WhatsApp. A confirmação de
 * entrega não chega a este painel (blast-outcome.ts), e o rótulo não promete
 * mais do que isso.
 */
import { format, parseISO } from "date-fns";
import { CheckCircle2, Loader2, Pause, Pencil, Play, Send, Smartphone, Users, X, XCircle } from "lucide-react";
import { useBlastPlanProgress, type BlastPlan } from "@/modules/campaigns/hooks/useBlastPlans";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  STATUS_PILL,
  STATUS_DOT,
  firstLine,
  nextReleaseLabel,
  planStatus,
  releaseTime,
  useBlastFigures,
  useBlastPlanActions,
} from "./blast-plan-ui";
import { LotBars, LotSegments } from "./BlastLotBars";

interface BlastPlanCardProps {
  plan: BlastPlan;
  /** Drill-down (#944): abre o sheet da audiência congelada. */
  onOpen?: () => void;
  /** Origem do público já resolvida ("Funil · Vendas", "Planilha · x.csv"). */
  origin?: string | null;
  /** Rótulo da caixa (instância) que dispara. */
  inboxLabel?: string | null;
}

const fmt = (n: number) => n.toLocaleString("pt-BR");

function startedAt(plan: BlastPlan): string | null {
  try {
    return format(parseISO(plan.created_at), "dd/MM");
  } catch {
    return null;
  }
}

export function BlastPlanCard({ plan, onOpen, origin, inboxLabel }: BlastPlanCardProps) {
  const { data: progress } = useBlastPlanProgress(plan.id);
  const figures = useBlastFigures(plan, progress);
  const actions = useBlastPlanActions(plan);
  const status = planStatus(plan, progress);

  const isActive = plan.status === "active";
  const isPaused = plan.status === "paused";
  const isTerminal = plan.status === "completed" || plan.status === "cancelled";
  const next = nextReleaseLabel(plan);

  const ChipIcon = plan.status === "cancelled" ? XCircle : plan.status === "completed" ? CheckCircle2 : isPaused ? Pause : Send;

  const lotLine = isTerminal
    ? `${plan.lots_released} de ${plan.lots_total} ${plan.lots_total === 1 ? "lote liberado" : "lotes liberados"}`
    : isPaused
      ? `Pausado no lote ${Math.max(1, plan.lots_released)} de ${plan.lots_total}`
      : `Lote ${Math.max(1, plan.lots_released)} de ${plan.lots_total}${next !== "—" ? ` · próximo ${next} às ${releaseTime(plan)}` : ""}`;

  const started = startedAt(plan);

  return (
    <>
      <article
        className={cn(
          "flex min-w-0 flex-col gap-3.5 rounded-card border border-card-border bg-card p-[18px] text-card-foreground shadow-relevo",
          isTerminal && "bg-card/80",
        )}
      >
        {/* Cabeçalho */}
        <header className="flex items-start gap-3">
          <span
            className={cn(
              "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px]",
              status.tone === "gold"
                ? "bg-primary-soft text-primary-soft-foreground"
                : status.tone === "bad"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-foreground/70",
            )}
          >
            <ChipIcon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[14px] font-bold leading-snug tracking-tight text-foreground" title={plan.message}>
              {firstLine(plan.message)}
            </p>
            <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {origin ? `${origin} · ` : ""}
              <span className="tabular-nums">{fmt(figures.total)}</span> contatos
            </p>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              STATUS_PILL[status.tone],
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status.tone])} />
            {status.label}
          </span>
        </header>

        {/* Lote atual + % */}
        <div className="flex items-baseline justify-between gap-3 text-[12px]">
          <span className="min-w-0 truncate font-semibold text-foreground/85">{lotLine}</span>
          <span className="shrink-0 font-bold tabular-nums text-muted-foreground">{figures.pct}%</span>
        </div>

        <LotBars plan={plan} byLot={progress?.byLot} />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
            <span>Lotes liberados</span>
            <span className="tabular-nums text-foreground/80">
              {plan.lots_released} de {plan.lots_total}
            </span>
          </div>
          <LotSegments released={plan.lots_released} total={plan.lots_total} />
        </div>

        {/* Mini-blocos */}
        <dl className="grid grid-cols-4 gap-1.5">
          {[
            { label: "Aceitas", value: figures.sent, bad: false },
            { label: "Falhas", value: figures.failed, bad: figures.failed > 0 },
            { label: "Ignorados", value: figures.skipped, bad: false },
            { label: "Na fila", value: figures.pending, bad: false },
          ].map((b) => (
            <div key={b.label} className="min-w-0 rounded-xl bg-muted/50 px-2.5 py-2">
              <dd className={cn("text-[15px] font-extrabold tabular-nums tracking-tight", b.bad ? "text-destructive" : "text-foreground")}>
                {fmt(b.value)}
              </dd>
              <dt className="truncate text-[10.5px] font-medium text-muted-foreground">{b.label}</dt>
            </div>
          ))}
        </dl>

        {/* Ações */}
        <div className="flex flex-wrap items-center gap-1.5">
          {isActive && (
            <Button size="sm" variant="ink" className="h-8" disabled={actions.pending} onClick={actions.pause}>
              {actions.pending ? <Loader2 className="animate-spin" /> : <Pause />}
              Pausar
            </Button>
          )}
          {isPaused && (
            <Button size="sm" variant="ink" className="h-8" disabled={actions.pending} onClick={actions.resume}>
              {actions.pending ? <Loader2 className="animate-spin" /> : <Play />}
              Retomar
            </Button>
          )}
          {!isTerminal && (
            <Button size="sm" variant="outline" className="h-8" disabled={actions.pending} onClick={actions.openEdit}>
              <Pencil />
              Editar
            </Button>
          )}
          {!isTerminal && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 hover:text-destructive"
              disabled={actions.pending}
              onClick={actions.askCancel}
            >
              <X />
              Cancelar
            </Button>
          )}
          {onOpen && (
            <Button size="sm" variant="outline" className={cn("h-8", isTerminal ? "" : "ml-auto")} onClick={onOpen}>
              <Users />
              Ver leads do disparo
            </Button>
          )}
        </div>

        {/* Rodapé */}
        {(started || inboxLabel) && (
          <footer className="mt-auto flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
            <span className="truncate">{started ? `Início ${started}` : ""}</span>
            {inboxLabel && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Smartphone className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{inboxLabel}</span>
              </span>
            )}
          </footer>
        )}
      </article>

      {actions.dialogs}
    </>
  );
}
