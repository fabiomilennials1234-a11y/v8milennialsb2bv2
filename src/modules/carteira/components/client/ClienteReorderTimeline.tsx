import { cn } from "@/lib/utils";
import { formatDateSafe } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClienteReorderTimelineProps {
  cycleDays: number;
  daysSinceLast: number;
  lastOrderAt: string | null;
  nextOrderExpected: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Mesmas faixas de antes (80/100% do ciclo), em token. */
function barColor(pct: number) {
  if (pct <= 80) return "bg-success";
  if (pct <= 100) return "bg-warning";
  return "bg-destructive";
}

function barBgPulse(pct: number) {
  if (pct > 100) return "animate-pulse";
  return "";
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ClienteReorderTimeline({
  cycleDays,
  daysSinceLast,
  lastOrderAt,
  nextOrderExpected,
}: ClienteReorderTimelineProps) {
  const pct = cycleDays > 0 ? (daysSinceLast / cycleDays) * 100 : 0;
  const clampedPct = Math.min(pct, 100);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
          Dias sem pedido / ciclo
        </span>
        <span className={cn(
          "text-sm font-extrabold tabular-nums tracking-[-0.02em]",
          pct <= 80 ? "text-success" : pct <= 100 ? "text-warning-strong" : "text-destructive"
        )}>
          {daysSinceLast}d / {cycleDays}d
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative h-3 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            barColor(pct),
            barBgPulse(pct),
          )}
          style={{ width: `${clampedPct}%` }}
        />
        {/* Overflow indicator */}
        {pct > 100 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-bold tracking-wider text-destructive-foreground">
              ATRASADO {Math.round(pct - 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>Último: {formatDateSafe(lastOrderAt)}</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          Hoje
        </span>
        <span>Previsto: {formatDateSafe(nextOrderExpected)}</span>
      </div>
    </div>
  );
}
