/**
 * BlastFocusCard — "Disparo em foco", o cartão de ouro do painel de Disparos.
 *
 * O detalhe do plano selecionado na lista em tinta (InkSplit): número herói
 * aceitas / público, barras por lote, quatro blocos (Aceitas, Falhas,
 * Ignorados, Próximo lote), barra de lotes liberados e os MESMOS controles do
 * cartão da grade (`useBlastPlanActions`), com os mesmos diálogos.
 */
import { ArrowRight, Filter, Loader2, Pause, Pencil, Play, Smartphone, X } from "lucide-react";
import { FocusCard, FocusTile } from "@/components/ui/bento";
import { useBlastPlanProgress, type BlastPlan } from "@/modules/campaigns/hooks/useBlastPlans";
import { cn } from "@/lib/utils";
import {
  STATUS_META,
  firstLine,
  nextReleaseLabel,
  releaseTime,
  useBlastFigures,
  useBlastPlanActions,
} from "./blast-plan-ui";
import { LotBars, LotSegments } from "./BlastLotBars";

const fmt = (n: number) => n.toLocaleString("pt-BR");

const onGoldButton =
  "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground [&_svg]:h-3.5 [&_svg]:w-3.5";

export function BlastFocusCard({
  plan,
  origin,
  inboxLabel,
  onOpen,
}: {
  plan: BlastPlan;
  origin?: string | null;
  inboxLabel?: string | null;
  onOpen: () => void;
}) {
  const { data: progress } = useBlastPlanProgress(plan.id);
  const figures = useBlastFigures(plan, progress);
  const actions = useBlastPlanActions(plan);
  // O selo do foco diz o ciclo de vida (Ativo/Pausado); as falhas têm bloco próprio.
  const status = STATUS_META[plan.status];
  const isActive = plan.status === "active";
  const isPaused = plan.status === "paused";
  const next = nextReleaseLabel(plan);
  const lotNow = Math.max(1, plan.lots_released);

  return (
    <>
      <FocusCard className="gap-5">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold text-primary-foreground/70">Disparo em foco</p>
            <h3 className="mt-1 line-clamp-2 text-[1.45rem] font-extrabold leading-[1.15] tracking-[-0.03em]" title={plan.message}>
              {firstLine(plan.message)}
            </h3>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground px-2.5 py-1 text-[11px] font-bold text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {status.label} · lote {lotNow} de {plan.lots_total}
              </span>
              {origin && (
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary-foreground/15 bg-primary-foreground/[.07] px-2.5 py-1 text-[11px] font-bold">
                  <Filter className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{origin}</span>
                </span>
              )}
            </div>
          </div>
          {inboxLabel && (
            <span className="inline-flex max-w-[45%] items-center gap-1.5 text-[12px] font-semibold text-primary-foreground/75">
              <Smartphone className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{inboxLabel}</span>
            </span>
          )}
        </div>

        {/* Herói + barras por lote */}
        <div className="grid items-end gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,260px)]">
          <div className="min-w-0">
            <p className="text-[3rem] font-extrabold leading-none tracking-[-0.05em] tabular-nums max-sm:text-[2.4rem]">
              {fmt(figures.sent)}
              <span className="text-[0.5em] font-bold tracking-[-0.03em] text-primary-foreground/40">
                /{fmt(figures.total)}
              </span>
            </p>
            <p className="mt-1.5 text-[12.5px] font-medium text-primary-foreground/75">
              aceitas para envio · {figures.pct}% do público processado · {fmt(figures.pending)} na fila
            </p>
            <div className="mt-3 h-[5px] w-full overflow-hidden rounded-full bg-primary-foreground/15" aria-hidden>
              <div
                className="h-full rounded-full bg-primary-foreground transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${Math.min(100, Math.max(0, figures.pct))}%` }}
              />
            </div>
          </div>
          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-bold text-primary-foreground/70">Progresso por lote</p>
            <LotBars plan={plan} byLot={progress?.byLot} tone="gold" />
          </div>
        </div>

        {/* Quatro blocos */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <FocusTile>
            <p className="text-[11px] font-bold text-primary-foreground/65">Aceitas</p>
            <p className="mt-1 text-[1.4rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{fmt(figures.sent)}</p>
            <p className="mt-1.5 text-[11px] text-primary-foreground/65">entraram na fila do WhatsApp</p>
          </FocusTile>
          <FocusTile>
            <p className="text-[11px] font-bold text-primary-foreground/65">Falhas</p>
            <p className="mt-1 text-[1.4rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{fmt(figures.failed)}</p>
            <p className="mt-1.5 text-[11px] text-primary-foreground/65">não foram enviadas</p>
          </FocusTile>
          <FocusTile>
            <p className="text-[11px] font-bold text-primary-foreground/65">Ignorados</p>
            <p className="mt-1 text-[1.4rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{fmt(figures.skipped)}</p>
            <p className="mt-1.5 text-[11px] text-primary-foreground/65">pulados pelo disparo</p>
          </FocusTile>
          <FocusTile>
            <p className="text-[11px] font-bold text-primary-foreground/65">Próximo lote</p>
            <p className="mt-1 text-[1.4rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
              {next === "—" ? "—" : releaseTime(plan)}
            </p>
            <p className="mt-1.5 text-[11px] text-primary-foreground/65">
              {next === "—" ? "nenhum lote a liberar" : `${next} · lote ${Math.min(plan.lots_total, plan.lots_released + 1)} de ${plan.lots_total}`}
            </p>
          </FocusTile>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-bold text-primary-foreground/70">
            <span>Lotes liberados</span>
            <span className="tabular-nums text-primary-foreground">
              {plan.lots_released} de {plan.lots_total}
            </span>
          </div>
          <LotSegments released={plan.lots_released} total={plan.lots_total} tone="gold" />
        </div>

        {/* Rodapé de ações */}
        <div className="flex flex-wrap items-center gap-2">
          {isActive && (
            <button
              type="button"
              className={cn(onGoldButton, "bg-primary-foreground text-primary hover:bg-primary-foreground/90")}
              disabled={actions.pending}
              onClick={actions.pause}
            >
              {actions.pending ? <Loader2 className="animate-spin" /> : <Pause />}
              Pausar
            </button>
          )}
          {isPaused && (
            <button
              type="button"
              className={cn(onGoldButton, "bg-primary-foreground text-primary hover:bg-primary-foreground/90")}
              disabled={actions.pending}
              onClick={actions.resume}
            >
              {actions.pending ? <Loader2 className="animate-spin" /> : <Play />}
              Retomar
            </button>
          )}
          <button
            type="button"
            className={cn(onGoldButton, "border border-primary-foreground/15 bg-primary-foreground/[.07] hover:bg-primary-foreground/[.12]")}
            disabled={actions.pending}
            onClick={actions.openEdit}
          >
            <Pencil />
            Editar
          </button>
          <button
            type="button"
            className={cn(onGoldButton, "border border-primary-foreground/15 bg-primary-foreground/[.07] hover:bg-primary-foreground/[.12]")}
            disabled={actions.pending}
            onClick={actions.askCancel}
          >
            <X />
            Cancelar
          </button>
          <button
            type="button"
            className={cn(onGoldButton, "ml-auto bg-tinta-foreground text-primary-foreground shadow-relevo hover:bg-tinta-foreground/90")}
            onClick={onOpen}
          >
            Ver leads do disparo
            <ArrowRight />
          </button>
        </div>
      </FocusCard>

      {actions.dialogs}
    </>
  );
}
