/**
 * Barras de lote do painel de Disparos.
 *
 *  LotBars      uma barra por lote (dia), altura = processados / público do
 *               lote. Lote liberado e completo em tinta; o lote corrente em
 *               ouro; o que ainda não saiu, vazio. Dado real: o
 *               `lot_index` de cada destinatário (`useBlastPlanProgress`).
 *  LotSegments  a barra segmentada "Lotes liberados x de y".
 *
 * `tone="gold"` desenha sobre o cartão de ouro (FocusCard): tinta escura no
 * lugar do ouro, que ali sumiria.
 */
import type { BlastPlan, BlastPlanLotProgress } from "@/modules/campaigns/hooks/useBlastPlans";
import { cn } from "@/lib/utils";

type BarTone = "card" | "gold";

/** Acima disso as barras ficam finas demais para rotular uma a uma. */
const LABEL_LIMIT = 12;
/** Acima disso a barra segmentada vira contínua. */
const SEGMENT_LIMIT = 24;

export function LotBars({
  plan,
  byLot,
  tone = "card",
  className,
}: {
  plan: BlastPlan;
  byLot?: BlastPlanLotProgress[];
  tone?: BarTone;
  className?: string;
}) {
  const total = Math.max(plan.lots_total, byLot?.length ?? 0);
  if (total <= 0) return null;
  const lots = Array.from({ length: total }, (_, i) => byLot?.find((l) => l.lotIndex === i) ?? null);
  const currentIdx = plan.status === "active" ? Math.max(0, plan.lots_released - 1) : -1;
  const showLabels = total <= LABEL_LIMIT;

  return (
    <div className={cn("flex h-[58px] items-end gap-1", className)} aria-hidden>
      {lots.map((lot, i) => {
        const released = i < plan.lots_released;
        const ratio = lot && lot.total > 0 ? lot.processed / lot.total : 0;
        const isCurrent = i === currentIdx && ratio < 1;
        const fill =
          tone === "gold"
            ? isCurrent
              ? "bg-primary-foreground/45"
              : "bg-primary-foreground"
            : isCurrent
              ? "bg-primary"
              : "bg-foreground dark:bg-foreground/85";
        return (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div
              className={cn(
                "relative flex h-[40px] w-full max-w-[26px] items-end overflow-hidden rounded-[7px]",
                tone === "gold" ? "bg-primary-foreground/[.09]" : "bg-muted",
              )}
            >
              {released && (
                <div
                  className={cn("w-full rounded-[7px] transition-[height] duration-500 motion-reduce:transition-none", fill)}
                  style={{ height: `${Math.max(ratio * 100, ratio > 0 ? 8 : 0)}%` }}
                />
              )}
            </div>
            {showLabels && (
              <span
                className={cn(
                  "text-[9.5px] font-bold tabular-nums",
                  tone === "gold" ? "text-primary-foreground/60" : "text-muted-foreground",
                  isCurrent && (tone === "gold" ? "text-primary-foreground" : "text-foreground"),
                )}
              >
                {i + 1}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LotSegments({
  released,
  total,
  tone = "card",
}: {
  released: number;
  total: number;
  tone?: BarTone;
}) {
  const on = tone === "gold" ? "bg-primary-foreground" : "bg-foreground dark:bg-foreground/85";
  const off = tone === "gold" ? "bg-primary-foreground/15" : "bg-muted";
  if (total <= 0) return null;
  if (total > SEGMENT_LIMIT) {
    const pct = Math.min(100, Math.round((released / total) * 100));
    return (
      <div className={cn("h-[5px] w-full overflow-hidden rounded-full", off)} aria-hidden>
        <div className={cn("h-full rounded-full", on)} style={{ width: `${pct}%` }} />
      </div>
    );
  }
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cn("h-[5px] flex-1 rounded-full", i < released ? on : off)} />
      ))}
    </div>
  );
}
