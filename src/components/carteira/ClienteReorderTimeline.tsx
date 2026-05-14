import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClienteReorderTimelineProps {
  cycleDays: number;
  daysSinceLast: number;
  lastOrderAt: string | null;
  nextOrderExpected: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
};

function barColor(pct: number) {
  if (pct <= 80) return "from-emerald-500 to-emerald-400";
  if (pct <= 100) return "from-amber-500 to-amber-400";
  return "from-red-500 to-red-400";
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
        <span className="text-[10px] uppercase tracking-wider font-medium text-zinc-500">
          Ciclo de Recompra
        </span>
        <span className={cn(
          "text-xs font-semibold tabular-nums",
          pct <= 80 ? "text-emerald-400" : pct <= 100 ? "text-amber-400" : "text-red-400"
        )}>
          {daysSinceLast}d / {cycleDays}d
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative h-3 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full bg-gradient-to-r transition-all",
            barColor(pct),
            barBgPulse(pct),
          )}
          style={{ width: `${clampedPct}%` }}
        />
        {/* Overflow indicator */}
        {pct > 100 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-bold text-white tracking-wider">
              ATRASADO {Math.round(pct - 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between text-[10px] text-zinc-600">
        <span>Último: {formatDate(lastOrderAt)}</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-500" />
          Hoje
        </span>
        <span>Previsto: {formatDate(nextOrderExpected)}</span>
      </div>
    </div>
  );
}
